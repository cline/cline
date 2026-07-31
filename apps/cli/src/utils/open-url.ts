import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const OPEN_TIMEOUT_MS = 2000;

let cachedIsWsl: boolean | undefined;
function isWsl(): boolean {
	if (cachedIsWsl === undefined) {
		try {
			cachedIsWsl =
				process.platform === "linux" &&
				readFileSync("/proc/version", "utf8")
					.toLowerCase()
					.includes("microsoft");
		} catch {
			cachedIsWsl = false;
		}
	}
	return cachedIsWsl;
}

function openerSpec(url: string): { command: string; args: string[] } {
	if (process.platform === "darwin") {
		return { command: "open", args: [url] };
	}
	if (process.platform === "win32" || isWsl()) {
		// -EncodedCommand sidesteps cmd/PowerShell quoting of the outer
		// command line entirely (URLs routinely contain `&`); single quotes
		// inside the PS string are escaped by doubling.
		const psCommand = `Start-Process '${url.replace(/'/g, "''")}'`;
		return {
			command: process.platform === "win32" ? "powershell" : "powershell.exe",
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
	return { command: "xdg-open", args: [url] };
}

/**
 * Opens a URL in the user's default browser without ever crashing the CLI.
 *
 * A missing opener binary (e.g. no `xdg-open` on a headless Linux box)
 * surfaces as an asynchronous `error` event on the spawned child, not as a
 * throw from `spawn()`. Under Bun that event fires before the microtask
 * queue drains, so a listener attached after any `await` boundary is too
 * late: the listenerless event escalates to an uncaughtException and kills
 * the process. The only reliable window is the same synchronous tick as the
 * `spawn()` call, which both Bun and Node guarantee (spawn errors are never
 * emitted synchronously) — so this helper spawns the platform opener
 * directly and attaches its listeners in-tick, with no shell interpolation
 * of the URL anywhere.
 *
 * Resolves `true` once the opener process spawns, `false` when the browser
 * could not be opened — callers should then surface the URL so the user can
 * visit it manually.
 */
export function openUrlInBrowser(url: string): Promise<boolean> {
	return new Promise((resolve) => {
		let subprocess: ReturnType<typeof spawn>;
		try {
			const { command, args } = openerSpec(url);
			subprocess = spawn(command, args, {
				detached: true,
				stdio: "ignore",
			});
		} catch {
			resolve(false);
			return;
		}
		// Same tick as spawn() — see the doc comment above for why this must
		// not move past an await boundary.
		subprocess.once("error", () => resolve(false));
		subprocess.once("spawn", () => {
			subprocess.unref();
			resolve(true);
		});
		const timer = setTimeout(() => resolve(true), OPEN_TIMEOUT_MS);
		timer.unref?.();
	});
}
