#!/usr/bin/env node
/**
 * Black-box checks of the install path.
 *
 * Each mode builds a throwaway DSH home with one profile, runs the shipped
 * installer the way a user would, and asserts what the profile and the
 * installed package look like afterwards. Everything is re-derived from the
 * filesystem instead of importing the installer's own helpers, so a bug in
 * those helpers cannot hide here.
 *
 * Usage:
 *   node scripts/smoke-install.mjs                      # link this checkout
 *   node scripts/smoke-install.mjs --source dist/x.tgz   # install a tarball
 *   node scripts/smoke-install.mjs --from-git            # install through the
 *                                                        # repository fallback
 *   node scripts/smoke-install.mjs --keep                # keep the home
 */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const installer = join(root, 'bin', 'install.mjs')

/** Files the published package must ship for the install to be usable. */
const REQUIRED_FILES = ['package.json', 'cordis.patch.yml', 'bin/install.mjs', 'bin/plan.mjs', 'lib/index.js', 'lib/client.js']

/** Arguments this script understands; everything else is refused loudly. */
function parseArgs(argv) {
  const options = { source: undefined, fromGit: false, keep: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--source') options.source = argv[++index]
    else if (argument === '--from-git') options.fromGit = true
    else if (argument === '--keep') options.keep = true
    else throw new Error(`unknown argument ${JSON.stringify(argument)}`)
  }
  if (options.source !== undefined && options.fromGit) throw new Error('--source and --from-git are mutually exclusive')
  return options
}

/** Run a command and return its result without streaming. */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd ?? root, encoding: 'utf8' })
  if (result.error !== undefined) throw new Error(`could not run ${command}: ${result.error.message}`)
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/** Run a command that must succeed. */
function mustRun(command, args, options) {
  const result = run(command, args, options)
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status}\n${result.stderr}`)
  return result
}

/** Fail the check with a message that says what was expected. */
function check(condition, message) {
  if (!condition) throw new Error(message)
}

/** A fresh harness home holding one initialized profile. */
function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-config-web-smoke-'))
  const profile = join(home, 'profiles', 'demo')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-demo',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
  }, undefined, 2)}\n`)
  writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  return { home, profile }
}

/**
 * Publish this working tree as a git repository and copy it into a directory
 * shaped like a package manager's cache, which is where `npx` runs the
 * installer from: a path under `node_modules`, so the installer's own default
 * source is the registry name and only the repository fallback can succeed.
 * @returns the installer entry point to run, and the spec the profile should record.
 */
function makeGitInstall() {
  const scratch = mkdtempSync(join(tmpdir(), 'dsh-config-web-git-'))
  const checkout = join(scratch, 'checkout')
  const url = `git+file://${checkout}`
  mkdirSync(checkout, { recursive: true })
  for (const entry of ['bin', 'lib', 'src', 'scripts', 'tests', 'cordis.patch.yml', 'install.sh', 'package.json']) {
    cpSync(join(root, entry), join(checkout, entry), { recursive: true })
  }
  const manifestPath = join(checkout, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  // A local URL keeps the check offline; a published package points this at
  // its public repository instead.
  manifest.repository = { type: 'git', url }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
  writeFileSync(join(checkout, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  writeFileSync(join(checkout, '.gitignore'), 'node_modules/\n')
  const git = ['-c', 'user.email=smoke@example.com', '-c', 'user.name=smoke', '-c', 'commit.gpgsign=false']
  mustRun('git', ['init', '--quiet'], { cwd: checkout })
  mustRun('git', [...git, 'add', '-A'], { cwd: checkout })
  mustRun('git', [...git, 'commit', '--quiet', '-m', 'smoke'], { cwd: checkout })

  const cached = join(scratch, 'cache', 'node_modules', 'dsh-config-web')
  mkdirSync(dirname(cached), { recursive: true })
  cpSync(checkout, cached, { recursive: true, filter: source => !source.includes(`${join('checkout', '.git')}`) })
  return { entry: join(cached, 'bin', 'install.mjs'), expected: url, scratch }
}

const options = parseArgs(process.argv.slice(2))
const { home, profile } = makeHome()
const gitInstall = options.fromGit ? makeGitInstall() : undefined
const source = options.source === undefined ? undefined : resolve(root, options.source)
const entry = gitInstall?.entry ?? installer

try {
  const install = run(process.execPath, [
    entry, '--dsh-home', home, '--profile', 'demo',
    ...source === undefined || gitInstall !== undefined ? [] : ['--source', source],
  ])
  process.stdout.write(install.stdout)
  process.stderr.write(install.stderr)
  check(install.status === 0, `the installer exited with status ${install.status}`)
  if (gitInstall !== undefined) {
    // The fallback is announced on stderr, next to pnpm's own failure.
    check(`${install.stdout}${install.stderr}`.includes('retrying from the repository'), 'the installer did not fall back to the repository')
  }

  const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  const spec = manifest.dependencies?.['dsh-config-web']
  check(typeof spec === 'string' && spec !== '', 'the profile manifest does not declare the dsh-config-web dependency')
  check(manifest.dsh?.profile?.bundles?.includes('dsh-config-web'), 'the profile does not list dsh-config-web as a bundle')
  check(manifest.dsh.profile.bundles[0] === '@deepseek-ai/dsh-base', 'the installer reordered the existing bundle layers')
  if (gitInstall !== undefined) check(spec.startsWith(gitInstall.expected), `expected a git dependency, got ${spec}`)
  console.log(`\nmanifest: dependency ${spec}`)

  const installed = join(profile, 'node_modules', 'dsh-config-web')
  for (const file of REQUIRED_FILES) {
    check(existsSync(join(installed, file)), `the installed package does not ship ${file}`)
  }
  const bundle = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
  const patch = bundle.dsh?.bundle?.patch
  check(patch !== undefined, 'the installed package declares no dsh.bundle.patch')
  for (const file of typeof patch === 'string' ? [patch] : patch) {
    check(existsSync(join(installed, file)), `the installed package is missing its patch file ${file}`)
  }
  console.log(`package:   ${REQUIRED_FILES.length} required files present, patch ${JSON.stringify(patch)}`)

  const status = run(process.execPath, [entry, '--dsh-home', home, '--profile', 'demo', 'status', '--quiet'])
  check(status.status === 0, `status reported the plugin as not installed (exit ${status.status})`)

  const remove = run(process.execPath, [entry, '--dsh-home', home, '--profile', 'demo', 'uninstall', '--quiet'])
  check(remove.status === 0, `uninstall exited with status ${remove.status}`)
  const after = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  check(after.dependencies?.['dsh-config-web'] === undefined, 'uninstall left the dependency behind')
  check(!after.dsh.profile.bundles.includes('dsh-config-web'), 'uninstall left the bundle layer behind')
  console.log('uninstall: dependency and layer removed')

  const again = run(process.execPath, [entry, '--dsh-home', home, '--profile', 'demo', 'status', '--quiet'])
  check(again.status === 1, `status should exit 1 once the plugin is gone, got ${again.status}`)
  console.log(`\nsmoke check passed${gitInstall === undefined ? '' : ' (git fallback)'}: install, verify, status, uninstall`)
  rmSync(home, { recursive: true, force: true })
  if (gitInstall !== undefined) rmSync(gitInstall.scratch, { recursive: true, force: true })
} catch (error) {
  process.stderr.write(`\nsmoke check failed: ${error.message}\n`)
  if (options.keep) {
    process.stderr.write(`kept the home for inspection: ${home}\n`)
    if (gitInstall !== undefined) process.stderr.write(`kept the scratch repository: ${gitInstall.scratch}\n`)
  } else {
    rmSync(home, { recursive: true, force: true })
    if (gitInstall !== undefined) rmSync(gitInstall.scratch, { recursive: true, force: true })
  }
  process.exitCode = 1
}
