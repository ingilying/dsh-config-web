/**
 * Pure planning helpers behind `dsh-config-web install`.
 *
 * Everything here is deliberately free of filesystem access: profile
 * detection, argument parsing, and manifest transformation are decisions
 * computed from values the CLI has already read, so the whole install plan
 * can be unit-tested and printed with `--dry-run` without touching a profile.
 *
 * @module dsh-config-web/plan
 */

import { isAbsolute, resolve } from 'node:path'

/** The published package name, used for registry installs and the bundle list. */
export const PACKAGE_NAME = 'dsh-config-web'

/** Exit code the CLI uses for a usage error, matching common CLI convention. */
export const EXIT_USAGE = 2

/** Names a profile may not take, because the launcher itself refuses them. */
const RESERVED_PROFILE_NAMES = new Set(['', '.', '..', 'node_modules'])

/** The profile name of the DSH Desktop application, managed by Electron rather than the CLI. */
export const DESKTOP_PROFILE = 'desktop'

/** A packed archive, which pnpm unpacks instead of linking. */
const TARBALL = /\.(?:tgz|tar\.gz)$/i

/** A refusal caused by what the caller typed rather than by the profile on disk. */
export class UsageError extends Error {
  /**
   * @param message - one sentence naming the problem and the fix.
   */
  constructor(message) {
    super(message)
    this.name = 'UsageError'
  }
}

/** The installer's own help text. */
export const HELP = `dsh-config-web — install the configurable web_fetch provider into a DSH profile

Usage
  npx dsh-config-web [install] [options]     install into a profile
  npx dsh-config-web uninstall [options]     remove it again
  npx dsh-config-web status [options]        report what the profile currently declares

Options
  -p, --profile <name>   profile under $DSH_HOME/profiles (default: auto-detect)
      --dsh-home <path>  harness home (default: $DSH_HOME, else ~/.dsh)
      --source <spec>    package spec to install; a local path is linked
                         (default: this checkout, or the published version)
      --pnpm <path>      pnpm executable (default: pnpm on PATH)
  -n, --dry-run          print the plan, change nothing
      --skip-install     edit the manifest but do not run pnpm
  -f, --force            rewrite the dependency and bundle entry even if present
      --json             machine-readable result on stdout
  -q, --quiet            errors only
  -h, --help             this text
  -V, --version          print the installer version

Examples
  npx dsh-config-web install
  npx dsh-config-web install --profile web
  node bin/install.mjs --source ./dsh-config-web-0.1.0.tgz
`

/** Flag spellings that consume the following argument. */
const VALUE_FLAGS = new Map([
  ['--profile', 'profile'],
  ['-p', 'profile'],
  ['--dsh-home', 'dshHome'],
  ['--source', 'source'],
  ['--from', 'source'],
  ['--pnpm', 'pnpm'],
])

/** Flag spellings that are simply switches. */
const BOOL_FLAGS = new Map([
  ['--dry-run', 'dryRun'],
  ['-n', 'dryRun'],
  ['--skip-install', 'skipInstall'],
  ['--no-install', 'skipInstall'],
  ['--force', 'force'],
  ['-f', 'force'],
  ['--json', 'json'],
  ['--quiet', 'quiet'],
  ['-q', 'quiet'],
  ['--help', 'help'],
  ['-h', 'help'],
  ['--version', 'version'],
  ['-V', 'version'],
])

/** Positional words that name a command. */
const COMMANDS = new Map([
  ['install', 'install'],
  ['add', 'install'],
  ['uninstall', 'uninstall'],
  ['remove', 'uninstall'],
  ['rm', 'uninstall'],
  ['status', 'status'],
  ['help', 'help'],
])

/**
 * Parse installer arguments.
 * @param argv - arguments after the node binary and script.
 * @returns the resolved options, with `command` defaulting to `install`.
 * @throws {UsageError} for an unknown flag, a missing flag value, or an unknown command.
 */
export function parseArgs(argv) {
  const options = {
    command: 'install', profile: undefined, dshHome: undefined, source: undefined, pnpm: undefined,
    dryRun: false, skipInstall: false, force: false, json: false, quiet: false, help: false, version: false,
    commandGiven: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') {
      const rest = argv.slice(index + 1)
      if (rest.length > 0) throw new UsageError(`unexpected argument ${JSON.stringify(rest[0])}`)
      break
    }
    if (argument.startsWith('-') && argument !== '-') {
      const key = VALUE_FLAGS.get(argument)
      if (key !== undefined) {
        const value = argv[index + 1]
        if (value === undefined || (value.startsWith('-') && value !== '-')) {
          throw new UsageError(`${argument} needs a value`)
        }
        options[key] = value
        index += 1
        continue
      }
      const flag = BOOL_FLAGS.get(argument)
      if (flag === undefined) throw new UsageError(`unknown option ${JSON.stringify(argument)}`)
      options[flag] = true
      continue
    }
    const command = COMMANDS.get(argument)
    if (command === undefined) throw new UsageError(`unknown command ${JSON.stringify(argument)}`)
    if (options.commandGiven) throw new UsageError(`only one command may be given, got a second: ${JSON.stringify(argument)}`)
    options.command = command
    options.commandGiven = true
  }
  if (options.help) options.command = 'help'
  if (options.version) options.command = 'version'
  if (options.command !== 'install' && options.source !== undefined) {
    throw new UsageError('--source applies to install only')
  }
  if (options.profile !== undefined) validateProfileName(options.profile)
  return options
}

/**
 * Refuse a profile name the launcher would refuse, so the installer never
 * writes a manifest the runtime cannot boot.
 * @param name - the profile name as typed.
 * @throws {UsageError} when the name is not a plain directory name.
 */
export function validateProfileName(name) {
  if (RESERVED_PROFILE_NAMES.has(name) || name.includes('/') || name.includes('\\')) {
    throw new UsageError(`invalid profile name ${JSON.stringify(name)}`)
  }
}

/**
 * Choose the profile to install into.
 *
 * An explicit `--profile` always wins. Otherwise DSH Desktop is preferred,
 * because that is the surface with a settings UI for this plugin; a home with
 * exactly one profile uses it, and anything more ambiguous asks the user to
 * choose rather than guessing.
 *
 * @param options - `explicit` profile name, if any, and the `profiles` that exist.
 * @returns the chosen profile name and a human-readable reason.
 * @throws {UsageError} when nothing exists to install into, or the choice is ambiguous.
 */
export function detectProfile({ explicit, profiles }) {
  const available = [...profiles].filter(name => !RESERVED_PROFILE_NAMES.has(name) && !name.startsWith('.'))
  if (explicit !== undefined) return { profile: explicit, reason: 'selected with --profile' }
  if (available.includes(DESKTOP_PROFILE)) return { profile: DESKTOP_PROFILE, reason: 'auto-detected the DSH Desktop profile' }
  if (available.length === 1) return { profile: available[0], reason: 'auto-detected the only profile' }
  if (available.length === 0) {
    throw new UsageError('no DSH profile found; create one with `dsh --profile <name> --from-default-profile web`, then re-run with --profile <name>')
  }
  throw new UsageError(`several profiles exist (${available.sort().join(', ')}); choose one with --profile <name>`)
}

/**
 * Decide which package spec to install.
 *
 * A source the user named is passed through: local paths become `link:`
 * specifiers so the checkout stays editable, tarballs become `file:` so pnpm
 * unpacks them, while registry names, git URLs, and remote tarballs are
 * forwarded to pnpm verbatim. With no source named, the package is linked
 * when the installer runs from a checkout and fetched from the registry when
 * it runs from inside `node_modules` (the `npx` case, where linking a
 * throwaway cache directory would be wrong).
 *
 * @param raw - the `--source` value, if any.
 * @param context - the invoking directory, this package's root, its version, and a path-existence probe.
 * @returns the spec to hand to pnpm, plus `linked` for the summary.
 * @throws {UsageError} when a named path does not exist.
 */
export function resolveSourceSpec(raw, { cwd, packageRoot, version, exists }) {
  if (raw === undefined) {
    const inPackageStore = packageRoot.split(/[/\\]/).includes('node_modules')
    return inPackageStore
      ? { spec: `${PACKAGE_NAME}@${version}`, linked: false }
      : { spec: `link:${packageRoot}`, linked: true }
  }
  const prefixed = /^(?:file|link):(.*)$/s.exec(raw)
  const candidate = prefixed === null ? raw : prefixed[1]
  const looksLikePath = prefixed !== null || isAbsolute(candidate) || candidate.startsWith('.')
  if (!looksLikePath) return { spec: raw, linked: false }
  const absolute = resolve(cwd, candidate)
  if (!exists(absolute)) throw new UsageError(`no such path: ${absolute}`)
  const tarball = TARBALL.test(absolute)
  return { spec: `${tarball ? 'file:' : 'link:'}${absolute}`, linked: !tarball }
}

/**
 * Read a manifest's `repository` field as a package spec.
 *
 * This is the fallback the installer reaches for when the registry does not
 * carry the package: `npx github:<owner>/<repo>` runs from a checkout no
 * registry ever saw, so the retry is what makes that command work before the
 * first publish — and after it, a user can still pin to a branch or tag.
 *
 * @param manifest - this package's parsed `package.json`.
 * @returns a git spec pnpm accepts, or undefined when none is declared.
 */
export function repositorySourceSpec(manifest) {
  const declared = typeof manifest?.repository === 'string' ? manifest.repository : manifest?.repository?.url
  if (typeof declared !== 'string') return undefined
  const url = declared.trim()
  return url === '' ? undefined : url
}

/** Deep-copy a parsed manifest, so planners never mutate their input. */
function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

/** Read a manifest into the shape the profile writers expect. */
function normalizeManifest(manifest) {
  return {
    ...manifest,
    dependencies: { ...(manifest.dependencies ?? {}) },
    dsh: { ...(manifest.dsh ?? {}), profile: { ...(manifest.dsh?.profile ?? {}) } },
  }
}

/**
 * Compute the manifest that declares this bundle.
 * @param manifest - the profile manifest as read.
 * @param entry - the package `name` and the pnpm `spec` to record.
 * @returns the updated manifest, whether anything changed, and what was noticed.
 */
export function planInstall(manifest, { name, spec }) {
  const next = normalizeManifest(manifest)
  const notes = []
  const declared = next.dependencies[name]
  if (declared !== undefined && declared !== spec) notes.push(`replaced dependency ${name}: ${declared} → ${spec}`)
  next.dependencies[name] = spec
  if (next.private === undefined) next.private = true
  const bundles = Array.isArray(next.dsh.profile.bundles) ? [...next.dsh.profile.bundles] : []
  if (!bundles.includes(name)) {
    bundles.push(name)
    notes.push(`appended ${name} to dsh.profile.bundles`)
  }
  next.dsh.profile.bundles = bundles
  const previous = JSON.stringify(normalizeManifest(manifest))
  return { manifest: next, changed: JSON.stringify(next) !== previous, notes }
}

/**
 * Compute the manifest that no longer declares this bundle.
 * @param manifest - the profile manifest as read.
 * @param name - the package to drop.
 * @returns the updated manifest, whether anything changed, and what was noticed.
 */
export function planUninstall(manifest, name) {
  const next = normalizeManifest(manifest)
  const notes = []
  if (next.dependencies[name] !== undefined) {
    delete next.dependencies[name]
    notes.push(`removed dependency ${name}`)
  }
  const bundles = Array.isArray(next.dsh.profile.bundles) ? next.dsh.profile.bundles : []
  const kept = bundles.filter(bundle => bundle !== name)
  if (kept.length !== bundles.length) notes.push(`removed ${name} from dsh.profile.bundles`)
  next.dsh.profile.bundles = kept
  const previous = JSON.stringify(normalizeManifest(manifest))
  return { manifest: next, changed: JSON.stringify(next) !== previous, notes }
}

/**
 * Read a bundle package's `dsh.bundle.patch` declaration.
 * @param bundleManifest - the installed package's parsed `package.json`.
 * @returns the declared patch files, and a problem sentence when the declaration is unusable.
 */
export function readBundlePatch(bundleManifest) {
  const bundle = bundleManifest?.dsh?.bundle
  if (bundle === undefined || bundle === null) {
    return { files: [], problem: 'the package declares no dsh.bundle, so a profile layer would never be applied' }
  }
  const declared = typeof bundle.patch === 'string' ? [bundle.patch] : bundle.patch
  if (!Array.isArray(declared) || declared.length === 0 || !declared.every(file => typeof file === 'string')) {
    return { files: [], problem: 'dsh.bundle.patch must be a file path or a list of file paths' }
  }
  return { files: declared }
}

/** Render a manifest the way the profile writer stores it. */
export function formatManifest(manifest) {
  return `${JSON.stringify(manifest, undefined, 2)}\n`
}

/**
 * Report whether a profile already declares this bundle.
 * @param manifest - the profile manifest as read.
 * @param name - the package to look for.
 * @returns the recorded dependency spec, and whether the bundle list names it.
 */
export function readInstalledState(manifest, name) {
  const spec = manifest?.dependencies?.[name]
  const bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
  return { spec, listed: bundles.includes(name), bundles }
}

/** Wrap text in ANSI colour when the caller asked for colour. */
export function paint(text, code, enabled) {
  return enabled ? `\u001b[${code}m${text}\u001b[0m` : text
}
