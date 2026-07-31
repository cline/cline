import { accessSync, constants as fsConstants, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
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

function hasXdgOpen(): boolean {
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (dir) {
			try {
				accessSync(join(dir, "xdg-open"), fsConstants.X_OK);
				return true;
			} catch {}
		}
	}
	return false;
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
 * to an uncaughtException that kills the process. Hence the check up front.
 *
 * Resolves `true` once the opener process spawns, `false` when the browser
 * could not be opened — callers should then surface the URL so the user can
 * visit it manually.
 */
export async function openUrlInBrowser(url: string): Promise<boolean> {
	if (process.platform === "linux" && !isWsl() && !hasXdgOpen()) {
		return false;
	}
	try {
		await open(url, { wait: false });
		return true;
	} catch {
		return false;
	}
}
