/**
 * Configurable HTTP(S) `WebFetchProvider` plugin with optional private network access.
 *
 * @module dsh-config-web
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import { DEFAULT_USER_AGENT } from '@deepseek-ai/dsh-web-fetch-http'
import type { HttpFetchLimits } from '@deepseek-ai/dsh-web-fetch-http'
import { PrivateHttpFetchProvider, PRIVATE_FETCH_PROVIDER_ID } from './provider.ts'

const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647

export {
  PRIVATE_FETCH_PROVIDER_ID,
  PrivateHttpFetchProvider,
} from './provider.ts'
export { isPublicIpAddress, resolveAllAddresses, resolveConfiguredAddresses } from './network.ts'
export type { PublicAddress, AddressResolver } from './network.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'config-web'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config: transport limits, user-agent, and private network toggles. */
export interface Config {
  /** Maximum response body size in bytes. */
  maxResponseBytes?: number
  /** Maximum decoded body length in characters. */
  maxBodyChars?: number
  /** Default fetch timeout in milliseconds, within Node's timer range. */
  timeoutMs?: number
  /** Maximum number of same-origin redirect hops to follow. */
  maxRedirects?: number
  /** `User-Agent` header sent on every request. */
  userAgent?: string
  /** Whether to allow fetching URLs resolving to private / non-public IP addresses. Default: false. */
  allowPrivateNetworks?: boolean
  /** Provider ID to register with ctx.web. Default: 'http-private'. */
  providerId?: string
}

// Ensure .volatile() exists on Schemastery prototype across environments (e.g. DSH Desktop)
const SchemaProto = Object.getPrototypeOf(z.boolean()) as {
  volatile?: () => unknown
  extra: (key: string, value: unknown) => unknown
  meta?: { volatile?: boolean }
}
if (typeof SchemaProto.volatile !== 'function') {
  SchemaProto.volatile = function volatile(this: { meta?: { volatile?: boolean }; extra: (key: string, value: unknown) => unknown }) {
    if (this.meta?.volatile) throw new TypeError('volatile schema is already wrapped')
    return this.extra('volatile', true)
  }
}

export const Config: z<Config> = z.object({
  maxResponseBytes: z.number().default(5_000_000),
  maxBodyChars: z.number().default(100_000),
  timeoutMs: z.number().default(30_000),
  maxRedirects: z.number().default(5),
  userAgent: z.string().default(DEFAULT_USER_AGENT),
  allowPrivateNetworks: z.boolean().default(false).volatile(),
  providerId: z.string().default(PRIVATE_FETCH_PROVIDER_ID),
})

/** Extract current allowPrivateNetworks value whether passed as scalar or Volatile handle. */
function getAllowPrivate(config: Config): boolean {
  const val = config.allowPrivateNetworks as unknown
  if (typeof val === 'object' && val !== null && 'get' in val && typeof (val as { get: unknown }).get === 'function') {
    return Boolean((val as { get: () => unknown }).get())
  }
  return Boolean(val)
}

function stateFilePath(): string {
  const home = process.env.DSH_HOME || join(process.env.HOME || '', '.dsh')
  return join(home, 'dsh-config-web.json')
}

function loadSavedState(): boolean | undefined {
  try {
    const file = stateFilePath()
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf8'))
      if (typeof data.allowPrivateNetworks === 'boolean') return data.allowPrivateNetworks
    }
  } catch {}
  return undefined
}

function saveState(allowed: boolean): void {
  try {
    const file = stateFilePath()
    writeFileSync(file, JSON.stringify({ allowPrivateNetworks: allowed }, null, 2))
  } catch (err) {
    console.error('[dsh-config-web] Failed to save state:', err)
  }
}

function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => { data += chunk })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, data: any) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(data))
}

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`config-web: ${name} must be a positive finite number`)
  }
}

function assertTimeoutMs(value: number): void {
  assertPositiveFinite('timeoutMs', value)
  if (value > MAX_NODE_TIMER_DELAY_MS) {
    throw new Error(`config-web: timeoutMs must be no greater than ${MAX_NODE_TIMER_DELAY_MS}`)
  }
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`config-web: ${name} must be a non-negative integer`)
  }
}

/** Register the configurable HTTP(S) fetch provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as Required<Config>
  assertPositiveFinite('maxResponseBytes', resolved.maxResponseBytes)
  assertPositiveFinite('maxBodyChars', resolved.maxBodyChars)
  assertTimeoutMs(resolved.timeoutMs)
  assertNonNegativeInteger('maxRedirects', resolved.maxRedirects)

  // Load persistent saved state if it exists, otherwise use config value
  const savedState = loadSavedState()
  let liveAllowed = savedState !== undefined ? savedState : getAllowPrivate(config)

  const limits: HttpFetchLimits = {
    maxResponseBytes: resolved.maxResponseBytes,
    maxBodyChars: resolved.maxBodyChars,
    timeoutMs: resolved.timeoutMs,
    maxRedirects: resolved.maxRedirects,
    userAgent: resolved.userAgent,
  }

  ctx.web.registerFetchProvider(
    new PrivateHttpFetchProvider(
      limits,
      () => liveAllowed,
      undefined,
      resolved.providerId,
    ),
  )

  // Register settings namespace for DSH Desktop / Settings UI (like dshmarket)
  const anyCtx = ctx as any
  if (typeof anyCtx.inject === 'function') {
    anyCtx.inject(['settings'], (scopedCtx: any) => {
      try {
        if (typeof scopedCtx.settings?.register === 'function') {
          const settingsSchema = z.object({
            allowPrivateNetworks: z.boolean().default(false),
          })
          const scope = scopedCtx.settings.register('config-web', settingsSchema, {
            base: { allowPrivateNetworks: liveAllowed },
          })
          if (scope?.watch) {
            scope.watch(() => {
              const val = scope.get()?.allowPrivateNetworks
              if (typeof val === 'boolean') {
                liveAllowed = val
                saveState(liveAllowed)
              }
            })
          }
        }
      } catch {
        // Fallback: settings service already configured or different signature
      }
    })

    // Mount direct HTTP endpoints on webServer if present
    anyCtx.inject(['webServer'], (scoped: any) => {
      scoped.webServer?.register?.({
        kind: 'exact',
        path: '/api/dsh-config-web/state',
        handler: (_req: IncomingMessage, res: ServerResponse) => {
          sendJson(res, 200, { allowPrivateNetworks: liveAllowed })
        },
      })

      scoped.webServer?.register?.({
        kind: 'exact',
        path: '/api/dsh-config-web/toggle',
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== 'POST') {
            res.writeHead(405)
            res.end()
            return
          }
          try {
            const body = await readJson(req)
            if (typeof body.allowPrivateNetworks === 'boolean') {
              liveAllowed = body.allowPrivateNetworks
              saveState(liveAllowed)
            }
            sendJson(res, 200, { ok: true, allowPrivateNetworks: liveAllowed })
          } catch (err) {
            sendJson(res, 400, { error: String(err) })
          }
        },
      })
    })
  }
}
