/**
 * Dev helper: serve `dist/webview` the way the extension would, but in a
 * normal browser tab. Spawns the backend, rewrites index.html with the same
 * `buildWebviewHtml` the extension uses, and serves assets under a
 * non-root prefix so the Turbopack chunk-base patch is exercised too.
 *
 *   bun run scripts/preview-server.ts [--port 3131]
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DesktopBackend, resolveDefaultBackendEntry } from "../src/backend";
import { buildWebviewHtml } from "../src/webview-html";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST = join(ROOT, "dist", "webview");
const PREFIX = "/ext-resources";
const portArg = process.argv.indexOf("--port");
const PORT = portArg >= 0 ? Number(process.argv[portArg + 1]) : 3131;
const HOST_COMMANDS = ["pick_workspace_directory", "open_external_url"];

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".png": "image/png",
	".svg": "image/svg+xml",
	".woff2": "font/woff2",
	".txt": "text/plain",
};

const backend = new DesktopBackend({
	runtimePath: process.env.BUN_PATH ?? "bun",
	entryPath: resolveDefaultBackendEntry(ROOT),
	workspaceRoot: resolve(ROOT, "..", "..", ".."),
	trustedOrigins: [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`],
	logger: { log: console.log, error: console.error },
});

const endpoint = await backend.ready();
const origin = `http://127.0.0.1:${PORT}`;
const resolveAsset = (relativePath: string) => `${origin}${PREFIX}/${relativePath}`;

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", origin);
	try {
		if (url.pathname === "/" || url.pathname === "/index.html") {
			const html = await readFile(join(DIST, "index.html"), "utf8");
			res.writeHead(200, { "content-type": MIME[".html"] });
			res.end(
				buildWebviewHtml({
					html,
					resolveAsset,
					cspSource: origin,
					wsEndpoint: endpoint.wsEndpoint,
					hostCommands: HOST_COMMANDS,
					chunkBaseUrl: resolveAsset("_next/"),
				}),
			);
			return;
		}
		if (url.pathname.startsWith(`${PREFIX}/`)) {
			const relative = decodeURIComponent(url.pathname.slice(PREFIX.length + 1));
			const file = join(DIST, relative);
			if (!file.startsWith(DIST)) {
				res.writeHead(403).end();
				return;
			}
			const body = await readFile(file);
			res.writeHead(200, {
				"content-type": MIME[extname(file)] ?? "application/octet-stream",
			});
			res.end(body);
			return;
		}
		res.writeHead(404).end("not found");
	} catch (error) {
		res.writeHead(500).end(error instanceof Error ? error.message : String(error));
	}
});

server.listen(PORT, "127.0.0.1", () => {
	console.log(`preview: ${origin}/  (backend ${endpoint.endpoint})`);
});

const shutdown = async () => {
	server.close();
	await backend.stop();
	process.exit(0);
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
