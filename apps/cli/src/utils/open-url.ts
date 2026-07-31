import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const OPEN_TIMEOUT_MS = 2000;

// Where Windows drives are mounted in a default WSL setup. Used as a
// fallback when `powershell.exe` is not on PATH (`appendWindowsPath=false`
// in /etc/wsl.conf).
const WSL_POWERSHELL_PATH =
	"/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";

/**
 * Docker (`/.dockerenv`) and Podman (`/run/.containerenv`) markers, matching
 * the `is-inside-container` check the `open` package used. Containers run by
 * Docker Desktop for Windows (e.g. devcontainers) report a WSL2 kernel in
 * /proc/version but have no Windows interop, so they must be treated as
 * plain Linux (`xdg-open`), not WSL (`powershell.exe`).
 */
function isInsideContainer(): boolean {
	return existsSync("/.dockerenv") || existsSync("/run/.containerenv");
}

let cachedIsWsl: boolean | undefined;
function isWsl(): boolean {
	if (cachedIsWsl === undefined) {
		try {
			cachedIsWsl =
				process.platform === "linux" &&
				readFileSync("/proc/version", "utf8")
					.toLowerCase()
					.includes("microsoft") &&
				!isInsideContainer();
		} catch {
			cachedIsWsl = false;
		}
	}
	return cachedIsWsl;
}

function isUrl(target: string): boolean {
	return /^[a-z][a-z\d+.-]*:\/\//i.test(target);
}

/**
 * `Start-Process` runs on the Windows side, so Linux file paths (e.g. the
 * log file from `cline doctor log`) must be converted to `\\wsl$\...` UNC
 * paths first. URLs pass through untouched; conversion failures fall back
 * to the original target.
 */
function convertWslPathToWindows(target: string): string {
	if (isUrl(target) || !target.startsWith("/")) {
		return target;
	}
	try {
		const converted = execFileSync("wslpath", ["-aw", target], {
			encoding: "utf8",
		}).trim();
		return converted || target;
	} catch {
		return target;
	}
}

type Opener = { command: string; args: string[] };

function powerShellOpener(command: string, target: string): Opener {
	// -EncodedCommand sidesteps cmd/PowerShell quoting of the outer command
	// line entirely (URLs routinely contain `&`); inside a single-quoted PS
	// string nothing is expanded, and single quotes are escaped by doubling.
	const psCommand = `Start-Process '${target.replace(/'/g, "''")}'`;
	return {
		command,
		args: [
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-EncodedCommand",
			Buffer.from(psCommand, "utf16le").toString("base64"),
		],
	};
}

/**
 * Ordered opener candidates for the current platform; each is tried until
 * one spawns successfully.
 */
function openerSpecs(target: string): Opener[] {
	if (process.platform === "darwin") {
		return [{ command: "open", args: [target] }];
	}
	if (process.platform === "win32") {
		const systemRoot =
			process.env.SYSTEMROOT || process.env.windir || "C:\\Windows";
		return [
			// Absolute path first (what the `open` package used, immune to a
			// stripped-down PATH), then PATH lookup as a safety net.
			powerShellOpener(
				`${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
				target,
			),
			powerShellOpener("powershell", target),
		];
	}
	if (isWsl()) {
		const windowsTarget = convertWslPathToWindows(target);
		return [
			// PATH lookup works when WSL interop appends the Windows PATH; the
			// absolute mount path covers `appendWindowsPath=false` setups. When
			// interop is disabled entirely (sandboxed WSL), fall back to a
			// Linux opener — WSLg or an X server may still be available.
			powerShellOpener("powershell.exe", windowsTarget),
			powerShellOpener(WSL_POWERSHELL_PATH, windowsTarget),
			{ command: "xdg-open", args: [target] },
		];
	}
	return [{ command: "xdg-open", args: [target] }];
}

/**
 * Spawns one opener candidate; resolves `true` once it spawns, `false` on
 * failure. A missing binary surfaces as an asynchronous `error` event on the
 * spawned child, not as a throw from `spawn()`. Under Bun that event fires
 * before the microtask queue drains, so a listener attached after any
 * `await` boundary is too late: the listenerless event escalates to an
 * uncaughtException and kills the process. The only reliable window is the
 * same synchronous tick as the `spawn()` call, which both Bun and Node
 * guarantee (spawn errors are never emitted synchronously) — so listeners
 * are attached in-tick, right after spawning.
 */
function trySpawn(opener: Opener): Promise<boolean> {
	return new Promise((resolve) => {
		let subprocess: ReturnType<typeof spawn>;
		try {
			subprocess = spawn(opener.command, opener.args, {
				detached: true,
				stdio: "ignore",
			});
		} catch {
			resolve(false);
			return;
		}
		subprocess.once("error", () => resolve(false));
		subprocess.once("spawn", () => {
			subprocess.unref();
			resolve(true);
		});
	});
}

/**
 * Opens a URL (or file path) with the user's default handler without ever
 * crashing the CLI — see `trySpawn` for why the error listener must be
 * attached in the same tick as `spawn()`, and note that no shell ever
 * interpolates the target anywhere.
 *
 * Resolves `true` once an opener process spawns, `false` when none could be
 * started — callers should then surface the URL so the user can visit it
 * manually.
 */
export function openUrlInBrowser(url: string): Promise<boolean> {
	// The first trySpawn happens synchronously inside this call (async
	// function bodies run synchronously until their first await), preserving
	// the in-tick listener guarantee for the common single-candidate case.
	const attempts = (async () => {
		for (const opener of openerSpecs(url)) {
			if (await trySpawn(opener)) {
				return true;
			}
		}
		return false;
	})();
	const timeout = new Promise<boolean>((resolve) => {
		const timer = setTimeout(() => resolve(true), OPEN_TIMEOUT_MS);
		timer.unref?.();
	});
	return Promise.race([attempts, timeout]);
}
