import { defineCommand, runMain } from 'citty'

import deploy from './commands/deploy.ts'

process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EPIPE') throw error
})

const main = defineCommand({
  meta: {
    name: 'moonbunny',
    description: 'Deploy static reports to moonbunny-host',
  },
  subCommands: { deploy },
})

await runMain(main)
