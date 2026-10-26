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
