import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import type { HttpFetchLimits } from '@deepseek-ai/dsh-web-fetch-http'
import * as plugin from '../src/index.ts'
import { PrivateHttpFetchProvider, PRIVATE_FETCH_PROVIDER_ID } from '../src/provider.ts'
import { isPublicIpAddress, resolveConfiguredAddresses } from '../src/network.ts'

const limits: HttpFetchLimits = {
  maxResponseBytes: 5_000_000,
  maxBodyChars: 100_000,
  timeoutMs: 5_000,
  maxRedirects: 5,
  userAgent: 'test-agent/1.0',
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void

let server: Server
let base: string
let handler: Handler

beforeEach(async () => {
  handler = (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('private ok')
  }
  server = createServer((req, res) => { handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  base = `http://127.0.0.1:${port}`
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await new Promise<void>(resolve => server.close(() => { resolve() }))
})

describe('isPublicIpAddress', () => {
  it('correctly classifies public and private IP addresses', () => {
    expect(isPublicIpAddress('8.8.8.8')).toBe(true)
    expect(isPublicIpAddress('1.1.1.1')).toBe(true)
    expect(isPublicIpAddress('2606:4700:4700::1111')).toBe(true)

    expect(isPublicIpAddress('127.0.0.1')).toBe(false)
    expect(isPublicIpAddress('10.0.0.1')).toBe(false)
    expect(isPublicIpAddress('192.168.1.1')).toBe(false)
    expect(isPublicIpAddress('172.16.0.1')).toBe(false)
    expect(isPublicIpAddress('::1')).toBe(false)
  })
})

describe('resolveConfiguredAddresses', () => {
  it('retains private addresses when allowPrivate is true', async () => {
    const resolver = vi.fn(async () => [
      { address: '127.0.0.1', family: 4 },
      { address: '10.0.0.1', family: 4 },
      { address: '::1', family: 6 },
    ])
    await expect(resolveConfiguredAddresses('internal.test', new AbortController().signal, true, resolver))
      .resolves.toEqual([
        { address: '127.0.0.1', family: 4 },
        { address: '10.0.0.1', family: 4 },
        { address: '::1', family: 6 },
      ])
  })

  it('rejects private addresses when allowPrivate is false', async () => {
    const resolver = vi.fn(async () => [
      { address: '127.0.0.1', family: 4 },
    ])
    await expect(resolveConfiguredAddresses('internal.test', new AbortController().signal, false, resolver))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
  })
})

describe('PrivateHttpFetchProvider dynamic volatile toggling', () => {
  it('reflects live configuration toggling without recreating provider', async () => {
    let allowed = false
    const provider = new PrivateHttpFetchProvider(limits, () => allowed)

    // Initially blocked
    await expect(provider.fetch({ url: base }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))

    // User toggles config in UI
    allowed = true

    // Now allowed immediately!
    const result = await provider.fetch({ url: base })
    expect(result.statusCode).toBe(200)
    expect(result.body.content).toBe('private ok')

    // User toggles back off
    allowed = false
    await expect(provider.fetch({ url: base }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
  })
})

describe('config-web plugin registration', () => {
  it('registers into ctx.web and honors allowPrivateNetworks config', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { fetchProvider: PRIVATE_FETCH_PROVIDER_ID })
    const fiber = await ctx.plugin(plugin, { allowPrivateNetworks: true })

    const result = await ctx.web.fetch({ url: `${base}/` })
    expect(result.statusCode).toBe(200)
    expect(result.body.content).toBe('private ok')

    await fiber.dispose()
    await expect(ctx.web.fetch({ url: `${base}/` }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('has no default export (namespace plugin shape)', () => {
    expect('default' in plugin).toBe(false)
  })
})
