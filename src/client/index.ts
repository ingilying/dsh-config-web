/**
 * Browser client plugin for dsh-config-web.
 *
 * The card lives on the Plugins page only, registered once per surface:
 * 1. Settings > Plugins > Configurable (settings.plugin.item), keyed by the
 *    `config-web` settings namespace the host registers. The slot is a keyed
 *    child declared by `@deepseek-ai/dsh-client-ui-settings-plugins`, which
 *    registers its own cards from the root context too — one entry per key is
 *    what its Configurable tab dispatches.
 * 2. Plugins page detail views (plugins.bundle.config, plugins.row.config),
 *    keyed by package name — where a bundle's configuration belongs.
 */

import React, { useState, useEffect, useCallback } from 'react'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'config-web-client'
export const inject = ['slots']

/** Shared state hook connected directly to the backend HTTP API */
function usePrivateNetworkState() {
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/dsh-config-web/state')
      .then(res => res.json())
      .then(data => {
        if (active && typeof data.allowPrivateNetworks === 'boolean') {
          setEnabled(data.allowPrivateNetworks)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  const toggle = useCallback(async () => {
    if (busy) return
    const nextVal = !enabled
    setEnabled(nextVal)
    setBusy(true)
    try {
      const res = await fetch('/api/dsh-config-web/toggle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ allowPrivateNetworks: nextVal }),
      })
      if (!res.ok) {
        setEnabled(!nextVal)
      }
    } catch {
      setEnabled(!nextVal)
    } finally {
      setBusy(false)
    }
  }, [enabled, busy])

  return { enabled, loading, busy, toggle }
}

/** Native-styled Switch toggle matching DeepSeek Harness UI */
function NativeSwitch({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange: () => void }) {
  const switchStyle: React.CSSProperties = {
    position: 'relative',
    width: '38px',
    height: '22px',
    borderRadius: '99px',
    border: '1px solid ' + (checked ? 'var(--dsw-alias-state-success-primary, #16a34a)' : 'var(--dsw-alias-border-l2, #d9dde3)'),
    background: checked ? 'var(--dsw-alias-state-success-primary, #16a34a)' : 'var(--dsw-alias-bg-layer-2, #e5e7eb)',
    cursor: disabled ? 'default' : 'pointer',
    padding: 0,
    flexShrink: 0,
    transition: 'background 0.15s ease, border-color 0.15s ease',
    opacity: disabled ? 0.6 : 1,
  }

  const knobStyle: React.CSSProperties = {
    position: 'absolute',
    top: '2px',
    left: checked ? '18px' : '2px',
    width: '16px',
    height: '16px',
    borderRadius: '99px',
    background: '#ffffff',
    boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
    transition: 'left 0.15s ease',
  }

  return React.createElement(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': checked,
      disabled,
      onClick: onChange,
      style: switchStyle,
    },
    React.createElement('span', { style: knobStyle }),
  )
}

/** Native expandable PluginCard matching DSH Desktop Settings Plugins */
function NativePluginCard() {
  const [open, setOpen] = useState(true)
  const { enabled, loading, busy, toggle } = usePrivateNetworkState()

  const cardStyle: React.CSSProperties = {
    border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
    background: open ? 'var(--dsw-alias-bg-layer-2, #f7f8fa)' : 'var(--dsw-alias-bg-layer-3, #ffffff)',
    borderColor: open ? 'var(--dsw-alias-label-dimmed, #c8ccd4)' : 'var(--dsw-alias-border-l2, #e5e7eb)',
    borderRadius: '12px',
    listStyle: 'none',
    transition: 'border-color 0.16s, background 0.16s',
    marginBottom: '12px',
  }

  const headerStyle: React.CSSProperties = {
    appearance: 'none',
    width: '100%',
    font: 'inherit',
    color: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    background: 'none',
    border: 0,
    borderRadius: '12px',
    alignItems: 'center',
    gap: '12px',
    padding: '14px 16px',
    display: 'flex',
  }

  const headTextStyle: React.CSSProperties = {
    flexDirection: 'column',
    flex: 1,
    gap: '4px',
    minWidth: 0,
    display: 'flex',
  }

  // Plain title text: the card used to carry a green status badge beside it.
  const nameStyle: React.CSSProperties = {
    color: 'var(--dsw-alias-label-primary, #1f2328)',
    fontSize: '15px',
    fontWeight: 600,
    lineHeight: '1.4',
  }

  const descStyle: React.CSSProperties = {
    color: 'var(--dsw-alias-label-tertiary, #8b93a1)',
    fontSize: '13px',
    lineHeight: '1.5',
  }

  const chevronStyle: React.CSSProperties = {
    color: 'var(--dsw-alias-label-tertiary, #8b93a1)',
    flex: 'none',
    display: 'inline-flex',
    transition: 'transform 0.16s ease',
    transform: open ? 'rotate(180deg)' : 'none',
    fontSize: '12px',
  }

  const bodyStyle: React.CSSProperties = {
    borderTop: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
    margin: '0 16px',
    paddingBottom: '8px',
  }

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '12px 0',
  }

  const labelBoxStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    flex: 1,
    minWidth: 0,
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '13px',
    lineHeight: '20px',
    color: 'var(--dsw-alias-label-primary, #1f2328)',
    fontWeight: 500,
  }

  const hintStyle: React.CSSProperties = {
    fontSize: '12px',
    lineHeight: '18px',
    color: 'var(--dsw-alias-label-tertiary, #8b93a1)',
  }

  return React.createElement(
    'div',
    { style: cardStyle },
    React.createElement(
      'button',
      {
        type: 'button',
        style: headerStyle,
        'aria-expanded': open,
        onClick: () => { setOpen(!open) },
      },
      React.createElement(
        'div',
        { style: headTextStyle },
        React.createElement('div', { style: nameStyle }, 'Web Fetch Network Policy (网络访问策略)'),
        React.createElement('div', { style: descStyle }, '配置网络抓取与网页访问的 IP 地址范围策略（支持本地服务与内网访问）。'),
      ),
      React.createElement('span', { style: chevronStyle }, '▼'),
    ),
    open && React.createElement(
      'div',
      { style: bodyStyle },
      React.createElement(
        'div',
        { style: rowStyle },
        React.createElement(
          'div',
          { style: labelBoxStyle },
          React.createElement('div', { style: labelStyle }, '允许访问私有与本地回环网络 (Allow Private Networks)'),
          React.createElement(
            'div',
            { style: hintStyle },
            '允许请求解析到 127.0.0.1、10.0.0.0/8、172.16.0.0/12、192.168.0.0/16 或 ::1 的 URL。关闭时将自动拦截以防 SSRF。',
          ),
        ),
        React.createElement(NativeSwitch, {
          checked: enabled,
          disabled: loading || busy,
          onChange: toggle,
        }),
      ),
    ),
  )
}

export function apply(ctx: Context) {
  // 1. Desktop Settings > Plugins > Configurable. Registered from the root
  // context, the same way the section package registers its own cards. This
  // slot used to be registered a second time through a nested `settingsScope`
  // injection as well, which made the keyed card render twice.
  ctx.slots?.inject?.('settings.plugin.item', () => {
    return ctx.slots.register(
      {
        name: 'settings.plugin.item',
        key: 'config-web',
      },
      () => React.createElement(NativePluginCard),
    )
  })

  // 2. Register into bundle detail page (plugins.bundle.config)
  ctx.slots?.inject?.('plugins.bundle.config', () => {
    return ctx.slots.register(
      {
        name: 'plugins.bundle.config',
        key: 'dsh-config-web',
      },
      () => React.createElement(NativePluginCard),
    )
  })

  // 3. Register into row detail page (plugins.row.config)
  ctx.slots?.inject?.('plugins.row.config', () => {
    return ctx.slots.register(
      {
        name: 'plugins.row.config',
        key: 'dsh-config-web#config-web',
      },
      () => React.createElement(NativePluginCard),
    )
  })
}
