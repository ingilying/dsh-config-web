#!/usr/bin/env node
/**
 * One-command installer for the `dsh-config-web` DSH plugin.
 *
 * `dsh plugin --profile <name> add <spec>` already installs and activates a
 * bundle, but it cannot reach the DSH Desktop profile (the launcher reserves
 * that name for Electron) and it needs the package to be resolvable from a
 * registry. This script writes the same two things that command writes — the
 * profile's `dependencies` entry and its `dsh.profile.bundles` layer list —
 * for any profile, from a registry, a tarball, or a local checkout, and then
 * verifies the installed bundle before reporting success.
 *
 * It depends on nothing but Node's standard library, so it runs straight from
 * an `npx` cache or a fresh clone with no build step.
 *
 * @module dsh-config-web/install
 */

import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  DESKTOP_PROFILE, EXIT_USAGE, HELP, PACKAGE_NAME, UsageError, detectProfile, formatManifest,
  paint, parseArgs, planInstall, planUninstall, readBundlePatch, readInstalledState, repositorySourceSpec, resolveSourceSpec,
} from './plan.mjs'

/** Exit code for a failed operation, as opposed to a usage error. */
const EXIT_FAILURE = 1

/** Windows needs a shell to start pnpm's `.cmd` shim; POSIX must not have one. */
const WINDOWS = process.platform === 'win32'

/** How long to wait for another writer (the running DSH) to release the profile manifest. */
const LOCK_WAIT_MS = 180_000

/** A lock older than this, whose owner is gone, is treated as abandoned. */
const LOCK_STALE_MS = 30_000

/** This package's own manifest, read for its name and version. */
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const packageManifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))

/** Collected output for one run, so `--json` can report the whole result. */
const report = { ok: false, command: 'install', warnings: [], actions: [], nextSteps: [] }

let colour = false
let quiet = false

/** Print an informational line to stdout. */
function info(text) {
  if (!quiet) process.stdout.write(`${text}\n`)
}

/** Print a warning, collected for `--json` too. */
function warn(text) {
  report.warnings.push(text)
  if (!quiet) process.stderr.write(`${paint('warning:', '33', colour)} ${text}\n`)
}

/** Print an error. */
function fail(text) {
  process.stderr.write(`${paint('error:', '31', colour)} ${text}\n`)
}

/** Print an action the installer took. */
function action(text) {
  report.actions.push(text)
  info(`  ${paint('•', '36', colour)} ${text}`)
}

/** Resolve the harness home exactly as the launcher does: flag, `$DSH_HOME`, then `~/.dsh`. */
function resolveHome(configured) {
  const fromEnv = process.env.DSH_HOME
  const selected = configured ?? (fromEnv !== undefined && fromEnv.trim() !== '' ? fromEnv : join(homedir(), '.dsh'))
  return resolve(selected.startsWith('~/') ? join(homedir(), selected.slice(2)) : selected)
}

/** List the profile directories under a harness home. */
function listProfiles(home) {
  const root = join(home, 'profiles')
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
    .map(entry => entry.name)
}

/** Read a JSON file, or undefined when it is absent. */
function readJson(path) {
  if (!existsSync(path)) return undefined
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** Write a file atomically, with the private mode the profile writer uses. */
function writeAtomic(path, contents) {
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, contents, { mode: 0o600 })
  renameSync(temporary, path)
}

/** Whether a lock file's recorded process is still alive. */
function lockOwnerAlive(lockPath) {
  let pid
  try {
    pid = Number.parseInt(readFileSync(lockPath, 'utf8').trim(), 10)
  } catch {
    return true
  }
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return error.code === 'EPERM'
  }
}

/** Drop a lock whose owner is gone, so a crashed writer cannot block installs forever. */
function clearStaleLock(lockPath) {
  try {
    if (Date.now() - statSync(lockPath).mtimeMs < LOCK_STALE_MS) return
    if (lockOwnerAlive(lockPath)) return
    rmSync(lockPath, { force: true })
    warn(`cleared an abandoned lock at ${lockPath}`)
  } catch {
    // A racing writer removed it first; nothing to do.
  }
}

/**
 * Run an operation while holding the same `package.json.lock` the DSH plugin
 * manager takes, so a running app and this script never interleave manifest
 * writes.
 * @param lockPath - the lock file to create exclusively.
 * @param operation - the work to run under the lock.
 * @returns whatever the operation returned.
 */
async function withLock(lockPath, operation) {
  const deadline = Date.now() + LOCK_WAIT_MS
  let delay = 40
  for (;;) {
    try {
      writeFileSync(lockPath, `${process.pid}\n`, { mode: 0o600, flag: 'wx' })
      break
    } catch (error) {
      if (error.code === 'EACCES' || error.code === 'EPERM') {
        throw new Error(`cannot write to ${dirname(lockPath)} (${error.code}); check that your user owns the profile directory`)
      }
      if (error.code !== 'EEXIST') throw error
      clearStaleLock(lockPath)
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for the profile write lock at ${lockPath}; close DSH Desktop and retry`)
    }
    await new Promise(resolve => setTimeout(resolve, delay))
    delay = Math.min(delay * 2, 1_000)
  }
  try {
    return await operation()
  } finally {
    rmSync(lockPath, { force: true })
  }
}

/** Locate pnpm, preferring the `--pnpm` override. */
function resolvePnpm(configured) {
  const candidates = configured === undefined ? ['pnpm'] : [configured]
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { stdio: 'ignore', shell: WINDOWS })
    if (probe.error === undefined && probe.status === 0) return candidate
  }
  return undefined
}

/**
 * Run pnpm inside the profile directory, streaming its output to the user.
 *
 * Windows can only start pnpm's `.cmd` shim through a shell, and a shell joins
 * arguments without quoting, so each argument is quoted there — a linked
 * checkout under `C:\Users\Some Name\...` would otherwise split in two.
 */
function runPnpm(pnpm, profileDir, args) {
  info(`  ${paint('$', '90', colour)} pnpm ${args.join(' ')}   ${paint(`(in ${profileDir})`, '90', colour)}`)
  const invocation = WINDOWS ? args.map(argument => (/[\s"]/.test(argument) ? `"${argument.replaceAll('"', '\\"')}"` : argument)) : args
  const result = spawnSync(pnpm, invocation, { cwd: profileDir, stdio: 'inherit', shell: WINDOWS })
  if (result.error !== undefined) throw new Error(`could not run pnpm: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`pnpm ${args.join(' ')} exited with status ${result.status}`)
}

/**
 * Confirm the installed package really is a bundle: it exists in the profile,
 * declares `dsh.bundle.patch`, and ships every file that declaration names.
 * @param profileDir - the profile directory.
 * @returns the resolved bundle directory and its patch files.
 */
function verifyInstalled(profileDir) {
  const bundleDir = join(profileDir, 'node_modules', PACKAGE_NAME)
  if (!existsSync(bundleDir)) throw new Error(`${PACKAGE_NAME} is not installed in ${profileDir}; pnpm did not link it`)
  const manifest = readJson(join(bundleDir, 'package.json'))
  if (manifest === undefined) throw new Error(`${bundleDir}/package.json is missing`)
  const { files, problem } = readBundlePatch(manifest)
  if (problem !== undefined) throw new Error(problem)
  const missing = files.filter(file => !existsSync(join(bundleDir, file)))
  if (missing.length > 0) throw new Error(`the bundle patch is missing from the package: ${missing.join(', ')}`)
  return { bundleDir, patchFiles: files }
}

/** The lines telling the user how to make the new layer take effect. */
function nextSteps(profile) {
  return [
    profile === DESKTOP_PROFILE
      ? 'Quit and reopen DSH Desktop so the profile layers are composed again.'
      : `Restart the running profile (or start it with: dsh --profile ${profile}).`,
    'Then toggle the provider in Settings → Web Fetch Network Policy, or leave it on by default as configured.',
  ]
}

/**
 * Install the package, falling back to its own repository when the registry
 * has no copy. `npx github:<owner>/<repo> install` runs this installer from a
 * checkout the registry never saw, so the retry is what makes that command
 * work before the first publish.
 *
 * @param pnpm - the pnpm executable.
 * @param profileDir - the profile to install into.
 * @param spec - the registry or path spec to try first.
 * @param fallback - the repository spec to retry with, when the first fails.
 * @returns the spec pnpm actually recorded.
 */
async function addDependency(pnpm, profileDir, spec, fallback) {
  try {
    await runPnpm(pnpm, profileDir, ['add', spec])
    action(`installed ${spec}`)
    return spec
  } catch (error) {
    if (fallback === undefined || fallback === spec) throw error
    warn(`${spec} is not installable (${error.message}); retrying from the repository instead`)
    await runPnpm(pnpm, profileDir, ['add', fallback])
    action(`installed ${fallback}`)
    return fallback
  }
}

/** Install (or refresh) the plugin in one profile. */
async function install(options, context) {
  const { home, pnpm, profiles } = context
  const { profile, reason } = detectProfile({ explicit: options.profile, profiles })
  const profileDir = join(home, 'profiles', profile)
  report.profile = profile
  report.profileDir = profileDir
  report.profileReason = reason
  info(`${paint('dsh-config-web', '1', colour)} ${packageManifest.version} → profile ${paint(profile, '1', colour)} ${paint(`(${reason})`, '90', colour)}`)

  const manifestPath = join(profileDir, 'package.json')
  const existingManifest = readJson(manifestPath)
  if (existingManifest === undefined) {
    throw new UsageError(`profile ${profile} is not initialized at ${profileDir}; create it first with: dsh --profile ${profile} --from-default-profile web`)
  }

  const { spec, linked } = resolveSourceSpec(options.source, {
    cwd: process.cwd(), packageRoot, version: packageManifest.version, exists: existsSync,
  })
  // Only a spec this script chose may be second-guessed: an explicit --source
  // failing is the user's answer, not a reason to install something else.
  const fallback = options.source === undefined ? repositorySourceSpec(packageManifest) : undefined
  report.source = spec
  const state = readInstalledState(existingManifest, PACKAGE_NAME)
  const current = state.spec === spec && state.listed

  if (options.dryRun) {
    const plan = planInstall(existingManifest, { name: PACKAGE_NAME, spec })
    info('')
    info(`${paint('dry run', '33', colour)} — nothing was changed. Planned profile manifest:`)
    info(formatManifest(plan.manifest).trimEnd())
    report.ok = true
    report.changed = plan.changed
    return
  }

  if (current && !options.force) {
    info(`  ${paint('•', '36', colour)} already declared as ${spec} — refreshing nothing`)
  }

  await withLock(`${manifestPath}.lock`, async () => {
    let recorded = spec
    if (!current || options.force) {
      if (!options.skipInstall) {
        recorded = await addDependency(pnpm, profileDir, spec, fallback)
        report.source = recorded
      } else {
        warn('--skip-install: the dependency was declared but not fetched; run `pnpm install` in the profile before booting')
      }
    }
    // pnpm owns the dependency entry, so re-read the manifest it just wrote and
    // only add the bundle layer on top of it.
    const manifest = readJson(manifestPath)
    const plan = planInstall(manifest, { name: PACKAGE_NAME, spec: manifest.dependencies?.[PACKAGE_NAME] ?? recorded })
    if (plan.changed) {
      writeAtomic(manifestPath, formatManifest(plan.manifest))
      for (const note of plan.notes) action(note)
    } else {
      action(`profile manifest already declares ${PACKAGE_NAME}`)
    }
    report.changed = plan.changed
    report.bundles = plan.manifest.dsh.profile.bundles
  })

  if (!options.skipInstall) {
    const { patchFiles } = verifyInstalled(profileDir)
    report.installed = true
    action(`verified bundle layer ${patchFiles.join(', ')}`)
  }
  report.linked = linked
  report.ok = true
  report.nextSteps = nextSteps(profile)
}

/** Remove the plugin from one profile. */
async function uninstall(options, context) {
  const { home, pnpm, profiles } = context
  const { profile, reason } = detectProfile({ explicit: options.profile, profiles })
  const profileDir = join(home, 'profiles', profile)
  const manifestPath = join(profileDir, 'package.json')
  report.profile = profile
  report.profileDir = profileDir
  report.profileReason = reason
  info(`${paint('dsh-config-web', '1', colour)} ← profile ${paint(profile, '1', colour)} ${paint(`(${reason})`, '90', colour)}`)
  const manifest = readJson(manifestPath)
  if (manifest === undefined) throw new UsageError(`profile ${profile} is not initialized at ${profileDir}`)
  const state = readInstalledState(manifest, PACKAGE_NAME)
  if (state.spec === undefined && !state.listed) {
    info(`  ${paint('•', '36', colour)} ${PACKAGE_NAME} is not installed; nothing to do`)
    report.ok = true
    report.changed = false
    return
  }
  if (options.dryRun) {
    info('')
    info(`${paint('dry run', '33', colour)} — nothing was changed. Planned profile manifest:`)
    info(formatManifest(planUninstall(manifest, PACKAGE_NAME)).trimEnd())
    report.ok = true
    report.changed = true
    return
  }
  await withLock(`${manifestPath}.lock`, async () => {
    if (state.spec !== undefined && !options.skipInstall) {
      await runPnpm(pnpm, profileDir, ['remove', PACKAGE_NAME])
      action(`removed the ${PACKAGE_NAME} dependency`)
    }
    const reloaded = readJson(manifestPath)
    const plan = planUninstall(reloaded, PACKAGE_NAME)
    if (plan.changed) {
      writeAtomic(manifestPath, formatManifest(plan.manifest))
      for (const note of plan.notes) action(note)
    }
    report.changed = plan.changed
    report.bundles = plan.manifest.dsh.profile.bundles
  })
  report.ok = true
  report.nextSteps = [profile === DESKTOP_PROFILE
    ? 'Quit and reopen DSH Desktop to drop the layer.'
    : `Restart the profile (dsh --profile ${profile}) to drop the layer.`]
}

/** Report what a profile currently declares, changing nothing. */
async function status(options, context) {
  const { profile, reason } = detectProfile({ explicit: options.profile, profiles: context.profiles })
  const profileDir = join(context.home, 'profiles', profile)
  const manifest = readJson(join(profileDir, 'package.json'))
  const state = readInstalledState(manifest ?? {}, PACKAGE_NAME)
  const active = state.spec !== undefined && state.listed
  info(`${paint('dsh-config-web', '1', colour)} in profile ${paint(profile, '1', colour)} ${paint(`(${reason})`, '90', colour)}`)
  action(`profile directory: ${profileDir}`)
  action(`dependency: ${state.spec ?? 'not declared'}`)
  action(`bundle layer: ${state.listed ? 'listed in dsh.profile.bundles' : 'not listed'}`)
  if (active) {
    try {
      const { patchFiles } = verifyInstalled(profileDir)
      action(`installed bundle verified (${patchFiles.join(', ')})`)
    } catch (error) {
      warn(error.message)
    }
  }
  report.profile = profile
  report.profileDir = profileDir
  report.installed = active
  report.bundles = state.bundles
  report.ok = true
  if (!active) report.nextSteps = ['Install it with: npx dsh-config-web install']
  return active ? 0 : EXIT_FAILURE
}

/** Run the resolved command, mapping failures onto exit codes. */
async function main(argv) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    fail(error.message)
    process.stderr.write(`run \`${PACKAGE_NAME} --help\` for usage\n`)
    return EXIT_USAGE
  }
  colour = process.stdout.isTTY === true && process.env.NO_COLOR === undefined
  // `--json` owns stdout, so progress narration is suppressed; warnings keep
  // going to stderr and into the report.
  quiet = options.quiet === true || options.json === true
  if (options.command === 'help') {
    process.stdout.write(HELP)
    return 0
  }
  if (options.command === 'version') {
    process.stdout.write(`${packageManifest.version}\n`)
    return 0
  }
  report.command = options.command
  try {
    const home = resolveHome(options.dshHome)
    report.dshHome = home
    const profiles = listProfiles(home)
    const pnpm = options.dryRun || options.skipInstall || options.command === 'status'
      ? undefined
      : resolvePnpm(options.pnpm)
    if (pnpm === undefined && !options.dryRun && !options.skipInstall && options.command !== 'status') {
      fail('pnpm was not found on PATH; install it (https://pnpm.io/installation) or pass --pnpm <path>')
      return EXIT_FAILURE
    }
    const context = { home, profiles, pnpm }
    const code = options.command === 'uninstall'
      ? await uninstall(options, context)
      : options.command === 'status' ? await status(options, context) : await install(options, context)
    if (code !== undefined && code !== 0) {
      if (options.json) process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`)
      return code
    }
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`)
      return 0
    }
    if (!quiet) {
      process.stdout.write(`\n${paint('✓', '32', colour)} ${report.command} complete\n`)
      for (const step of report.nextSteps) process.stdout.write(`  ${step}\n`)
    }
    return 0
  } catch (error) {
    if (error instanceof UsageError) {
      fail(error.message)
      return EXIT_USAGE
    }
    fail(error instanceof Error ? error.message : String(error))
    report.error = error instanceof Error ? error.message : String(error)
    if (options.json) process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`)
    return EXIT_FAILURE
  }
}

// `install.sh` and the `npx` shim both land here; importing this module in a
// test must not run anything. Both sides are resolved through their real
// paths, because a package manager invokes `bin` through a symlink while
// `import.meta.url` is already canonical.
const invokedDirectly = (() => {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()

if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2))
}

export { install, listProfiles, main, resolveHome, uninstall }
