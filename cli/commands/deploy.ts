import ansis from 'ansis'
import { defineCommand } from 'citty'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'

function fail(message: string): never {
  console.error(ansis.red(message))
  process.exit(1)
}

export default defineCommand({
  meta: {
    description: 'Deploy a directory of static files to moonbunny-host',
    name: 'deploy',
  },
  args: {
    dir: { description: 'The directory to deploy', required: true, type: 'positional' },
    project: { description: 'First URL path segment', required: true, type: 'string' },
    slug: { description: 'Second URL path segment (default: a random UUID)', type: 'string' },
    auth: { description: 'user:pass basic auth required to view this deploy', type: 'string' },
  },
  async run({ args }) {
    const host = process.env['MOONBUNNY_HOST']?.replace(/\/$/, '')
    const token = process.env['MOONBUNNY_TOKEN']

    if (!host) fail('MOONBUNNY_HOST is not set.')
    if (!token) fail('MOONBUNNY_TOKEN is not set.')

    const directory = await stat(args.dir).catch(() => null)
    if (!directory?.isDirectory()) fail(`Not a directory: ${args.dir}`)

    const slug = args.slug ?? randomUUID()

    const tar = spawn('tar', ['-cz', '-C', args.dir, '.'], { stdio: ['ignore', 'pipe', 'inherit'] })
    const chunks: Buffer[] = []

    for await (const chunk of tar.stdout) chunks.push(chunk as Buffer)

    const code = await new Promise<number | null>(resolve => tar.on('close', resolve))
    if (code !== 0) fail('tar failed to archive the directory.')

    const response = await fetch(`${host}/_deploy/${args.project}/${slug}`, {
      body: Buffer.concat(chunks),
      headers: {
        authorization: `Bearer ${token}`,
        ...(args.auth ? { 'x-auth': args.auth } : {}),
      },
      method: 'PUT',
    }).catch((error: Error) => fail(`Could not reach ${host}: ${error.message}`))

    if (!response.ok) fail(`Deploy failed (${response.status}): ${(await response.text()).trim()}`)

    // The URL is the only stdout, so a script can capture it directly.
    console.log(`${host}/${args.project}/${slug}/`)
  },
})
