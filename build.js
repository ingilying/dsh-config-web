import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

console.log('Building host entry point...')
execSync('npx --yes tsdown src/index.ts --out-dir lib --no-dts --format esm --fixed-extension false --no-clean', { stdio: 'inherit' })
execSync('cp lib/index.mjs lib/index.js')

console.log('Building client browser bundle...')
execSync('npx --yes tsdown src/client/index.ts --out-dir lib --no-dts --format cjs --fixed-extension false --no-clean', { stdio: 'inherit' })
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
