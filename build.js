import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Bundle with the pinned devDependency when dependencies are installed, and
 * fall back to fetching one only for a bare checkout. `lib/` is committed, so
 * a reproducible rebuild matters more here than a zero-install build.
 */
const localTsdown = join(import.meta.dirname, 'node_modules', '.bin', 'tsdown')
const tsdown = existsSync(localTsdown) ? `"${localTsdown}"` : 'npx --yes tsdown'

console.log('Building host entry point...')
execSync(`${tsdown} src/index.ts --out-dir lib --no-dts --format esm --fixed-extension false --no-clean`, { stdio: 'inherit' })
execSync('cp lib/index.mjs lib/index.js')

console.log('Building client browser bundle...')
execSync(`${tsdown} src/client/index.ts --out-dir lib --no-dts --format cjs --fixed-extension false --no-clean`, { stdio: 'inherit' })
const clientCjs = readFileSync('lib/index.cjs', 'utf8')

// Wrap with DeepSeek Harness module loader registration
const clientBundle = `window.__ModuleLoader__.load({ id: "dsh-config-web", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
${clientCjs}
return module.exports; } });
`

writeFileSync('lib/client.js', clientBundle)
execSync('rm -f lib/index.cjs')

console.log('Build complete: lib/index.js and lib/client.js generated.')
