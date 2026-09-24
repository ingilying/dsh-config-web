/**
 * Browser client plugin for dsh-config-web.
 * Renders the native-styled configuration card in:
 * 1. Desktop Settings > Plugins > Plugin Settings (settings.plugin.item, key: 'config-web')
 * 2. Settings > General (settings.general.item)
 * 3. Plugins page slots (plugins.item, plugins.bundle.config, plugins.row.config)
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

  const nameStyle: React.CSSProperties = {
    color: 'var(--dsw-alias-label-primary, #1f2328)',
    fontSize: '15px',
    fontWeight: 600,
    lineHeight: '1.4',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  }

  const badgeStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 600,
    padding: '1px 7px',
    borderRadius: '9px',
    background: enabled ? 'var(--dsw-alias-state-success-primary, #16a34a)' : 'var(--dsw-alias-bg-module-platform, #eef0f4)',
    color: enabled ? '#ffffff' : 'var(--dsw-alias-label-secondary, #6b7280)',
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
        React.createElement(
          'div',
          { style: nameStyle },
          'Web Fetch Network Policy (网络访问策略)',
          React.createElement('span', { style: badgeStyle }, enabled ? 'Private Access ON' : 'Public Only'),
        ),
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

/** Settings > General row component */
function GeneralSettingsRow() {
  const { enabled, loading, busy, toggle } = usePrivateNetworkState()

  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '24px',
        padding: '16px 0',
        borderBottom: '0.5px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.1))',
      },
    },
    React.createElement(
      'div',
      null,
      React.createElement(
        'div',
        { style: { fontSize: '14px', lineHeight: '20px', fontWeight: 500, color: 'var(--dsw-alias-label-primary, inherit)' } },
        'Allow Private Network Access (允许私有网络访问)',
      ),
      React.createElement(
        'div',
        { style: { marginTop: '4px', color: 'var(--dsw-alias-label-secondary, #888)', fontSize: '12px', lineHeight: '18px' } },
        'Permit web fetch tools to access loopback (127.0.0.1) and private subnets (10.x, 192.168.x, 172.16.x).',
      ),
    ),
    React.createElement(NativeSwitch, {
      checked: enabled,
      disabled: loading || busy,
      onChange: toggle,
    }),
  )
}

export function apply(ctx: Context) {
  // 1. DSH Desktop Settings -> Plugins -> Plugin Settings (settings.plugin.item) via nested settingsScope (like dshmarket)
  const anyCtx = ctx as any
  if (typeof anyCtx.inject === 'function') {
    anyCtx.inject(['settingsScope'], (scoped: any) => {
      scoped.slots?.inject?.('settings.plugin.item', () => {
        return scoped.slots.register(
          {
            name: 'settings.plugin.item',
            key: 'config-web',
          },
          () => React.createElement(NativePluginCard),
        )
      })
    })
  }

  // Also register directly on ctx.slots for settings.plugin.item
  ctx.slots?.inject?.('settings.plugin.item', () => {
    return ctx.slots.register(
      {
        name: 'settings.plugin.item',
        key: 'config-web',
      },
      () => React.createElement(NativePluginCard),
    )
  })

  // 2. Register into Settings > General (settings.general.item)
  ctx.slots?.inject?.('settings.general.item', () => {
    return ctx.slots.register(
      {
        name: 'settings.general.item',
        id: 'config-web-private-network',
        order: 35,
      },
      () => React.createElement(GeneralSettingsRow),
    )
  })

  // 3. Register into Plugins page item card (plugins.item)
  ctx.slots?.inject?.('plugins.item', () => {
    return ctx.slots.register(
      {
        name: 'plugins.item',
        id: 'config-web',
        order: 45,
        label: () => 'Web Fetch Network Policy',
      },
      (props: any) => {
        if (props.view === 'summary') {
          return 'Configure private, local, and loopback IP network access for web fetch.'
        }
        return React.createElement(NativePluginCard)
      },
    )
  })

  // 4. Register into bundle detail page (plugins.bundle.config)
  ctx.slots?.inject?.('plugins.bundle.config', () => {
    return ctx.slots.register(
      {
        name: 'plugins.bundle.config',
        key: 'dsh-config-web',
      },
      () => React.createElement(NativePluginCard),
    )
  })

  // 5. Register into row detail page (plugins.row.config)
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
