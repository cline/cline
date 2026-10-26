/**
 * Adapts the desktop app's Next.js static export (`webview/out/index.html`)
 * for a VS Code webview.
 *
 * - Absolute `/_next/...` and `/icon.png` style asset URLs become
 *   `vscode-webview` resource URIs.
 * - A CSP is injected that allows those resources plus the loopback
 *   WebSocket/HTTP endpoints of the desktop backend.
 * - A bootstrap script publishes the backend endpoint and host-shell
 *   configuration on `window` before any app chunk runs.
 *
 * Kept free of `vscode` imports so it can be unit-tested with vitest.
 */

export type WebviewHtmlOptions = {
	/** Raw contents of the exported index.html. */
	html: string;
	/** Maps an export-relative path (e.g. `_next/static/x.js`) to a webview URI. */
	resolveAsset: (relativePath: string) => string;
	/** `webview.cspSource`. */
	cspSource: string;
	/** `ws://127.0.0.1:PORT/transport?approval_token=...` */
	wsEndpoint: string;
	/** Commands the host answers natively (see host-shell.ts in the webview). */
	hostCommands: string[];
	/** Turbopack's runtime loads additional chunks from `location.origin + "/_next/"` unless told otherwise. */
	chunkBaseUrl: string;
};

const ABSOLUTE_ASSET_ATTR = /(src|href)="\/((?!\/)[^"]*)"/g;
// The React Flight payload inlined by Next (`self.__next_f.push(...)`) lists
// every client chunk as an escaped JSON string: `\"/_next/static/chunks/x.js\"`.
// The flight client loads those by URL, so they need the same prefix.
const FLIGHT_CHUNK_REF = /\\"\/_next\/([^"\\]+)\\"/g;

function escapeForInlineScript(value: unknown): string {
	return JSON.stringify(value).replace(/<\//g, "<\\/");
}

export function httpEndpointFromWs(wsEndpoint: string): string {
	const url = new URL(wsEndpoint);
	url.protocol = url.protocol === "wss:" ? "https:" : "http:";
	url.pathname = url.pathname.replace(/\/transport$/, "");
	url.search = "";
	url.hash = "";
	return url.toString().replace(/\/$/, "");
}

/**
 * Rewrite root-relative asset references to webview URIs. Links to `/`
 * itself (the preconnect hint, the router's own href) are left alone.
 */
export function rewriteAssetUrls(
	html: string,
	resolveAsset: (relativePath: string) => string,
): string {
	return html
		.replace(ABSOLUTE_ASSET_ATTR, (match, attr, relativePath) => {
			if (!relativePath) return match;
			return `${attr}="${resolveAsset(relativePath)}"`;
		})
		.replace(
			FLIGHT_CHUNK_REF,
			(_match, relativePath) => `\\"${resolveAsset(`_next/${relativePath}`)}\\"`,
		);
}

export function buildBootstrapScript(options: {
	wsEndpoint: string;
	hostCommands: string[];
	chunkBaseUrl: string;
}): string {
	const chunkBase = options.chunkBaseUrl.endsWith("/")
		? options.chunkBaseUrl
		: `${options.chunkBaseUrl}/`;
	return `<script>
(function () {
	var vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;
	window.__SIDECAR_WS_ENDPOINT__ = ${escapeForInlineScript(options.wsEndpoint)};
	window.__CLINE_HOST_SHELL__ = { kind: "vscode", commands: ${escapeForInlineScript(options.hostCommands)} };
	document.documentElement.dataset.clineHost = "vscode";
	// VS Code publishes its theme on <body data-vscode-theme-kind> and its
	// colours/font as inline --vscode-* custom properties on <html>. React
	// hydration replaces both elements' attributes, wiping them. Snapshot
	// them into a stylesheet + a stable <meta> before any chunk runs, and
	// refresh whenever VS Code re-applies them (theme change, zoom).
	// One <style> carries both the copied variables and (as data-*) the theme
	// kind / font size. React removes unknown <meta> tags from <head> during
	// hydration but leaves this element alone.
	var sheet = document.createElement("style");
	sheet.id = "cline-host-appearance";
	var mirror = sheet;
	var snapshot = function () {
		var root = document.documentElement;
		var inline = root.style;
		var decls = [];
		for (var i = 0; i < inline.length; i++) {
			var prop = inline[i];
			if (prop.indexOf("--vscode-") === 0) {
				decls.push(prop + ":" + inline.getPropertyValue(prop));
			}
		}
		// React hydration clears <html style>; keep the last real snapshot then.
		if (!decls.length && !(document.body && document.body.dataset.vscodeThemeKind)) return;
		if (decls.length) sheet.textContent = ":root{" + decls.join(";") + "}";
		var kind = document.body && document.body.dataset.vscodeThemeKind;
		if (!kind) {
			// <body> may not exist yet, or React may have rewritten it. Derive
			// the kind from the editor background VS Code always provides.
			var bg = inline.getPropertyValue("--vscode-editor-background").trim();
			var m = /^#([0-9a-f]{6})/i.exec(bg);
			if (m) {
				var n = parseInt(m[1], 16);
				var lum = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
				kind = lum < 0.5 ? "vscode-dark" : "vscode-light";
			}
		}
		if (kind) mirror.dataset.themeKind = kind;
		var cs = getComputedStyle(root);
		var size = cs.getPropertyValue("--vscode-font-size").trim();
		if (size) mirror.dataset.fontSize = size;
		if (root.dataset.clineHost !== "vscode") root.dataset.clineHost = "vscode";
		document.dispatchEvent(new Event("cline-host-appearance"));
	};
	document.head.appendChild(sheet);
	snapshot();
	var scheduled = false;
	var schedule = function () {
		if (scheduled) return;
		scheduled = true;
		requestAnimationFrame(function () { scheduled = false; snapshot(); });
	};
	new MutationObserver(function (records) {
		// Only VS Code's own updates carry --vscode-* vars; React's rewrites
		// of <html style> (font-size) must not re-snapshot an empty set.
		for (var r = 0; r < records.length; r++) {
			var target = records[r].target;
			if (target === document.body) { schedule(); return; }
			if (target.style && target.style.getPropertyValue("--vscode-font-size")) { schedule(); return; }
		}
	}).observe(document.documentElement, { attributes: true, subtree: false });
	document.addEventListener("DOMContentLoaded", function () {
		// <body> did not exist for the first snapshot; take its theme kind now.
		snapshot();
		new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ["data-vscode-theme-kind", "class"] });
	});
	window.__CLINE_HOST_POST_MESSAGE__ = function (message) {
		if (!vscode) { throw new Error("VS Code API unavailable"); }
		vscode.postMessage(message);
	};
	// Turbopack resolves lazy chunks against location.origin + "/_next/"; in a
	// VS Code webview the origin is an opaque vscode-webview:// URL, so point
	// it at the extension's resource root instead.
	window.TURBOPACK_CHUNK_BASE_PATH = ${escapeForInlineScript(chunkBase)};
	window.__NEXT_ASSET_PREFIX__ = ${escapeForInlineScript(chunkBase.replace(/\/_next\/$/, ""))};
})();
</script>`;
}

export function buildCsp(options: {
	cspSource: string;
	wsEndpoint: string;
}): string {
	const httpEndpoint = httpEndpointFromWs(options.wsEndpoint);
	const wsOrigin = new URL(options.wsEndpoint).origin.replace(/^http/, "ws");
	return [
		"default-src 'none'",
		`img-src ${options.cspSource} data: blob: https:`,
		`media-src ${options.cspSource} data: blob:`,
		`style-src ${options.cspSource} 'unsafe-inline'`,
		`font-src ${options.cspSource} data:`,
		// Next's exported HTML contains inline hydration scripts
		// (`self.__next_f.push(...)`) without nonces, so 'unsafe-inline' is
		// unavoidable for a prototype. Deliberately NO nonce here: a nonce (or
		// hash) in script-src makes CSP3 browsers ignore 'unsafe-inline', which
		// would silently drop the React Flight payload and leave the app stuck
		// on "Starting Cline…".
		`script-src ${options.cspSource} 'unsafe-inline' 'unsafe-eval'`,
		`connect-src ${options.cspSource} ${wsOrigin} ${httpEndpoint} https:`,
		`worker-src ${options.cspSource} blob:`,
	].join("; ");
}

export function buildWebviewHtml(options: WebviewHtmlOptions): string {
	const csp = buildCsp(options);
	const bootstrap = buildBootstrapScript(options);
	let html = rewriteAssetUrls(options.html, options.resolveAsset);
	const headTag = /<head([^>]*)>/i;
	if (!headTag.test(html)) {
		throw new Error("exported index.html is missing a <head> element");
	}
	html = html.replace(
		headTag,
		(_match, attrs) =>
			`<head${attrs}>\n<meta http-equiv="Content-Security-Policy" content="${csp}" />\n${bootstrap}`,
	);
	return html;
}

export function parseBackendReadyLine(
	line: string,
): { endpoint: string; wsEndpoint: string; pid: number } | undefined {
	const trimmed = line.trim();
	if (!trimmed.startsWith("{")) return undefined;
	try {
		const parsed = JSON.parse(trimmed) as Record<string, unknown>;
		if (
			parsed.type === "ready" &&
			typeof parsed.endpoint === "string" &&
			typeof parsed.wsEndpoint === "string" &&
			typeof parsed.pid === "number"
		) {
			return {
				endpoint: parsed.endpoint,
				wsEndpoint: parsed.wsEndpoint,
				pid: parsed.pid,
			};
		}
	} catch {
		// Non-JSON log line; ignore.
	}
	return undefined;
}
