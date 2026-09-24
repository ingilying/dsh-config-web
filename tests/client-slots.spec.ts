import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// The browser half imports React, which the DSH client shell supplies at
// runtime and this package deliberately does not depend on. Registration and
// element shape are all these tests exercise, so a minimal stand-in is enough.
vi.mock('react', () => {
  const createElement = (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props: props ?? {}, children })
  const React = { createElement, useState: () => [false, () => {}], useEffect: () => {}, useCallback: (fn: unknown) => fn }
  return { default: React, ...React }
})

const { apply } = await import('../src/client/index.ts')

/** One registration the plugin made: its slot name and its key or id. */
interface Registration {
  name: string
  key: string
}

/** An element built by the React stand-in. */
interface Element {
  type: unknown
  props: Record<string, unknown>
  children: unknown[]
}

/** Everything one fake context recorded, including each slot's render callback. */
interface Recorded {
  ctx: unknown
  registrations: Registration[]
  renders: Map<string, () => Element>
}

/** A context with just enough of the slot service to record registrations and render callbacks. */
function makeContext(): Recorded {
  const registrations: Registration[] = []
  const renders = new Map<string, () => Element>()
  const slots = {
    inject: (_name: string, register: () => unknown) => { register() },
    register: (options: { name: string, key?: string, id?: string }, render: () => Element) => {
      const entry = { name: options.name, key: options.key ?? options.id ?? '' }
      registrations.push(entry)
      renders.set(entry.name, render)
      return {}
    },
  }
  const ctx = { slots, inject: (_services: string[], callback: (scoped: unknown) => void) => { callback({ slots }) } }
  return { ctx, registrations, renders }
}

/**
 * The registrations the committed bundle makes, read by running it the way the
 * client shell does: `window.__ModuleLoader__.load` hands out a factory whose
 * `require('react')` resolves to the stand-in above.
 * @param source - the bundle text to execute.
 * @returns every registration the bundle performs.
 */
function registrationsOfBundle(source: string): Registration[] {
  const registrations: Registration[] = []
  let factory: ((require: (id: string) => unknown) => { apply: (ctx: unknown) => void }) | undefined
  const createElement = (type: unknown, props: unknown, ...children: unknown[]): Element => ({ type, props: (props ?? {}) as Record<string, unknown>, children })
  const react = { createElement, useState: () => [false, () => {}], useEffect: () => {}, useCallback: (fn: unknown) => fn, default: undefined as unknown }
  react.default = react
  const window = { __ModuleLoader__: { load: ({ factory: loaded }: { factory: typeof factory }) => { factory = loaded } } }
  const slots = {
    inject: (_name: string, register: () => unknown) => { register() },
    register: (options: { name: string, key?: string, id?: string }) => {
      registrations.push({ name: options.name, key: options.key ?? options.id ?? '' })
      return {}
    },
  }
  // The bundle is a browser script, not a module: it reads `window` and
  // registers itself with the loader on evaluation.
  new Function('window', 'require', source)(window, (id: string) => (id === 'react' ? react : {}))
  const plugin = factory?.((id: string) => (id === 'react' ? react : {}))
  plugin?.apply({ slots, inject: (_services: string[], callback: (scoped: unknown) => void) => { callback({ slots }) } })
  return registrations
}

describe('client slot registration', () => {
  it('registers the card on the Plugins page surfaces only', () => {
    const { ctx, registrations } = makeContext()
    apply(ctx as never)
    expect(registrations).toEqual([
      { name: 'settings.plugin.item', key: 'config-web' },
      { name: 'plugins.bundle.config', key: 'dsh-config-web' },
      { name: 'plugins.row.config', key: 'dsh-config-web#config-web' },
    ])
  })

  it('registers no slot twice, which is what duplicated the settings card', () => {
    const { ctx, registrations } = makeContext()
    apply(ctx as never)
    const keys = registrations.map(entry => `${entry.name}#${entry.key}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('leaves the General section and plugins.item to their owners', () => {
    const { ctx, registrations } = makeContext()
    apply(ctx as never)
    // General is for a single preference with no page of its own — this card is
    // a page. `plugins.item` is documented as occupied by the official settings
    // pages, with a bundle's configuration belonging in the config slots.
    expect(registrations.some(entry => entry.name === 'settings.general.item')).toBe(false)
    expect(registrations.some(entry => entry.name === 'plugins.item')).toBe(false)
  })

  it('renders a card title without the green status badge', () => {
    const { ctx, renders } = makeContext()
    apply(ctx as never)
    const element = renders.get('settings.plugin.item')?.()
    expect(element).toBeDefined()
    // The slot's render callback returns the element for the card component;
    // calling it runs the stubbed hooks and yields the card's own tree.
    const card = (element?.type as () => Element)()
    const text = JSON.stringify(card)
    expect(text).toContain('Web Fetch Network Policy')
    expect(text).not.toContain('Private Access ON')
    expect(text).not.toContain('Public Only')
  })

  it('ships a built bundle whose registrations match the source', () => {
    const bundle = readFileSync(resolve(import.meta.dirname, '../lib/client.js'), 'utf8')
    const { ctx, registrations } = makeContext()
    apply(ctx as never)
    expect(registrationsOfBundle(bundle)).toEqual(registrations)
  })
})
