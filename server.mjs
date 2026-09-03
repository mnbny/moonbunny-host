import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const ROOT = process.env.DATA_DIR || '/data'
const PORT = process.env.PORT || 8080
const TOKENS = (process.env.DEPLOY_TOKENS || '').split(',').filter(Boolean)

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
}

const end = (res, code, msg) => {
  res.writeHead(code, { 'Content-Type': 'text/plain' })
  res.end(msg + '\n')
}

const SEGMENT = /^[\w-][\w.-]*$/ // a leading dot is excluded so a slug can never name a dotfile like .auth

function deploy(req, res, urlPath) {
  const token = (req.headers.authorization || '').replace('Bearer ', '')
  if (!TOKENS.includes(token)) return end(res, 401, 'bad token')

  const [project, slug, extra] = urlPath.slice('/_deploy/'.length).split('/')
  if (!project || !slug || extra || !SEGMENT.test(project) || !SEGMENT.test(slug))
    return end(res, 400, 'bad project/slug')

  const dir = path.join(ROOT, project, slug)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })

  const tar = spawn('tar', ['-xz', '-C', dir])
  tar.stdin.on('error', () => {})
  req.pipe(tar.stdin)
  tar.on('close', code => {
    if (code !== 0) {
      fs.rmSync(dir, { recursive: true, force: true })
      return end(res, 400, 'extract failed')
    }
    const auth = req.headers['x-auth']
    if (auth) fs.writeFileSync(path.join(dir, '.auth'), auth)
    end(res, 200, `/${project}/${slug}/`)
  })
}

function serve(req, res, urlPath) {
  const parts = urlPath.split('/').map(decodeURIComponent).filter(Boolean)
  if (parts.some(p => p.startsWith('.') || p.includes('/'))) return end(res, 404, 'not found')

  if (parts.length >= 2) {
    const authFile = path.join(ROOT, parts[0], parts[1], '.auth')
    if (fs.existsSync(authFile)) {
      const expected = fs.readFileSync(authFile, 'utf8').trim()
      const header = req.headers.authorization || ''
      const got = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString() : ''
      if (got !== expected) {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="moonbunny"' })
        return res.end('auth required\n')
      }
    }
  }

  let file = path.join(ROOT, ...parts)
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!urlPath.endsWith('/')) {
      res.writeHead(301, { Location: urlPath + '/' })
      return res.end()
    }
    file = path.join(file, 'index.html')
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return end(res, 404, 'not found')

  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}

http
  .createServer((req, res) => {
    try {
      const urlPath = req.url.split('?')[0]
      if (req.method === 'PUT' && urlPath.startsWith('/_deploy/')) return deploy(req, res, urlPath)
      if (req.method === 'GET' || req.method === 'HEAD') return serve(req, res, urlPath)
      end(res, 405, 'method not allowed')
    } catch (e) {
      end(res, 500, 'server error')
    }
  })
  .listen(PORT, () => {
    if (!TOKENS.length) console.warn('WARNING: DEPLOY_TOKENS empty — deploys disabled')
    console.log(`moonbunny-host on :${PORT}, serving ${ROOT}`)
  })
