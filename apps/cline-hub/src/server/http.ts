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

function isWebviewRoute(pathname: string): boolean {
	return (
		pathname === "/" ||
		pathname === "/index.html" ||
		pathname === "/chat" ||
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
				headers: { "content-type": "text/html; charset=utf-8" },
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
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		}
		if (isWebviewRoute(pathname)) {
			return this.serveIndex();
		}

		const filePath = this.resolveStaticPath(pathname);
		if (!filePath) return createTextResponse("not found", 404);
		const file = Bun.file(filePath);
		if (!(await file.exists())) {
			return createTextResponse("not found", 404);
		}
		return new Response(file, {
			headers: { "content-type": contentTypeFor(filePath) },
		});
	}
}
