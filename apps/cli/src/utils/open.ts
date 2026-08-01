import { accessSync, constants as fsConstants, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import realOpen from "open";

/**
 * Drop-in for the `open` package that doesn't crash Linux hosts missing
 * `xdg-open`. Import this instead of `open`; everything else stays the same.
 *
 * The crash cannot be handled around the `open()` call: with
 * `{ wait: false }` it resolves to a detached, listenerless child before the
 * opener binary is known to exist, and the ENOENT arrives as an
 * asynchronous `error` event on that child. Under Bun — the runtime the
 * compiled CLI ships on — the event fires before the microtask queue
 * drains, so no `try/catch` or `.catch()` can intercept it and it escalates
 * to an uncaughtException that kills the process. So the check happens
 * before `open()` is ever called, and failure surfaces as a normal
 * rejection that the call sites' existing `.catch()` fallbacks handle.
 */

function isExecutable(filePath: string): boolean {
	try {
		accessSync(filePath, fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * WSL reports `process.platform === "linux"` but `open` launches URLs there
 * through `powershell.exe`, not `xdg-open`, so it must skip the check.
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

function systemHasXdgOpen(): boolean {
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (dir && isExecutable(join(dir, "xdg-open"))) {
			return true;
		}
	}
	return false;
}

/**
 * The `open` package ships its own copy of the `xdg-open` script (it works
 * without xdg-utils, falling back to gio/kde-open/`$BROWSER` internally),
 * but only uses the copy next to its own `index.js` — a location that does
 * not survive Bun bundling/compiling. When a real copy is on disk anyway
 * (running from source, or an `xdg-open` placed next to the binary), hand
 * it to `open` explicitly.
 */
function packagedXdgOpenScript(): string | undefined {
	const candidates: string[] = [];
	try {
		candidates.push(
			join(dirname(fileURLToPath(import.meta.resolve("open"))), "xdg-open"),
		);
	} catch {}
	candidates.push(join(dirname(process.execPath), "xdg-open"));
	return candidates.find((candidate) => isExecutable(candidate));
}

const open: typeof realOpen = async (target, options) => {
	if (
		process.platform === "linux" &&
		!options?.app &&
		!isWsl() &&
		!systemHasXdgOpen()
	) {
		const script = packagedXdgOpenScript();
		if (!script) {
			throw new Error("Cannot open browser: xdg-open is not available");
		}
		return realOpen(target, { ...options, app: { name: script } });
	}
	return realOpen(target, options);
};

export default open;
