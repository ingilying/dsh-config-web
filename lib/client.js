window.__ModuleLoader__.load({ id: "dsh-config-web", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let react = require("react");
react = __toESM(react, 1);
//#region src/client/index.ts
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
const name = "config-web-client";
const inject = ["slots"];
/** Shared state hook connected directly to the backend HTTP API */
function usePrivateNetworkState() {
	const [enabled, setEnabled] = (0, react.useState)(false);
	const [loading, setLoading] = (0, react.useState)(true);
	const [busy, setBusy] = (0, react.useState)(false);
	(0, react.useEffect)(() => {
		let active = true;
		fetch("/api/dsh-config-web/state").then((res) => res.json()).then((data) => {
			if (active && typeof data.allowPrivateNetworks === "boolean") setEnabled(data.allowPrivateNetworks);
		}).catch(() => {}).finally(() => {
			if (active) setLoading(false);
		});
		return () => {
			active = false;
		};
	}, []);
	return {
		enabled,
		loading,
		busy,
		toggle: (0, react.useCallback)(async () => {
			if (busy) return;
			const nextVal = !enabled;
			setEnabled(nextVal);
			setBusy(true);
			try {
				if (!(await fetch("/api/dsh-config-web/toggle", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ allowPrivateNetworks: nextVal })
				})).ok) setEnabled(!nextVal);
			} catch {
				setEnabled(!nextVal);
			} finally {
				setBusy(false);
			}
		}, [enabled, busy])
	};
}
/** Native-styled Switch toggle matching DeepSeek Harness UI */
function NativeSwitch({ checked, disabled, onChange }) {
	const switchStyle = {
		position: "relative",
		width: "38px",
		height: "22px",
		borderRadius: "99px",
		border: "1px solid " + (checked ? "var(--dsw-alias-state-success-primary, #16a34a)" : "var(--dsw-alias-border-l2, #d9dde3)"),
		background: checked ? "var(--dsw-alias-state-success-primary, #16a34a)" : "var(--dsw-alias-bg-layer-2, #e5e7eb)",
		cursor: disabled ? "default" : "pointer",
		padding: 0,
		flexShrink: 0,
		transition: "background 0.15s ease, border-color 0.15s ease",
		opacity: disabled ? .6 : 1
	};
	const knobStyle = {
		position: "absolute",
		top: "2px",
		left: checked ? "18px" : "2px",
		width: "16px",
		height: "16px",
		borderRadius: "99px",
		background: "#ffffff",
		boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
		transition: "left 0.15s ease"
	};
	return react.default.createElement("button", {
		type: "button",
		role: "switch",
		"aria-checked": checked,
		disabled,
		onClick: onChange,
		style: switchStyle
	}, react.default.createElement("span", { style: knobStyle }));
}
/** Native expandable PluginCard matching DSH Desktop Settings Plugins */
function NativePluginCard() {
	const [open, setOpen] = (0, react.useState)(true);
	const { enabled, loading, busy, toggle } = usePrivateNetworkState();
	const cardStyle = {
		border: "1px solid var(--dsw-alias-border-l2, #e5e7eb)",
		background: open ? "var(--dsw-alias-bg-layer-2, #f7f8fa)" : "var(--dsw-alias-bg-layer-3, #ffffff)",
		borderColor: open ? "var(--dsw-alias-label-dimmed, #c8ccd4)" : "var(--dsw-alias-border-l2, #e5e7eb)",
		borderRadius: "12px",
		listStyle: "none",
		transition: "border-color 0.16s, background 0.16s",
		marginBottom: "12px"
	};
	const headerStyle = {
		appearance: "none",
		width: "100%",
		font: "inherit",
		color: "inherit",
		textAlign: "left",
		cursor: "pointer",
		background: "none",
		border: 0,
		borderRadius: "12px",
		alignItems: "center",
		gap: "12px",
		padding: "14px 16px",
		display: "flex"
	};
	const headTextStyle = {
		flexDirection: "column",
		flex: 1,
		gap: "4px",
		minWidth: 0,
		display: "flex"
	};
	const nameStyle = {
		color: "var(--dsw-alias-label-primary, #1f2328)",
		fontSize: "15px",
		fontWeight: 600,
		lineHeight: "1.4"
	};
	const descStyle = {
		color: "var(--dsw-alias-label-tertiary, #8b93a1)",
		fontSize: "13px",
		lineHeight: "1.5"
	};
	const chevronStyle = {
		color: "var(--dsw-alias-label-tertiary, #8b93a1)",
		flex: "none",
		display: "inline-flex",
		transition: "transform 0.16s ease",
		transform: open ? "rotate(180deg)" : "none",
		fontSize: "12px"
	};
	return react.default.createElement("div", { style: cardStyle }, react.default.createElement("button", {
		type: "button",
		style: headerStyle,
		"aria-expanded": open,
		onClick: () => {
			setOpen(!open);
		}
	}, react.default.createElement("div", { style: headTextStyle }, react.default.createElement("div", { style: nameStyle }, "Web Fetch Network Policy (网络访问策略)"), react.default.createElement("div", { style: descStyle }, "配置网络抓取与网页访问的 IP 地址范围策略（支持本地服务与内网访问）。")), react.default.createElement("span", { style: chevronStyle }, "▼")), open && react.default.createElement("div", { style: {
		borderTop: "1px solid var(--dsw-alias-border-l2, #e5e7eb)",
		margin: "0 16px",
		paddingBottom: "8px"
	} }, react.default.createElement("div", { style: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: "12px",
		padding: "12px 0"
	} }, react.default.createElement("div", { style: {
		display: "flex",
		flexDirection: "column",
		gap: "3px",
		flex: 1,
		minWidth: 0
	} }, react.default.createElement("div", { style: {
		fontSize: "13px",
		lineHeight: "20px",
		color: "var(--dsw-alias-label-primary, #1f2328)",
		fontWeight: 500
	} }, "允许访问私有与本地回环网络 (Allow Private Networks)"), react.default.createElement("div", { style: {
		fontSize: "12px",
		lineHeight: "18px",
		color: "var(--dsw-alias-label-tertiary, #8b93a1)"
	} }, "允许请求解析到 127.0.0.1、10.0.0.0/8、172.16.0.0/12、192.168.0.0/16 或 ::1 的 URL。关闭时将自动拦截以防 SSRF。")), react.default.createElement(NativeSwitch, {
		checked: enabled,
		disabled: loading || busy,
		onChange: toggle
	}))));
}
function apply(ctx) {
	ctx.slots?.inject?.("settings.plugin.item", () => {
		return ctx.slots.register({
			name: "settings.plugin.item",
			key: "config-web"
		}, () => react.default.createElement(NativePluginCard));
	});
	ctx.slots?.inject?.("plugins.bundle.config", () => {
		return ctx.slots.register({
			name: "plugins.bundle.config",
			key: "dsh-config-web"
		}, () => react.default.createElement(NativePluginCard));
	});
	ctx.slots?.inject?.("plugins.row.config", () => {
		return ctx.slots.register({
			name: "plugins.row.config",
			key: "dsh-config-web#config-web"
		}, () => react.default.createElement(NativePluginCard));
	});
}
//#endregion
exports.apply = apply;
exports.inject = inject;
exports.name = name;

return module.exports; } });
