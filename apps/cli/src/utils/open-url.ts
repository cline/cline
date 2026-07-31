import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const OPEN_TIMEOUT_MS = 2000;

type Opener = { command: string; args: string[] };

let cachedIsWsl: boolean | undefined;
function isWsl(): boolean {
	if (cachedIsWsl === undefined) {
		if (process.platform !== "linux") {
			cachedIsWsl = false;
			return cachedIsWsl;
		}
		let markedByKernel = false;
		try {
			markedByKernel = readFileSync("/proc/version", "utf8")
				.toLowerCase()
				.includes("microsoft");
		} catch {}
		// Custom WSL2 kernels drop the "microsoft" marker, so fall back to the
		// interop artifacts WSL always creates.
		cachedIsWsl =
			markedByKernel ||
			existsSync("/proc/sys/fs/binfmt_misc/WSLInterop") ||
			existsSync("/run/WSL");
	}
	return cachedIsWsl;
}

let cachedWslMountPoint: string | undefined;
function wslDrivesMountPoint(): string {
	if (cachedWslMountPoint === undefined) {
		let mountPoint = "/mnt/";
		try {
			// `[automount] root = /windir/` relocates the Windows drives.
			const configured = /(?<!#.*)root\s*=\s*(?<root>.*)/
				.exec(readFileSync("/etc/wsl.conf", "utf8"))
				?.groups?.root?.trim();
			if (configured) {
				mountPoint = configured.endsWith("/") ? configured : `${configured}/`;
			}
		} catch {}
		cachedWslMountPoint = mountPoint;
	}
	return cachedWslMountPoint;
}

function powerShellCommands(): string[] {
	if (process.platform === "win32") {
		const systemRoot =
			process.env.SYSTEMROOT || process.env.windir || "C:\\Windows";
		return [
			`${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
			"powershell.exe",
		];
	}
	// Under WSL the absolute path has to come first: `[interop] appendWindowsPath
	// = false` is a common wsl.conf setting that keeps powershell.exe off $PATH.
	return [
		`${wslDrivesMountPoint()}c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`,
		"powershell.exe",
	];
}

/**
 * Openers to try, in order. Later entries are fallbacks for the ways the
 * earlier ones can be absent: a stripped PATH, a WSL distro with Windows
 * interop disabled, or a Linux container running on the WSL2 kernel (which
 * looks like WSL from /proc/version but has no Windows side at all).
 */
function openers(target: string): Opener[] {
	if (process.platform === "darwin") {
		return [
			{ command: "open", args: [target] },
			{ command: "/usr/bin/open", args: [target] },
		];
	}

	const list: Opener[] = [];
	if (process.platform === "win32" || isWsl()) {
		// -EncodedCommand sidesteps cmd/PowerShell quoting of the outer
		// command line entirely (URLs routinely contain `&`); single quotes
		// inside the PS string are escaped by doubling.
		const psCommand = `Start-Process '${target.replace(/'/g, "''")}'`;
		const args = [
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-EncodedCommand",
			Buffer.from(psCommand, "utf16le").toString("base64"),
		];
		for (const command of powerShellCommands()) {
			list.push({ command, args });
		}
	}
	if (process.platform !== "win32") {
		list.push({ command: "xdg-open", args: [target] });
	}
	return list;
}

function attemptOpen({ command, args }: Opener): Promise<boolean> {
	return new Promise((resolve) => {
		let subprocess: ReturnType<typeof spawn>;
		try {
			subprocess = spawn(command, args, {
				detached: true,
				stdio: "ignore",
			});
		} catch {
			resolve(false);
			return;
		}
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const settle = (opened: boolean): void => {
			if (settled) {
				return;
			}
			settled = true;
			if (timer) {
				clearTimeout(timer);
			}
			if (opened) {
				subprocess.unref();
			}
			resolve(opened);
		};
		// Same tick as spawn() — see the doc comment below for why this must
		// not move past an await boundary. The listeners are never detached,
		// so a post-spawn error can't escalate either.
		subprocess.once("error", () => settle(false));
		subprocess.once("spawn", () => settle(true));
		timer = setTimeout(() => settle(true), OPEN_TIMEOUT_MS);
		timer.unref?.();
	});
}

/**
 * Opens a URL or file path in the user's default handler without ever
 * crashing the CLI.
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
 * of the target anywhere.
 *
 * Resolves `true` once an opener process spawns, `false` when none could be
 * launched — callers should then surface the URL so the user can visit it
 * manually.
 */
export function openUrlInBrowser(url: string): Promise<boolean> {
	const candidates = openers(url);
	const next = (index: number): Promise<boolean> => {
		const candidate = candidates[index];
		if (!candidate) {
			return Promise.resolve(false);
		}
		return attemptOpen(candidate).then((opened) => opened || next(index + 1));
	};
	return next(0);
}
