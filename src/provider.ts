import { HttpFetchProvider } from '@deepseek-ai/dsh-web-fetch-http'
import type { HttpFetchLimits, HttpFetchResolver } from '@deepseek-ai/dsh-web-fetch-http'
import type { WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import { resolveConfiguredAddresses } from './network.ts'

export const PRIVATE_FETCH_PROVIDER_ID = 'http-private'

export class PrivateHttpFetchProvider implements WebFetchProvider {
  readonly id: string
  private readonly inner: HttpFetchProvider
  private readonly checkAllowed: () => boolean

  constructor(
    limits: HttpFetchLimits,
    allowPrivateNetworks: boolean | (() => boolean) = false,
    customResolver?: HttpFetchResolver,
    providerId: string = PRIVATE_FETCH_PROVIDER_ID,
  ) {
    this.id = providerId
    this.checkAllowed = typeof allowPrivateNetworks === 'function' ? allowPrivateNetworks : () => allowPrivateNetworks
    const resolver = customResolver ?? ((hostname, signal) => resolveConfiguredAddresses(hostname, signal, this.checkAllowed()))
    this.inner = new HttpFetchProvider(limits, resolver)
  }

  available(): boolean {
    return this.inner.available()
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    return await this.inner.fetch(request, signal)
  }
}
