import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// The installer is deliberately dependency-free plain ESM so `npx` can run it
// without a build step; the tests import the same files it ships.
import {
  UsageError, detectProfile, formatManifest, parseArgs, planInstall, planUninstall,
  readBundlePatch, readInstalledState, repositorySourceSpec, resolveSourceSpec,
} from '../bin/plan.mjs'

const installer = resolve(import.meta.dirname, '../bin/install.mjs')

const temporary: string[] = []

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Create an isolated harness home with the named profiles, each holding a minimal manifest. */
function makeHome(profiles: Record<string, unknown>): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-config-web-test-'))
  temporary.push(home)
  for (const [name, manifest] of Object.entries(profiles)) {
    const dir = join(home, 'profiles', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
  }
  return home
}

const profileManifest = (bundles: string[] = ['@deepseek-ai/dsh-base'], dependencies: Record<string, string> = {}) =>
  ({ name: 'dsh-profile-test', private: true, dependencies, dsh: { profile: { bundles } } })

/** Run the installer CLI and capture its output. */
function runInstaller(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [installer, ...args], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('parseArgs', () => {
  it('defaults to install with nothing to change', () => {
    expect(parseArgs([])).toMatchObject({ command: 'install', dryRun: false, force: false })
  })

  it('accepts a command, value flags, and switches in any order', () => {
    const options = parseArgs(['uninstall', '--profile', 'web', '--dsh-home', '/tmp/home', '-n', '--json'])
    expect(options).toMatchObject({ command: 'uninstall', profile: 'web', dshHome: '/tmp/home', dryRun: true, json: true })
  })

  it('treats --help and --version as their own commands', () => {
    expect(parseArgs(['--help']).command).toBe('help')
    expect(parseArgs(['--version']).command).toBe('version')
  })

  it('rejects unknown options, unknown commands, and a valueless flag', () => {
    expect(() => parseArgs(['--nope'])).toThrow(UsageError)
    expect(() => parseArgs(['frobnicate'])).toThrow(/unknown command/)
    expect(() => parseArgs(['--profile'])).toThrow(/needs a value/)
    expect(() => parseArgs(['--source', './x'])).not.toThrow()
    expect(() => parseArgs(['status', '--source', './x'])).toThrow(/applies to install only/)
  })

  it('refuses a second command and a traversal-capable profile name', () => {
    expect(() => parseArgs(['install', 'status'])).toThrow(/only one command/)
    expect(() => parseArgs(['--profile', '../evil'])).toThrow(/invalid profile name/)
    expect(() => parseArgs(['--profile', 'node_modules'])).toThrow(/invalid profile name/)
  })
})

describe('detectProfile', () => {
  it('prefers an explicit profile', () => {
    expect(detectProfile({ explicit: 'web', profiles: ['desktop', 'web'] })).toMatchObject({ profile: 'web' })
  })

  it('prefers DSH Desktop, which the dsh CLI itself refuses to manage', () => {
    expect(detectProfile({ explicit: undefined, profiles: ['desktop', 'web', 'dsh-tui'] }))
      .toMatchObject({ profile: 'desktop' })
  })

  it('uses the only profile, ignoring the shared node_modules directory', () => {
    expect(detectProfile({ explicit: undefined, profiles: ['node_modules', 'web'] })).toMatchObject({ profile: 'web' })
  })

  it('asks the user to choose when several profiles exist, and to create one when none do', () => {
    expect(() => detectProfile({ explicit: undefined, profiles: ['alpha', 'beta'] })).toThrow(/choose one with --profile/)
    expect(() => detectProfile({ explicit: undefined, profiles: ['node_modules'] })).toThrow(/no DSH profile found/)
  })
})

describe('resolveSourceSpec', () => {
  // Built through the platform's own path rules: on Windows `resolve('/work', …)`
  // lands on the current drive, so hardcoded POSIX expectations are wrong there.
  const cwd = resolve('/', 'work')
  const context = { cwd, packageRoot: resolve(cwd, 'checkout'), version: '1.2.3', exists: () => true }

  it('links a checkout and fetches from the registry inside node_modules', () => {
    expect(resolveSourceSpec(undefined, context)).toEqual({ spec: `link:${context.packageRoot}`, linked: true })
    expect(resolveSourceSpec(undefined, { ...context, packageRoot: resolve('/', 'cache/node_modules/dsh-config-web') }))
      .toEqual({ spec: 'dsh-config-web@1.2.3', linked: false })
  })

  it('anchors a named path and unpacks a tarball instead of linking it', () => {
    expect(resolveSourceSpec('./plugin', context)).toEqual({ spec: `link:${resolve(cwd, 'plugin')}`, linked: true })
    expect(resolveSourceSpec('/abs/plugin', context)).toEqual({ spec: `link:${resolve(cwd, '/abs/plugin')}`, linked: true })
    expect(resolveSourceSpec('file:./dsh-config-web-0.1.0.tgz', context))
      .toEqual({ spec: `file:${resolve(cwd, 'dsh-config-web-0.1.0.tgz')}`, linked: false })
  })

  it('passes registry names, git specs, and remote tarballs through verbatim', () => {
    for (const spec of ['dsh-config-web@0.2.0', 'github:owner/dsh-config-web', 'https://example.com/p.tgz']) {
      expect(resolveSourceSpec(spec, context)).toEqual({ spec, linked: false })
    }
  })

  it('rejects a path that does not exist', () => {
    expect(() => resolveSourceSpec('./missing', { ...context, exists: () => false })).toThrow(/no such path/)
  })
})

describe('repositorySourceSpec', () => {
  it('reads an object and a shorthand repository URL', () => {
    expect(repositorySourceSpec({ repository: { type: 'git', url: 'git+https://github.com/o/r.git' } }))
      .toBe('git+https://github.com/o/r.git')
    expect(repositorySourceSpec({ repository: 'github:o/r' })).toBe('github:o/r')
  })

  it('answers undefined when no usable repository is declared', () => {
    expect(repositorySourceSpec({})).toBeUndefined()
    expect(repositorySourceSpec({ repository: { type: 'git' } })).toBeUndefined()
    expect(repositorySourceSpec({ repository: '   ' })).toBeUndefined()
  })
})

describe('planInstall', () => {
  it('declares the dependency and appends the bundle layer', () => {
    const { manifest, changed, notes } = planInstall(profileManifest(), { name: 'dsh-config-web', spec: 'link:/w/plugin' })
    expect(changed).toBe(true)
    expect(manifest.dependencies).toEqual({ 'dsh-config-web': 'link:/w/plugin' })
    expect(manifest.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', 'dsh-config-web'])
    expect(notes.join(' ')).toMatch(/appended dsh-config-web/)
  })

  it('never mutates its input', () => {
    const before = profileManifest()
    planInstall(before, { name: 'dsh-config-web', spec: 'link:/w/plugin' })
    expect(before.dependencies).toEqual({})
    expect(before.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base'])
  })

  it('is idempotent and preserves unrelated profile settings', () => {
    const installed = profileManifest(['@deepseek-ai/dsh-base', 'dsh-config-web'], { 'dsh-config-web': 'link:/w/plugin' })
    const withSettings = { ...installed, dsh: { profile: { ...installed.dsh.profile, patchReload: 'live' } } }
    const again = planInstall(withSettings, { name: 'dsh-config-web', spec: 'link:/w/plugin' })
    expect(again.changed).toBe(false)
    expect(again.manifest.dsh.profile.patchReload).toBe('live')
    expect(again.manifest.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', 'dsh-config-web'])
  })

  it('reports replacing a dependency recorded at a different spec', () => {
    const stale = profileManifest(['@deepseek-ai/dsh-base', 'dsh-config-web'], { 'dsh-config-web': 'link:/old' })
    const plan = planInstall(stale, { name: 'dsh-config-web', spec: 'link:/new' })
    expect(plan.manifest.dependencies['dsh-config-web']).toBe('link:/new')
    expect(plan.notes.join(' ')).toMatch(/replaced dependency/)
  })

  it('creates the bundle list when the manifest has none', () => {
    const plan = planInstall({ name: 'x' }, { name: 'dsh-config-web', spec: 'link:/w' })
    expect(plan.manifest.dsh.profile.bundles).toEqual(['dsh-config-web'])
    expect(plan.manifest.private).toBe(true)
  })
})

describe('planUninstall', () => {
  it('drops both the dependency and the layer', () => {
    const installed = profileManifest(['@deepseek-ai/dsh-base', 'dsh-config-web'], { 'dsh-config-web': 'link:/w' })
    const plan = planUninstall(installed, 'dsh-config-web')
    expect(plan.changed).toBe(true)
    expect(plan.manifest.dependencies).toEqual({})
    expect(plan.manifest.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base'])
  })

  it('changes nothing when the plugin is absent', () => {
    expect(planUninstall(profileManifest(), 'dsh-config-web').changed).toBe(false)
  })
})

describe('readBundlePatch', () => {
  it('reads a single patch file and a list', () => {
    expect(readBundlePatch({ dsh: { bundle: { patch: './cordis.patch.yml' } } }))
      .toEqual({ files: ['./cordis.patch.yml'] })
    expect(readBundlePatch({ dsh: { bundle: { patch: ['./a.yml', './b.yml'] } } }).files)
      .toEqual(['./a.yml', './b.yml'])
  })

  it('explains a missing or malformed declaration', () => {
    expect(readBundlePatch({}).problem).toMatch(/declares no dsh.bundle/)
    expect(readBundlePatch({ dsh: { bundle: { patch: [] } } }).problem).toMatch(/must be a file path/)
  })
})

describe('readInstalledState', () => {
  it('reports what the profile declares', () => {
    const manifest = profileManifest(['@deepseek-ai/dsh-base', 'dsh-config-web'], { 'dsh-config-web': 'link:/w' })
    expect(readInstalledState(manifest, 'dsh-config-web')).toEqual({ spec: 'link:/w', listed: true, bundles: manifest.dsh.profile.bundles })
    expect(readInstalledState({}, 'dsh-config-web')).toEqual({ spec: undefined, listed: false, bundles: [] })
  })
})

describe('formatManifest', () => {
  it('writes two-space JSON with a trailing newline', () => {
    expect(formatManifest({ a: 1 })).toBe('{\n  "a": 1\n}\n')
  })
})

describe('installer CLI', () => {
  it('installs into the detected profile and is safe to re-run', () => {
    const home = makeHome({ web: profileManifest() })
    const first = runInstaller(['--dsh-home', home, '--skip-install'])
    expect(first.status).toBe(0)
    const manifest = JSON.parse(readFileSync(join(home, 'profiles', 'web', 'package.json'), 'utf8'))
    expect(manifest.dsh.profile.bundles).toContain('dsh-config-web')
    expect(manifest.dependencies['dsh-config-web']).toMatch(/^link:/)

    const second = runInstaller(['--dsh-home', home, '--skip-install'])
    expect(second.status).toBe(0)
    expect(JSON.parse(readFileSync(join(home, 'profiles', 'web', 'package.json'), 'utf8'))).toEqual(manifest)
  })

  it('leaves the profile untouched on --dry-run', () => {
    const home = makeHome({ web: profileManifest() })
    const before = readFileSync(join(home, 'profiles', 'web', 'package.json'), 'utf8')
    expect(runInstaller(['--dsh-home', home, '--dry-run']).status).toBe(0)
    expect(readFileSync(join(home, 'profiles', 'web', 'package.json'), 'utf8')).toBe(before)
  })

  it('writes nothing under the profile write lock', () => {
    const home = makeHome({ web: profileManifest() })
    expect(runInstaller(['--dsh-home', home, '--skip-install']).status).toBe(0)
    expect(() => readFileSync(join(home, 'profiles', 'web', 'package.json.lock'), 'utf8')).toThrow()
  })

  it('reports status, then uninstalls, then reports not installed', () => {
    const home = makeHome({ web: profileManifest() })
    expect(runInstaller(['--dsh-home', home, '--skip-install']).status).toBe(0)
    expect(runInstaller(['--dsh-home', home, 'status']).status).toBe(0)

    const removed = runInstaller(['--dsh-home', home, 'uninstall', '--skip-install'])
    expect(removed.status).toBe(0)
    const manifest = JSON.parse(readFileSync(join(home, 'profiles', 'web', 'package.json'), 'utf8'))
    expect(manifest.dependencies).toEqual({})
    expect(manifest.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base'])
    expect(runInstaller(['--dsh-home', home, 'status']).status).toBe(1)
  })

  it('emits parseable JSON and keeps stdout clean', () => {
    const home = makeHome({ web: profileManifest() })
    const result = runInstaller(['--dsh-home', home, '--skip-install', '--json'])
    expect(result.status).toBe(0)
    const report = JSON.parse(result.stdout)
    expect(report).toMatchObject({ ok: true, command: 'install', profile: 'web' })
  })

  it('exits 2 with guidance when the profile is not initialized', () => {
    const home = makeHome({ web: profileManifest() })
    mkdirSync(join(home, 'profiles', 'fresh'))
    const result = runInstaller(['--dsh-home', home, '--profile', 'fresh', '--skip-install'])
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/--from-default-profile/)
  })

  // Windows cannot execute a `.mjs` path directly, and creating the symlink
  // needs a privilege CI runners do not have; `npx` resolves the real path there.
  it.skipIf(process.platform === 'win32')('runs when invoked through the bin symlink a package manager creates', () => {
    const home = makeHome({ web: profileManifest() })
    const link = join(home, 'dsh-config-web')
    symlinkSync(installer, link)
    const result = spawnSync(link, ['--dsh-home', home, '--skip-install'], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(JSON.parse(readFileSync(join(home, 'profiles', 'web', 'package.json'), 'utf8'))
      .dsh.profile.bundles).toContain('dsh-config-web')
  })
})
