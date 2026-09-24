import { resolve, join } from 'node:path'
import { readFileSync } from 'node:fs'

const harness = resolve(import.meta.dirname, '../deepseek-harness')
const dshNodeModules = resolve(process.env.HOME || '/Users/ingil', '.dsh/profiles/node_modules')

// Read tsconfig.base.json
const raw = readFileSync(join(harness, 'tsconfig.base.json'), 'utf8')
// strip single-line comments from json
const stripped = raw.replace(/\/\/.*/g, '')
const tsconfig = JSON.parse(stripped)
const paths = tsconfig.compilerOptions?.paths ?? {}

const alias: Record<string, string> = {
  'ipaddr.js': resolve(dshNodeModules, 'ipaddr.js/lib/ipaddr.js'),
  'undici': resolve(dshNodeModules, 'undici'),
}

for (const [key, targets] of Object.entries(paths)) {
  const target = (targets as string[])[0]
  if (target && !key.includes('*')) {
    alias[key] = resolve(harness, target)
  }
}

export default {
  test: {
    environment: 'node',
  },
  resolve: {
    alias,
  },
}
