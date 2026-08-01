import { accessSync, constants as fsConstants, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import realOpen from "open";

/**
 * Drop-in replacement for the `open` package's default export that handles
 * Linux hosts without `xdg-open`. Import this module instead of `open`;
 * everything else about how `open` is called stays the same.
 *
 * Why this is needed:
 *
 * 1. The missing-binary failure cannot be handled around the `open()` call.
 *    With `{ wait: false }` it resolves to a detached, listenerless child
 *    before the opener binary is known to exist, and the ENOENT arrives as
 *    an asynchronous `error` event on that child. Under Bun — the runtime
 *    the compiled CLI ships on — the event fires before the microtask queue
 *    drains, so no `try/catch` or `.catch()` can intercept it and it
 *    escalates to an uncaughtException that kills the process. This wrapper
 *    instead rejects up front (which the call sites' existing `.catch()`
 *    fallbacks handle) rather than ever letting `open` spawn a missing
 *    binary.
 *
 * 2. The `open` package ships its own copy of the `xdg-open` script as a
 *    fallback for hosts without xdg-utils (the script internally tries
 *    gio/gvfs-open/kde-open/exo-open/D-Bus and `$BROWSER`), but it only
 *    uses the copy sitting next to its own `index.js` — a location that
 *    does not survive bundling: `Bun.build` inlines the JS without the
 *    script, and compiled binaries resolve it inside the virtual bunfs.
 *    The build ships the script with the CLI (bun.mts and script/build.ts),
 *    and this wrapper hands it to `open` explicitly via the `app` option.
 */

/**
 * WSL reports `process.platform === "linux"` but `open` launches URLs there
 * through `powershell.exe`, not `xdg-open`, so it must skip the fallback.
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

const open: typeof realOpen = async (target, options) => {
	if (
		process.platform === "linux" &&
		!options?.app &&
		!isWsl() &&
		!hasXdgOpen()
	) {
		const script = shippedXdgOpenScript();
		if (!script) {
			throw new Error("Cannot open browser: xdg-open is not available");
		}
		// Spawns the script with the target exactly like open would spawn its
		// own copy (same arguments, same stdio/detach handling).
		return realOpen(target, { ...options, app: { name: script } });
	}
	return realOpen(target, options);
};

export default open;
