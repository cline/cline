import {
	accessSync,
	constants as fsConstants,
	existsSync,
	readFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import open from "open";

/**
 * Docker (`/.dockerenv`) and Podman (`/run/.containerenv`) markers, matching
 * the `is-inside-container` check inside the `open` package's WSL detection.
 * Containers run by Docker Desktop for Windows (e.g. devcontainers) report a
 * WSL2 kernel in /proc/version but have no Windows interop, so `open` treats
 * them as plain Linux (`xdg-open`) — the preflight must match.
 */
function isInsideContainer(): boolean {
	return existsSync("/.dockerenv") || existsSync("/run/.containerenv");
}

/** Mirrors `is-wsl`, which the `open` package uses for platform routing. */
function isWsl(): boolean {
	try {
		return (
			process.platform === "linux" &&
			readFileSync("/proc/version", "utf8")
				.toLowerCase()
				.includes("microsoft") &&
			!isInsideContainer()
		);
	} catch {
		return false;
	}
}

/**
 * The absolute PowerShell path the `open` package spawns on WSL (via
 * `wsl-utils`): the Windows drive mount point — `/mnt/` unless overridden by
 * `root=` in /etc/wsl.conf — plus the canonical WindowsPowerShell location.
 */
function wslPowerShellPath(): string {
	let mountPoint = "/mnt/";
	try {
		const config = readFileSync("/etc/wsl.conf", "utf8");
		const match = /(?<!#.*)root\s*=\s*(?<mountPoint>.*)/.exec(config);
		const value = match?.groups?.mountPoint?.trim();
		if (value) {
			mountPoint = value.endsWith("/") ? value : `${value}/`;
		}
	} catch {}
	return `${mountPoint}c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`;
}

function isExecutable(filePath: string): boolean {
	try {
		accessSync(filePath, fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function hasExecutableOnPath(binary: string): boolean {
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (dir && isExecutable(join(dir, binary))) {
			return true;
		}
	}
	return false;
}

/**
 * Whether the binary `open()` is about to spawn actually exists, so that the
 * spawn cannot fail with ENOENT.
 *
 * Note: the `open` package ships a bundled `xdg-open` script it can fall
 * back to, but the CLI is bundled by `Bun.build` (see bun.mts), so that
 * script never exists next to the compiled bundle and `open` always resolves
 * to the system `xdg-open`. Checking PATH is therefore exact for the shipped
 * CLI; when running from source without a system `xdg-open` this preflight
 * is slightly conservative (manual-URL message instead of the bundled
 * script), which is safe.
 */
function openerBinaryAvailable(): boolean {
	if (process.platform !== "linux") {
		// macOS `open` and Windows PowerShell ship with the OS.
		return true;
	}
	if (isWsl()) {
		return isExecutable(wslPowerShellPath());
	}
	return hasExecutableOnPath("xdg-open");
}

/**
 * Opens a URL (or file path) in the user's default handler via the `open`
 * package without ever crashing the CLI.
 *
 * Why a preflight check instead of error handling: `open()` with
 * `{ wait: false }` resolves to the detached child process as soon as it is
 * spawned, before the opener binary is known to exist. When the binary is
 * missing (e.g. no `xdg-open` on a headless Linux box), the failure arrives
 * as an asynchronous `error` event on the listenerless child. Under Bun —
 * the runtime the compiled CLI ships on — that event fires before the
 * microtask queue drains, so no `try/catch` or `.catch()` around `open()`
 * can intercept it: it escalates to an uncaughtException and kills the
 * process. The only reliable way to keep using `open` is to never call it
 * when its opener binary is absent.
 *
 * Resolves `true` once the opener process spawns, `false` when the browser
 * could not be opened — callers should then surface the URL so the user can
 * visit it manually.
 */
export async function openUrlInBrowser(url: string): Promise<boolean> {
	if (!openerBinaryAvailable()) {
		return false;
	}
	try {
		await open(url, { wait: false });
		return true;
	} catch {
		return false;
	}
}
