/**
 * CSP builder for the AI-Hydro HTML Preview webview.
 *
 * Design notes:
 *
 *   1. The preview webview hosts BOTH the React shell (file tree, toolbar)
 *      AND an iframe that renders the artifact via `srcdoc` (preferred) or
 *      `src` pointing at `webview.asWebviewUri()` (fallback for huge files).
 *
 *   2. When `srcdoc` is used the iframe is same-origin with the parent
 *      webview and inherits this CSP directly — so anything the artifact
 *      script tags pull must be in this allowlist.
 *
 *   3. When `src=<webviewUri>` is used the iframe is loaded from a
 *      *different* subdomain (`*.vscode-resource.vscode-cdn.net`). We must
 *      therefore also allow that origin in `frame-src` *and* still be
 *      permissive enough in `script-src`/`style-src` for whatever the
 *      iframe asks for, because VS Code propagates the parent CSP for
 *      several directives into the child frame.
 *
 *   4. CRITICAL: when `allowScripts === true` we DO NOT include a nonce
 *      in `script-src`. Per the CSP spec, the presence of a nonce in
 *      `script-src` makes browsers IGNORE `'unsafe-inline'` as a
 *      fallback-protection feature. Folium / Plotly / Bokeh artifacts
 *      ship raw `<script>…</script>` blocks without any nonce attribute,
 *      and we cannot retrofit nonces into pre-generated HTML — so they
 *      MUST execute under `'unsafe-inline'`. The shell's own scripts are
 *      loaded by URL from `${cspSource}`, so they still run without the
 *      nonce. In safe mode (`allowScripts === false`) we keep the nonce
 *      because no inline scripts should run at all.
 *
 *      This bit us in 0.1.18: Leaflet loaded (`L=true`), the map div was
 *      properly sized, but `tiles=0` and no zoom controls — because the
 *      inline `L.map(…)` init script was silently blocked by CSP.
 */

export interface BuildPreviewCspOptions {
	/** `webview.cspSource` — the origin VS Code uses for served resources. */
	cspSource: string
	/** Nonce used for the React shell's own <script> tags. */
	nonce: string
	/** Set to `true` if the active artifact needs scripts enabled. */
	allowScripts: boolean
}

/** Origins that scientific HTML artifacts commonly reference. */
const ARTIFACT_SCRIPT_CDNS: ReadonlyArray<string> = [
	"https://cdn.jsdelivr.net",
	"https://cdn.plot.ly",
	"https://cdnjs.cloudflare.com",
	"https://unpkg.com",
	"https://code.jquery.com",
	"https://maxcdn.bootstrapcdn.com",
	"https://netdna.bootstrapcdn.com",
	"https://stackpath.bootstrapcdn.com",
	"https://fonts.googleapis.com",
	"https://fonts.gstatic.com",
]

/** Origins typically used for map tiles (Leaflet / Folium). */
const ARTIFACT_TILE_CDNS: ReadonlyArray<string> = [
	"https://*.tile.openstreetmap.org",
	"https://*.tile.opentopomap.org",
	"https://*.basemaps.cartocdn.com",
	"https://server.arcgisonline.com",
	"https://*.stamen.com",
	"https://*.tile.stamen.com",
	"https://stamen-tiles*.a.ssl.fastly.net",
]

export function buildPreviewCsp(options: BuildPreviewCspOptions): string {
	const { cspSource, nonce, allowScripts } = options
	const cdnScripts = ARTIFACT_SCRIPT_CDNS.join(" ")
	const tileSources = ARTIFACT_TILE_CDNS.join(" ")

	// NOTE: in the interactive (`allowScripts === true`) branch we
	// deliberately OMIT the nonce. Listing a nonce in `script-src` causes
	// browsers to ignore `'unsafe-inline'`, which would block the inline
	// `L.map(...)` blocks that Folium / Plotly / Bokeh emit without nonces.
	// The shell's own scripts are loaded by URL from `${cspSource}`, so
	// they continue to execute fine without the nonce.
	const scriptSrc = allowScripts
		? `script-src 'unsafe-inline' 'unsafe-eval' ${cdnScripts} ${cspSource}`
		: `script-src 'nonce-${nonce}' ${cspSource}`

	const directives = [
		"default-src 'none'",
		scriptSrc,
		`style-src ${cspSource} 'unsafe-inline' ${cdnScripts}`,
		`font-src ${cspSource} data: ${cdnScripts}`,
		`img-src ${cspSource} https: data: blob: ${tileSources}`,
		// Manim video-render cells emit inline `<video src="data:video/mp4;…">`;
		// without an explicit media-src these are blocked under default-src 'none'.
		`media-src ${cspSource} data: blob:`,
		// Artifacts (Plotly, Leaflet) frequently make XHR/fetch requests for
		// tile data and asset bundles; we allow https: broadly here because
		// the iframe document context is the security boundary.
		`connect-src ${cspSource} https: data: blob:`,
		// `frame-src` controls iframes our React shell can load. We allow:
		//   • `'self'` — required by some CSP implementations for the
		//     `about:srcdoc` URL that `<iframe srcdoc>` resolves to.
		//   • `${cspSource}` — the webview's own origin; covers same-origin
		//     about:srcdoc loads.
		//   • `https://*.vscode-cdn.net` — covers VS Code's resource-serving
		//     subdomain when we fall back to `src=webviewUri` for very
		//     large artifacts.
		//   • `blob:` — kept for the "open in browser" fallback path.
		`frame-src 'self' ${cspSource} https://*.vscode-cdn.net blob:`,
		"worker-src blob:",
		"child-src blob:",
	]
	return directives.join("; ") + ";"
}
