# dsh-config-web

DeepSeek Harness (DSH) plugin that registers a configurable HTTP(S) `WebFetchProvider` for the `web_fetch` tool, with an optional `allowPrivateNetworks` switch to reach localhost, intranet, and private APIs.

## Overview

By default, `@deepseek-ai/dsh-web-fetch-http` blocks any URL whose hostname resolves to a private, loopback, or otherwise non-public IP address (SSRF defense):

```
URL hostname "..." resolves to a non-public IP address (WEB_BLOCKED_URL)
```

`dsh-config-web` wraps that provider and adds configuration for:

- **`allowPrivateNetworks`** — opt-in bypass so `web_fetch` can call `127.0.0.1`, `10.0.0.0/8`, `192.168.0.0/16`, `::1`, link-local, and other non-public addresses
- **Fetch limits** — response size, body length, timeout, redirect hops, and `User-Agent`

The plugin is two-sided:

| Side | Entry | Role |
|---|---|---|
| Host (Node) | `src/index.ts` | Registers the provider into `ctx.web`, persists state, mounts HTTP API |
| Client (browser) | `src/client/index.ts` | Renders toggle UI in DSH Desktop settings / plugin manager |

Fetching itself is still performed by the stock `HttpFetchProvider`; this plugin only supplies a custom DNS resolution policy (via `ipaddr.js`) and live-togglable limits.

## Features

- One-command install into any DSH profile, DSH Desktop included (`npx dsh-config-web install`)
- Configurable `web_fetch` limits (`maxResponseBytes`, `maxBodyChars`, `timeoutMs`, `maxRedirects`, `userAgent`)
- `allowPrivateNetworks` toggle — applies **live**, without recreating the provider
- Auto-activates via bundle patch (`cordis.patch.yml`) once the profile lists the package
- Runtime toggle from the DSH Desktop settings UI, under **Settings → Plugins → Configurable** (English / 中文)
- Persisted toggle state in `$DSH_HOME/dsh-config-web.json` (survives restarts, overrides YAML)
- Small HTTP API for external control (`GET /state`, `POST /toggle`)
- IPv4 + IPv6 aware; handles IPv4-mapped IPv6 addresses; DNS lookups respect `AbortSignal`

## Installation

### One command

```bash
npx --yes github:ingilying/dsh-config-web install
```

That works today, without waiting for an npm publish: npx fetches the repository, and the installer records the same repository spec in your profile. Once the package is on npm, the shorter form works too, and records a versioned registry dependency instead:

```bash
npx --yes dsh-config-web install
```

Other routes, in decreasing order of convenience:

```bash
curl -fsSL https://raw.githubusercontent.com/ingilying/dsh-config-web/main/install.sh | bash
git clone https://github.com/ingilying/dsh-config-web.git && cd dsh-config-web && ./install.sh
./install.sh --source ./dsh-config-web-0.1.0.tgz        # a release asset or `pnpm pack` output
```

Whichever you run, the installer finds your DSH profile, records `dsh-config-web` in its `dependencies`, appends it to `dsh.profile.bundles`, runs `pnpm` inside the profile, and then verifies that the installed bundle really ships the patch layer it declares. It holds the same `package.json.lock` the running app uses, so it will not interleave with a plugin install happening in DSH Desktop. Re-running is a no-op; `uninstall` reverses everything.

If the registry has no copy of the package — the situation before the first publish — the installer retries once from the repository declared in `package.json`, which is exactly what makes `npx github:…` work. CI runs that fallback on every push, against a throwaway git repository.

Restart DSH Desktop (or the profile) afterwards so the layer is composed.

#### Installer options

| Flag | Meaning |
|---|---|
| `-p, --profile <name>` | profile under `$DSH_HOME/profiles` (default: auto-detected — DSH Desktop when present, else the only profile) |
| `--dsh-home <path>` | harness home (default: `$DSH_HOME`, else `~/.dsh`) |
| `--source <spec>` | package spec to install; a local path is linked, a `.tgz` is unpacked, anything else goes to pnpm verbatim |
| `--pnpm <path>` | pnpm executable (default: `pnpm` on `PATH`) |
| `-n, --dry-run` | print the planned manifest and change nothing |
| `--skip-install` | edit the manifest without running pnpm |
| `-f, --force` | re-resolve and rewrite even when the profile already declares it |
| `--json` | machine-readable result on stdout |
| `-q, --quiet` | errors only |

Other subcommands: `status` reports what the profile currently declares (exit code `1` when not installed), `uninstall` removes the dependency and the layer, `--help` lists everything.

```bash
./install.sh status                 # or: npx dsh-config-web status
./install.sh uninstall
./install.sh install --profile web --dry-run
```

The piped form takes `DSH_CONFIG_WEB_FROM` to fetch something other than the default branch, for example `DSH_CONFIG_WEB_FROM=dsh-config-web@1.2.3` once the package is published.

> **Why not `dsh plugin add`?** `dsh plugin --profile <name> add dsh-config-web` performs the same two profile edits and is the command to prefer once this package is on a registry. It refuses `--profile desktop`, which the launcher reserves for the Electron app, and it cannot install an unpublished checkout by name — the installer above covers both of those cases.

### Manual options

#### Option A — Bundle patch (automatic)

Add `dsh-config-web` to your DSH profile's bundle list. The `dsh.bundle.patch` field in `package.json` points at `cordis.patch.yml`, which is applied automatically and:

1. inserts the plugin with `allowPrivateNetworks: true`
2. sets `web.fetchProvider` to `http-private`

#### Option B — Manual Cordis config

Mount it in `cordis.yml`:

```yaml
- name: 'dsh-config-web'
  config:
    allowPrivateNetworks: true

- name: '@deepseek-ai/dsh-web'
  config:
    fetchProvider: 'http-private'
```

> The second entry routes `web_fetch` through the registered provider. Without it, the plugin is loaded but unused.

#### Option C — Runtime UI toggle

With the plugin mounted, open **DSH Desktop → Settings → Plugins → Configurable** and use the **Web Fetch Network Policy** card. That card is the plugin's only settings surface, registered once; on a host with the plugin manager it also appears on the plugin's own page. Changes apply immediately and are persisted.

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `allowPrivateNetworks` | `boolean` | `false` | Allow fetching URLs resolving to private, local, or loopback IPs. Volatile (live-togglable). |
| `providerId` | `string` | `'http-private'` | ID registered via `ctx.web.registerFetchProvider`. |
| `maxResponseBytes` | `number` | `5_000_000` | Maximum response body size in bytes. |
| `maxBodyChars` | `number` | `100_000` | Maximum decoded body length in characters. |
| `timeoutMs` | `number` | `30_000` | Fetch timeout in ms (must be ≤ `2_147_483_647`, Node's max timer delay). |
| `maxRedirects` | `number` | `5` | Maximum same-origin redirect hops to follow. |
| `userAgent` | `string` | `DEFAULT_USER_AGENT` | `User-Agent` header sent on every request. |

Validation runs at plugin load: byte/char/timeout limits must be positive finite numbers, `maxRedirects` a non-negative integer.

## Runtime state & API

Toggled state is persisted to:

```
$DSH_HOME/dsh-config-web.json   # fallback: ~/.dsh/dsh-config-web.json
```

```json
{ "allowPrivateNetworks": true }
```

On startup, saved state **takes precedence** over the YAML config value.

### HTTP endpoints

Mounted on the DSH `webServer` when available:

| Endpoint | Method | Description |
|---|---|---|
| `/api/dsh-config-web/state` | `GET` | Returns `{ "allowPrivateNetworks": boolean }` |
| `/api/dsh-config-web/toggle` | `POST` | Body `{ "allowPrivateNetworks": boolean }` → `{ "ok": true, "allowPrivateNetworks": boolean }` |

Non-boolean bodies return `400`; non-`POST` on `/toggle` returns `405`.

```bash
curl http://localhost:PORT/api/dsh-config-web/state
curl -X POST http://localhost:PORT/api/dsh-config-web/toggle \
  -H 'content-type: application/json' \
  -d '{"allowPrivateNetworks":true}'
```

## How it works

```
web_fetch tool
    └─ ctx.web (fetchProvider: "http-private")
         └─ PrivateHttpFetchProvider          (src/provider.ts)
              ├─ HttpFetchProvider (stock)    limits + actual HTTP
              └─ resolveConfiguredAddresses   (src/network.ts)
                   ├─ dns.lookup(hostname)    raced against AbortSignal
                   ├─ isPublicIpAddress(ip)   via ipaddr.js
                   └─ allowPrivate ? allow : throw WEB_BLOCKED_URL
```

- When `allowPrivateNetworks` is `false`, any non-public resolved address throws `WebError(..., 'WEB_BLOCKED_URL')` — same behavior as stock.
- When `true`, resolution is skipped for the public-only check and all addresses are accepted.
- The allow flag is read through a closure on every request, so toggling takes effect on the next fetch.

### Error codes

| Code | Meaning |
|---|---|
| `WEB_BLOCKED_URL` | Hostname resolved to a non-public IP while private access is disabled |
| `WEB_PROVIDER_ERROR` | DNS resolution failed or returned an invalid address |
| `WEB_PROVIDER_CONFIGURED_MISSING` | Provider was disposed / not registered |

## Development

```bash
pnpm install
npm run build        # tsc -b → emits declarations to lib/types (see the note below)
node build.js        # tsdown bundles → lib/index.js (ESM) + lib/client.js (CJS, window.__ModuleLoader__)
npm test             # vitest run
node scripts/smoke-install.mjs            # install → status → uninstall against a throwaway profile
./install.sh         # install this checkout into your own DSH profile
```

> Notes: the shipped JS in `lib/` is produced by `node build.js`; `npm run build` only generates type declarations, and it does not currently typecheck cleanly (see below). Tests alias into a sibling `../deepseek-harness` checkout when one exists and fall back to the published packages otherwise, so they run the same way locally and in CI.

The installer in `bin/` is plain ESM with no dependencies and no build step, so a fresh clone can run `./install.sh` before anything is compiled, and `npx` can run the published copy straight from its cache.

### Smoke checks

`scripts/smoke-install.mjs` drives the real installer against a throwaway `$DSH_HOME` and then re-reads the filesystem to check what happened — the profile manifest, the bundle layer, and every file the installed package must ship. Three modes:

```bash
node scripts/smoke-install.mjs                  # link this checkout
node scripts/smoke-install.mjs --from-git       # through the repository fallback, as `npx github:…` does
node scripts/smoke-install.mjs --source dist/*.tgz   # the tarball npm would publish
```

### Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request:

- `test` — the vitest suite on Node 20, 22, 24, and 26 (Ubuntu), plus macOS and Windows on Node 24, and a smoke run of both entry points
- `install` — the three smoke modes above, so a broken install path cannot merge

The workflow takes its pnpm version from `package.json#packageManager`, and `pnpm install --frozen-lockfile` means `pnpm-lock.yaml` must stay committed.

### Releasing

`.github/workflows/release.yml` publishes on a version tag and can also be run by hand as a dry run from the Actions tab.

```bash
npm version patch        # or minor / major — this writes the tag
git push --follow-tags
```

The workflow checks that the tag matches `package.json`, runs the tests, packs the tarball, installs that tarball into a throwaway profile, publishes to npm with a provenance attestation, and opens a GitHub release with the tarball attached. Attached assets are installable directly:

```bash
npx --yes <asset url> install --source <asset url>
```

It needs one repository secret, `NPM_TOKEN`: a granular npm access token with publish rights for `dsh-config-web`.

### Known gaps

- `tsc -b` (the `build` script) reports pre-existing type errors: the client half has no React types, the slot service is used without the harness's module augmentation, and `exactOptionalPropertyTypes` rejects the schema's inferred config type. Nothing in CI depends on it, so the emitted `lib/types` cannot be trusted yet.
- `lib/` is committed by hand. `node build.js` reproduces it byte for byte with the pinned `tsdown`, and `tests/client-slots.spec.ts` fails if the committed client bundle and `src/client/index.ts` register different slots — but the host bundle has no such guard.

### Project layout

```
src/
  index.ts          # host plugin: config schema, provider registration, state, HTTP API
  provider.ts       # PrivateHttpFetchProvider wrapper
  network.ts        # DNS resolution + public/private IP classification
  client/index.ts   # browser UI plugin (settings cards, toggle switch)
bin/
  install.mjs       # one-command installer CLI (profile detection, pnpm, verification)
  plan.mjs          # pure install planning: manifest edits, profile choice, spec resolution
scripts/
  smoke-install.mjs # end-to-end install checks (checkout, repository fallback, tarball)
tests/
  fetch-private.spec.ts
  install.spec.ts
  client-slots.spec.ts
lib/                # built output (committed)
cordis.patch.yml    # auto-applied bundle patch
install.sh          # checkout / curl entry point for the installer
build.js            # tsdown bundler script
```

## Peer dependencies

`@deepseek-ai/cordis`, `@deepseek-ai/dsh-web`, `@deepseek-ai/dsh-web-fetch-http`, `@deepseek-ai/dsh-timeout`, `@deepseek-ai/schemastery`

Runtime dependency: [`ipaddr.js`](https://github.com/whitequark/ipaddr.js)

## License

MIT
