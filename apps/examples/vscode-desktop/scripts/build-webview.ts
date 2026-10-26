/**
 * Copies the desktop app's Next.js static export into this extension's
 * `dist/webview` and applies the small patches a VS Code webview needs.
 *
 * Run `bun run build:web` in apps/examples/desktop-app first (or let this
 * script do it with --build).
 */
import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSION_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DESKTOP_APP_ROOT = resolve(EXTENSION_ROOT, "..", "desktop-app");
const EXPORT_DIR = join(DESKTOP_APP_ROOT, "webview", "out");
const DIST_DIR = join(EXTENSION_ROOT, "dist", "webview");
const MEDIA_DIR = join(EXTENSION_ROOT, "media");

// Turbopack's browser runtime resolves lazily loaded chunks from a hardcoded
// "/_next/" prefix. Inside a vscode-webview:// origin that path does not
// exist, so make the prefix overridable from the bootstrap script.
const CHUNK_BASE_LITERAL = 'let t="/_next/"';
const CHUNK_BASE_PATCHED =
	'let t=globalThis.TURBOPACK_CHUNK_BASE_PATH||"/_next/"';

function patchTurbopackRuntime(chunksDir: string): void {
	const runtime = readdirSync(chunksDir).find(
		(name) => name.startsWith("turbopack-") && name.endsWith(".js"),
	);
	if (!runtime) {
		throw new Error(`turbopack runtime chunk not found in ${chunksDir}`);
	}
	const path = join(chunksDir, runtime);
	const source = readFileSync(path, "utf8");
	const occurrences = source.split(CHUNK_BASE_LITERAL).length - 1;
	if (occurrences !== 1) {
		throw new Error(
			`expected exactly one "${CHUNK_BASE_LITERAL}" in ${runtime}, found ${occurrences}. The Next/Turbopack runtime shape changed; update build-webview.ts.`,
		);
	}
	writeFileSync(path, source.replace(CHUNK_BASE_LITERAL, CHUNK_BASE_PATCHED));
	console.log(`patched chunk base path in ${runtime}`);
}

function main(): void {
	if (process.argv.includes("--build") || !existsSync(EXPORT_DIR)) {
		console.log("building desktop webview export…");
		const result = spawnSync("bun", ["run", "build:web"], {
			cwd: DESKTOP_APP_ROOT,
			stdio: "inherit",
		});
		if (result.status !== 0) {
			throw new Error("desktop webview build failed");
		}
	}
	if (!existsSync(join(EXPORT_DIR, "index.html"))) {
		throw new Error(`no static export at ${EXPORT_DIR}`);
	}

	rmSync(DIST_DIR, { recursive: true, force: true });
	mkdirSync(DIST_DIR, { recursive: true });
	cpSync(EXPORT_DIR, DIST_DIR, { recursive: true });
	patchTurbopackRuntime(join(DIST_DIR, "_next", "static", "chunks"));

	mkdirSync(MEDIA_DIR, { recursive: true });
	for (const icon of ["icon.png", "icon.svg"]) {
		const source = join(EXPORT_DIR, icon);
		if (existsSync(source)) cpSync(source, join(MEDIA_DIR, icon));
	}
	console.log(`webview copied to ${DIST_DIR}`);
}

main();
