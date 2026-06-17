import { extname, join, normalize, relative } from "node:path";
import process from "node:process";

export function createJsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

export function createTextResponse(text: string, status = 200): Response {
	return new Response(text, {
		status,
		headers: { "content-type": "text/plain; charset=utf-8" },
	});
}

const NO_STORE_HEADERS = {
	"cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
	pragma: "no-cache",
	expires: "0",
};

const IMMUTABLE_ASSET_CACHE = "public, max-age=31536000, immutable";

function contentTypeFor(path: string): string {
	switch (extname(path)) {
		case ".html":
			return "text/html; charset=utf-8";
		case ".js":
			return "text/javascript; charset=utf-8";
		case ".css":
			return "text/css; charset=utf-8";
		case ".svg":
			return "image/svg+xml";
		case ".png":
			return "image/png";
		case ".ico":
			return "image/x-icon";
		case ".woff2":
			return "font/woff2";
		default:
			return "application/octet-stream";
	}
}

export function isWebviewRoute(pathname: string): boolean {
	return (
		pathname === "/" ||
		pathname === "/index.html" ||
		pathname === "/chat" ||
		pathname === "/marketplace" ||
		pathname.startsWith("/marketplace/") ||
		pathname === "/settings" ||
		pathname.startsWith("/settings/")
	);
}

function renderDevIndexHtml(devServerUrl: string): string {
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script type="module">
    import RefreshRuntime from "${devServerUrl}/@react-refresh";
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
  </script>
  <script type="module" src="${devServerUrl}/@vite/client"></script>
  <link rel="icon" type="image/svg+xml" href="${devServerUrl}/favicon.svg" />
  <title>Cline Hub</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${devServerUrl}/src/main.tsx"></script>
</body>
</html>`;
}

/** Serves the built webview SPA and its static assets out of `webviewDistDir`. */
export class WebviewAssets {
	constructor(private readonly webviewDistDir: string) {}

	private async resolveCurrentMainAssetPath(): Promise<string | undefined> {
		const indexFile = Bun.file(join(this.webviewDistDir, "index.html"));
		if (!(await indexFile.exists())) return undefined;
		const html = await indexFile.text();
		const match = html.match(/src="\.\/(assets\/index-[^"]+\.js)"/);
		return match?.[1] ? join(this.webviewDistDir, match[1]) : undefined;
	}

	private resolveStaticPath(pathname: string): string | undefined {
		const decoded = decodeURIComponent(pathname);
		const requested = decoded === "/" ? "/index.html" : decoded;
		const normalized = normalize(requested).replace(/^(\.\.[/\\])+/, "");
		const relativePath = normalized.replace(/^[/\\]+/, "");
		const filePath = join(this.webviewDistDir, relativePath);
		if (relative(this.webviewDistDir, filePath).startsWith("..")) {
			return undefined;
		}
		return filePath;
	}

	private async serveIndex(): Promise<Response> {
		const indexFile = Bun.file(join(this.webviewDistDir, "index.html"));
		if (await indexFile.exists()) {
			return new Response(indexFile, {
				headers: {
					"content-type": "text/html; charset=utf-8",
					...NO_STORE_HEADERS,
				},
			});
		}
		return createTextResponse(
			"Cline Hub webview is not built. Run `bun run build:webview` from apps/cline-hub.",
			503,
		);
	}

	async serve(pathname: string): Promise<Response> {
		const devServerUrl = process.env.VITE_DEV_SERVER_URL?.trim();
		if (devServerUrl && isWebviewRoute(pathname)) {
			return new Response(renderDevIndexHtml(devServerUrl), {
				headers: {
					"content-type": "text/html; charset=utf-8",
					...NO_STORE_HEADERS,
				},
			});
		}
		if (isWebviewRoute(pathname)) {
			return this.serveIndex();
		}

		const filePath = this.resolveStaticPath(pathname);
		if (!filePath) return createTextResponse("not found", 404);
		let responsePath = filePath;
		let file = Bun.file(responsePath);
		if (
			!(await file.exists()) &&
			/^\/assets\/index-[A-Za-z0-9_-]+\.js$/.test(pathname)
		) {
			const currentMainAssetPath = await this.resolveCurrentMainAssetPath();
			if (currentMainAssetPath) {
				responsePath = currentMainAssetPath;
				file = Bun.file(responsePath);
			}
		}
		if (!(await file.exists())) {
			return createTextResponse("not found", 404);
		}
		const isHashedAsset = /^\/assets\/.+-[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(
			pathname,
		);
		return new Response(file, {
			headers: {
				"content-type": contentTypeFor(responsePath),
				"cache-control": isHashedAsset
					? IMMUTABLE_ASSET_CACHE
					: NO_STORE_HEADERS["cache-control"],
				...(isHashedAsset
					? {}
					: {
							pragma: NO_STORE_HEADERS.pragma,
							expires: NO_STORE_HEADERS.expires,
						}),
			},
		});
	}
}
