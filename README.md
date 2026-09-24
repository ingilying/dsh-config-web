# dsh-config-web

Configurable HTTP(S) fetch provider for DeepSeek Harness (`ctx.web`) with optional private network support.

## Overview

In the standard `@deepseek-ai/dsh-web-fetch-http` package, private, local, and loopback IP addresses (like `127.0.0.1`, `10.0.0.0/8`, `192.168.0.0/16`, `::1`) are blocked as an SSRF defense, throwing:

```
URL hostname "..." resolves to a non-public IP address (WEB_BLOCKED_URL)
```

`dsh-config-web` wraps the HTTP fetch provider and adds the `allowPrivateNetworks` configuration option to allow accessing local services, intranets, or private APIs.

## Installation

Mount `dsh-config-web` in your Cordis configuration (`cordis.yml`):

```yaml
- name: 'dsh-config-web'
  config:
    allowPrivateNetworks: true

- name: '@deepseek-ai/dsh-web'
  config:
    fetchProvider: 'http-private'
```

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `allowPrivateNetworks` | `boolean` | `false` | When `true`, enables fetching URLs resolving to private, local, or loopback IPs. |
| `providerId` | `string` | `'http-private'` | The ID registered into `ctx.web.registerFetchProvider`. |
| `maxResponseBytes` | `number` | `5,000,000` | Maximum response body size in bytes. |
| `maxBodyChars` | `number` | `100,000` | Maximum decoded body length in characters. |
| `timeoutMs` | `number` | `30,000` | Fetch timeout in milliseconds. |
| `maxRedirects` | `number` | `5` | Maximum number of same-origin redirects to follow. |
| `userAgent` | `string` | `DEFAULT_USER_AGENT` | Request `User-Agent` header. |
