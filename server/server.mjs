import { kebabCase } from 'change-case'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
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

const SEGMENT = /^[\w-][\w.-]*$/ // a leading dot is excluded so a slug can never name a dotfile like .meta.json

const MAX_BODY = 50 * 1024 * 1024
const MAX_EXTRACTED = 10 * MAX_BODY // gzip expands, so the output needs its own cap

const readMeta = dir => JSON.parse(fs.readFileSync(path.join(dir, '.meta.json'), 'utf8'))

// tar refuses absolute symlinks but extracts relative ones, which would let a served
// path escape the slug; keep only directories and regular files with one hard link.
function scrub(dir) {
  let bytes = 0
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name)
    const stats = fs.lstatSync(file)
    if (stats.isDirectory()) bytes += scrub(file)
    else if (stats.isFile() && stats.nlink === 1) bytes += stats.size
    else fs.rmSync(file, { recursive: true, force: true })
  }
  return bytes
}

function deploy(req, res, urlPath) {
  const token = (req.headers.authorization || '').replace('Bearer ', '')
  if (!TOKENS.includes(token)) return end(res, 401, 'bad token')

  const [rawProject, rawSlug, extra] = urlPath.slice('/_deploy/'.length).split('/')
  if (!rawProject || extra) return end(res, 400, 'bad project/slug')

  const project = kebabCase(decodeURIComponent(rawProject))
  const preferred = rawSlug ? kebabCase(decodeURIComponent(rawSlug)) : randomUUID()
  if (!SEGMENT.test(project) || !SEGMENT.test(preferred)) return end(res, 400, 'bad project/slug')

  const days = Number(req.headers['x-expires'] ?? 30)
  if (!Number.isFinite(days) || days < 0) return end(res, 400, 'bad expiration')

  if (Number(req.headers['content-length']) > MAX_BODY) return end(res, 413, 'too large')

  // Deploys are immutable: a taken slug gets a unique suffix instead of being replaced.
  let slug = preferred
  let dir = path.join(ROOT, project, slug)
  if (fs.existsSync(dir)) {
    slug = `${preferred}-${randomUUID()}`
    dir = path.join(ROOT, project, slug)
  }
  fs.mkdirSync(dir, { recursive: true })

  const tar = spawn('tar', ['-xz', '-C', dir])
  tar.stdin.on('error', () => {})
  // A client can lie about content-length, so count what actually arrives.
  let received = 0
  req.on('data', chunk => {
    received += chunk.length
    if (received > MAX_BODY) req.destroy()
  })
  req.pipe(tar.stdin)
  tar.on('close', code => {
    if (code !== 0) {
      fs.rmSync(dir, { recursive: true, force: true })
      return end(res, 400, 'extract failed')
    }
    if (scrub(dir) > MAX_EXTRACTED) {
      fs.rmSync(dir, { recursive: true, force: true })
      return end(res, 400, 'extracted content too large')
    }
    const meta = {
      deployedAt: new Date().toISOString(),
      expiresAt: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
      requestedSlug: preferred,
    }
    const auth = req.headers['x-auth']
    if (auth) meta.auth = auth
    fs.writeFileSync(path.join(dir, '.meta.json'), JSON.stringify(meta))
    end(res, 200, `/${project}/${slug}/`)
  })
}

function serve(req, res, urlPath) {
  // Forced unless a real file sits at the data root, which no deploy can create.
  if (urlPath === '/robots.txt' && !fs.existsSync(path.join(ROOT, 'robots.txt'))) {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    return res.end('User-agent: *\nDisallow: /\n')
  }

  const parts = urlPath.split('/').map(decodeURIComponent).filter(Boolean)
  if (parts.some(p => p.startsWith('.') || p.includes('/'))) return end(res, 404, 'not found')

  if (parts.length >= 2) {
    const slugDir = path.join(ROOT, parts[0], parts[1])
    const expected = fs.existsSync(path.join(slugDir, '.meta.json')) ? readMeta(slugDir).auth : undefined
    if (expected) {
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

function sweep() {
  for (const project of fs.readdirSync(ROOT)) {
    const projectDir = path.join(ROOT, project)
    if (!fs.statSync(projectDir).isDirectory()) continue
    for (const slug of fs.readdirSync(projectDir)) {
      const slugDir = path.join(projectDir, slug)
      try {
        const { expiresAt } = readMeta(slugDir)
        if (expiresAt && Date.parse(expiresAt) < Date.now()) fs.rmSync(slugDir, { recursive: true, force: true })
      } catch {
        // A slug without readable metadata never expires.
      }
    }
    if (!fs.readdirSync(projectDir).length) fs.rmdirSync(projectDir)
  }
}

function createInterval({ intervalMs, immediate = false }, onTick) {
  let timeout
  let tickCount = 0
  let isRunning = false

  const fireTick = () => onTick({ intervalMs, tick: tickCount++, timestamp: new Date() })

  const scheduleNext = () => {
    timeout = setTimeout(() => {
      timeout = undefined
      if (!isRunning) return
      try {
        fireTick()
      } finally {
        if (isRunning) scheduleNext()
      }
    }, intervalMs)
  }

  return {
    run: () => {
      if (isRunning) return
      isRunning = true
      tickCount = 0
      if (immediate) {
        try {
          fireTick()
        } catch (error) {
          isRunning = false
          throw error
        }
      }
      if (isRunning) scheduleNext()
    },
    stop: () => {
      if (!isRunning) return
      isRunning = false
      if (timeout !== undefined) {
        clearTimeout(timeout)
        timeout = undefined
      }
    },
  }
}

createInterval({ immediate: true, intervalMs: 86_400_000 }, () => {
  try {
    sweep()
  } catch (error) {
    console.error('sweep failed:', error)
  }
}).run()

http
  .createServer((req, res) => {
    try {
      res.setHeader('X-Content-Type-Options', 'nosniff')
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
