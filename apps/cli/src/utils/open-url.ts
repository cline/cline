import { accessSync, constants as fsConstants, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import open from "open";

/**
 * WSL reports `process.platform === "linux"` but `open` launches URLs there
 * through `powershell.exe`, not `xdg-open`, so it must skip the check below.
 */
function isWsl(): boolean {
	try {
		return readFileSync("/proc/version", "utf8")
			.toLowerCase()
			.includes("microsoft");
	} catch {
		return false;
	}
}

function isExecutable(filePath: string): boolean {
	try {
		accessSync(filePath, fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function hasXdgOpen(): boolean {
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (dir && isExecutable(join(dir, "xdg-open"))) {
			return true;
		}
	}
	return false;
}

/**
 * The `open` package ships its own copy of the `xdg-open` script as a
 * fallback for Linux hosts without xdg-utils — the script internally tries
 * gio/gvfs-open/kde-open/exo-open/D-Bus and finally `$BROWSER`. However,
 * `open` only uses it when the file sits next to its own `index.js`, which
 * never survives bundling: `Bun.build` inlines the package's JS without the
 * script, so the shipped CLI otherwise has only the system `xdg-open`.
 *
 * The build therefore ships that script with the CLI — next to the compiled
 * binary (script/build.ts) and next to the bundle (bun.mts) — and this
 * helper locates it so it can be handed to `open()` explicitly.
 */
function shippedXdgOpenScript(): string | undefined {
	const candidates = [
		// Compiled binary: @cline/cli-linux-*/bin/cline -> bin/xdg-open.
		join(dirname(process.execPath), "xdg-open"),
		// Bundled dist/index.js -> dist/xdg-open.
		join(dirname(fileURLToPath(import.meta.url)), "xdg-open"),
	];
	try {
		// Running from source: use the script inside the open package itself
		// (the same file open would resolve on its own in this case).
		candidates.push(
			join(dirname(fileURLToPath(import.meta.resolve("open"))), "xdg-open"),
		);
	} catch {}
	return candidates.find((candidate) => isExecutable(candidate));
}

/**
 * Opens a URL (or file path) in the user's default handler via the `open`
 * package without crashing the CLI when Linux has no `xdg-open`.
 *
 * The missing-binary failure cannot be handled around the `open()` call:
 * with `{ wait: false }` it resolves to a detached, listenerless child
 * before the opener binary is known to exist, and the ENOENT arrives as an
 * asynchronous `error` event on that child. Under Bun — the runtime the
 * compiled CLI ships on — the event fires before the microtask queue
 * drains, so no `try/catch` or `.catch()` can intercept it and it escalates
 * to an uncaughtException that kills the process. Hence every spawn target
 * is verified to exist up front.
 *
 * Resolves `true` once the opener process spawns, `false` when the browser
 * could not be opened — callers should then surface the URL so the user can
 * visit it manually.
 */
export async function openUrlInBrowser(url: string): Promise<boolean> {
	let app: { name: string } | undefined;
	if (process.platform === "linux" && !isWsl() && !hasXdgOpen()) {
		const script = shippedXdgOpenScript();
		if (!script) {
			return false;
		}
		app = { name: script };
	}
	try {
		await open(url, { wait: false, app });
		return true;
	} catch {
		return false;
	}
}
