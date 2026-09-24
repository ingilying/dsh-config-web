import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = import.meta.dirname
const harness = resolve(root, '../deepseek-harness')
const dshNodeModules = resolve(process.env.HOME ?? process.env.USERPROFILE ?? root, '.dsh/profiles/node_modules')

const alias: Record<string, string> = {}

/**
 * Local development resolves the DSH packages to a sibling harness checkout, so
 * a plugin change can be tested against harness sources without republishing
 * them. CI has no such checkout, so the same imports fall through to the
 * published packages in `node_modules`.
 */
function addHarnessAliases(): void {
  const tsconfigPath = join(harness, 'tsconfig.base.json')
  if (!existsSync(tsconfigPath)) return
  // The file carries comments, which JSON.parse does not accept.
  const stripped = readFileSync(tsconfigPath, 'utf8').replace(/\/\/.*/g, '')
  const paths = JSON.parse(stripped).compilerOptions?.paths ?? {}
  for (const [key, targets] of Object.entries(paths)) {
    const target = (targets as string[])[0]
    if (target && !key.includes('*')) alias[key] = resolve(harness, target)
  }
}

/**
 * Packages the harness runtime resolves from the DSH profile store. Prefer the
 * project's own install so a test run is reproducible; fall back to the profile
 * store for a checkout whose dependencies were never installed.
 */
function addRuntimeFallbacks(): void {
  const fallbacks: Record<string, string[]> = {
    'ipaddr.js': ['node_modules/ipaddr.js/lib/ipaddr.js', resolve(dshNodeModules, 'ipaddr.js/lib/ipaddr.js')],
    undici: ['node_modules/undici', resolve(dshNodeModules, 'undici')],
  }
  for (const [name, candidates] of Object.entries(fallbacks)) {
    const found = candidates.map(candidate => resolve(root, candidate)).find(candidate => existsSync(candidate))
    if (found !== undefined) alias[name] = found
  }
}

addHarnessAliases()
addRuntimeFallbacks()

export default {
  test: {
    environment: 'node',
  },
  resolve: {
    alias,
  },
}
