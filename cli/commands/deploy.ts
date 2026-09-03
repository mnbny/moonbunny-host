import ansis from 'ansis'
import { defineCommand } from 'citty'
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

function fail(message: string): never {
  console.error(ansis.red(message))
  process.exit(1)
}

export default defineCommand({
  meta: {
    description: 'Deploy a directory or a single file to moonbunny-host',
    name: 'deploy',
  },
  args: {
    dir: { description: 'The directory or file to deploy', required: true, type: 'positional' },
    project: { description: 'First URL path segment, slugified by the server', required: true, type: 'string' },
    slug: {
      description: 'Second URL path segment, slugified by the server (default: server picks a UUID)',
      type: 'string',
    },
    auth: { description: 'user:pass basic auth required to view this deploy', type: 'string' },
    expires: {
      description: 'Days until the deploy is deleted; 0 keeps it forever (server default: 30)',
      type: 'string',
    },
    host: { description: 'Server URL (overrides MOONBUNNY_HOST)', type: 'string' },
    token: { description: 'Deploy token (overrides MOONBUNNY_TOKEN)', type: 'string' },
  },
  async run({ args }) {
    const host = (args.host ?? process.env['MOONBUNNY_HOST'])?.replace(/\/$/, '')
    const token = args.token ?? process.env['MOONBUNNY_TOKEN']

    if (!host) fail('Set MOONBUNNY_HOST or pass --host.')
    if (!token) fail('Set MOONBUNNY_TOKEN or pass --token.')

    const target = await stat(args.dir).catch(() => null)
    if (!target?.isDirectory() && !target?.isFile()) fail(`Not a directory or file: ${args.dir}`)

    const expires = args.expires === undefined ? undefined : Number(args.expires)
    if (expires !== undefined && (!Number.isFinite(expires) || expires < 0))
      fail('--expires must be a non-negative number of days.')

    // The server normalizes, defaults, and picks the final path; send the raw values.
    const project = encodeURIComponent(args.project)
    const slug = args.slug ? `/${encodeURIComponent(args.slug)}` : ''

    const [cwd, entry] = target.isDirectory() ? [args.dir, '.'] : [dirname(args.dir), basename(args.dir)]
    const tar = spawn('tar', ['-cz', '-C', cwd, entry], { stdio: ['ignore', 'pipe', 'inherit'] })
    const chunks: Buffer[] = []

    for await (const chunk of tar.stdout) chunks.push(chunk as Buffer)

    const code = await new Promise<number | null>(resolve => tar.on('close', resolve))
    if (code !== 0) fail('tar failed to archive the directory.')

    const response = await fetch(`${host}/_deploy/${project}${slug}`, {
      body: Buffer.concat(chunks),
      headers: {
        authorization: `Bearer ${token}`,
        ...(expires !== undefined ? { 'x-expires': String(expires) } : {}),
        ...(args.auth ? { 'x-auth': args.auth } : {}),
      },
      method: 'PUT',
    }).catch((error: Error) => fail(`Could not reach ${host}: ${error.message}`))

    const body = (await response.text()).trim()
    if (!response.ok) fail(`Deploy failed (${response.status}): ${body}`)

    // The URL is the only stdout, so a script can capture it directly.
    console.log(`${host}${body}`)
  },
})
