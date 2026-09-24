import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { DEFAULT_USER_AGENT, HttpFetchProvider } from "@deepseek-ai/dsh-web-fetch-http";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { WebError } from "@deepseek-ai/dsh-web";
//#region src/network.ts
/**
* Return whether an address is globally reachable unicast.
*
* @param input - textual IPv4 or IPv6 address.
* @returns true only for a public unicast destination.
*/
function isPublicIpAddress(input) {
	let parsed;
	try {
		parsed = ipaddr.parse(stripIpv6Brackets(input));
	} catch {
		return false;
	}
	if (parsed instanceof ipaddr.IPv4) return parsed.range() === "unicast";
	if (parsed.isIPv4MappedAddress()) return parsed.toIPv4Address().range() === "unicast";
	return parsed.range() === "unicast";
}
/**
* Resolve a hostname, optionally allowing private/internal IP addresses.
*
* @param hostname - URL hostname, including brackets when it is an IPv6 literal.
* @param signal - cancellation signal.
* @param allowPrivate - whether private/internal/loopback addresses are allowed.
* @param resolver - lookup implementation.
*/
async function resolveConfiguredAddresses(hostname, signal, allowPrivate, resolver = lookup) {
	const unbracketed = stripIpv6Brackets(hostname);
	const literalFamily = isIP(unbracketed);
	const resolved = literalFamily === 0 ? await raceWithSignal(resolver(unbracketed, {
		all: true,
		order: "verbatim"
	}), signal) : [{
		address: unbracketed,
		family: literalFamily
	}];
	if (resolved.length === 0) throw new WebError(`hostname "${hostname}" resolved to no addresses`, "WEB_PROVIDER_ERROR");
	const addresses = [];
	for (const entry of resolved) {
		if (entry.family !== 4 && entry.family !== 6 || isIP(entry.address) !== entry.family) throw new WebError(`hostname "${hostname}" resolved to an invalid IP address`, "WEB_PROVIDER_ERROR");
		if (!allowPrivate && !isPublicIpAddress(entry.address)) throw new WebError(`URL hostname "${hostname}" resolves to a non-public IP address`, "WEB_BLOCKED_URL");
		addresses.push({
			address: entry.address,
			family: entry.family
		});
	}
	return addresses;
}
/** Resolve all addresses without filtering (shorthand for allowPrivate: true). */
function resolveAllAddresses(hostname, signal, resolver = lookup) {
	return resolveConfiguredAddresses(hostname, signal, true, resolver);
}
/** Race a non-cancellable OS lookup without letting it delay tool cancellation. */
function raceWithSignal(promise, signal) {
	const abortError = () => new Error("web fetch aborted during hostname resolution", { cause: signal.reason });
	if (signal.aborted) return Promise.reject(abortError());
	return new Promise((resolve, reject) => {
		const abort = () => {
			reject(abortError());
		};
		signal.addEventListener("abort", abort, { once: true });
		promise.then(resolve, reject).finally(() => {
			signal.removeEventListener("abort", abort);
		});
	});
}
/** WHATWG URL retains brackets around IPv6 hostnames; IP parsers do not. */
function stripIpv6Brackets(hostname) {
	return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}
//#endregion
//#region src/provider.ts
const PRIVATE_FETCH_PROVIDER_ID = "http-private";
var PrivateHttpFetchProvider = class {
	id;
	inner;
	checkAllowed;
	constructor(limits, allowPrivateNetworks = false, customResolver, providerId = PRIVATE_FETCH_PROVIDER_ID) {
		this.id = providerId;
		this.checkAllowed = typeof allowPrivateNetworks === "function" ? allowPrivateNetworks : () => allowPrivateNetworks;
		const resolver = customResolver ?? ((hostname, signal) => resolveConfiguredAddresses(hostname, signal, this.checkAllowed()));
		this.inner = new HttpFetchProvider(limits, resolver);
	}
	available() {
		return this.inner.available();
	}
	async fetch(request, signal) {
		return await this.inner.fetch(request, signal);
	}
};
//#endregion
//#region src/index.ts
/**
* Configurable HTTP(S) `WebFetchProvider` plugin with optional private network access.
*
* @module dsh-config-web
*/
const MAX_NODE_TIMER_DELAY_MS = 2147483647;
/** Cordis plugin name used by loader diagnostics. */
const name = "config-web";
/** The web seam this provider registers into. */
const inject = ["web"];
const SchemaProto = Object.getPrototypeOf(z.boolean());
if (typeof SchemaProto.volatile !== "function") SchemaProto.volatile = function volatile() {
	if (this.meta?.volatile) throw new TypeError("volatile schema is already wrapped");
	return this.extra("volatile", true);
};
const Config = z.object({
	maxResponseBytes: z.number().default(5e6),
	maxBodyChars: z.number().default(1e5),
	timeoutMs: z.number().default(3e4),
	maxRedirects: z.number().default(5),
	userAgent: z.string().default(DEFAULT_USER_AGENT),
	allowPrivateNetworks: z.boolean().default(false).volatile(),
	providerId: z.string().default(PRIVATE_FETCH_PROVIDER_ID)
});
/** Extract current allowPrivateNetworks value whether passed as scalar or Volatile handle. */
function getAllowPrivate(config) {
	const val = config.allowPrivateNetworks;
	if (typeof val === "object" && val !== null && "get" in val && typeof val.get === "function") return Boolean(val.get());
	return Boolean(val);
}
function stateFilePath() {
	const home = process.env.DSH_HOME || join(process.env.HOME || "", ".dsh");
	return join(home, "dsh-config-web.json");
}
function loadSavedState() {
	try {
		const file = stateFilePath();
		if (existsSync(file)) {
			const data = JSON.parse(readFileSync(file, "utf8"));
			if (typeof data.allowPrivateNetworks === "boolean") return data.allowPrivateNetworks;
		}
	} catch {}
}
function saveState(allowed) {
	try {
		const file = stateFilePath();
		writeFileSync(file, JSON.stringify({ allowPrivateNetworks: allowed }, null, 2));
	} catch (err) {
		console.error("[dsh-config-web] Failed to save state:", err);
	}
}
function readJson(req) {
	return new Promise((resolve, reject) => {
		let data = "";
		req.on("data", (chunk) => {
			data += chunk;
		});
		req.on("end", () => {
			try {
				resolve(data ? JSON.parse(data) : {});
			} catch (err) {
				reject(err);
			}
		});
		req.on("error", reject);
	});
}
function sendJson(res, status, data) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(data));
}
function assertPositiveFinite(name, value) {
	if (!Number.isFinite(value) || value <= 0) throw new Error(`config-web: ${name} must be a positive finite number`);
}
function assertTimeoutMs(value) {
	assertPositiveFinite("timeoutMs", value);
	if (value > MAX_NODE_TIMER_DELAY_MS) throw new Error(`config-web: timeoutMs must be no greater than ${MAX_NODE_TIMER_DELAY_MS}`);
}
function assertNonNegativeInteger(name, value) {
	if (!Number.isInteger(value) || value < 0) throw new Error(`config-web: ${name} must be a non-negative integer`);
}
/** Register the configurable HTTP(S) fetch provider with `ctx.web`. */
function apply(ctx, config) {
	const resolved = config;
	assertPositiveFinite("maxResponseBytes", resolved.maxResponseBytes);
	assertPositiveFinite("maxBodyChars", resolved.maxBodyChars);
	assertTimeoutMs(resolved.timeoutMs);
	assertNonNegativeInteger("maxRedirects", resolved.maxRedirects);
	const savedState = loadSavedState();
	let liveAllowed = savedState !== void 0 ? savedState : getAllowPrivate(config);
	const limits = {
		maxResponseBytes: resolved.maxResponseBytes,
		maxBodyChars: resolved.maxBodyChars,
		timeoutMs: resolved.timeoutMs,
		maxRedirects: resolved.maxRedirects,
		userAgent: resolved.userAgent
	};
	ctx.web.registerFetchProvider(new PrivateHttpFetchProvider(limits, () => liveAllowed, void 0, resolved.providerId));
	const anyCtx = ctx;
	if (typeof anyCtx.inject === "function") {
		anyCtx.inject(["settings"], (scopedCtx) => {
			try {
				if (typeof scopedCtx.settings?.register === "function") {
					const settingsSchema = z.object({ allowPrivateNetworks: z.boolean().default(false) });
					const scope = scopedCtx.settings.register("config-web", settingsSchema, { base: { allowPrivateNetworks: liveAllowed } });
					if (scope?.watch) scope.watch(() => {
						const val = scope.get()?.allowPrivateNetworks;
						if (typeof val === "boolean") {
							liveAllowed = val;
							saveState(liveAllowed);
						}
					});
				}
			} catch {}
		});
		anyCtx.inject(["webServer"], (scoped) => {
			scoped.webServer?.register?.({
				kind: "exact",
				path: "/api/dsh-config-web/state",
				handler: (_req, res) => {
					sendJson(res, 200, { allowPrivateNetworks: liveAllowed });
				}
			});
			scoped.webServer?.register?.({
				kind: "exact",
				path: "/api/dsh-config-web/toggle",
				handler: async (req, res) => {
					if (req.method !== "POST") {
						res.writeHead(405);
						res.end();
						return;
					}
					try {
						const body = await readJson(req);
						if (typeof body.allowPrivateNetworks === "boolean") {
							liveAllowed = body.allowPrivateNetworks;
							saveState(liveAllowed);
						}
						sendJson(res, 200, {
							ok: true,
							allowPrivateNetworks: liveAllowed
						});
					} catch (err) {
						sendJson(res, 400, { error: String(err) });
					}
				}
			});
		});
	}
}
//#endregion
export { Config, PRIVATE_FETCH_PROVIDER_ID, PrivateHttpFetchProvider, apply, inject, isPublicIpAddress, name, resolveAllAddresses, resolveConfiguredAddresses };
