import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import open from "open";

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

/**
 * Opens a URL in the user's default browser without ever crashing the CLI.
 *
 * A missing opener binary (e.g. no `xdg-open` on a headless Linux box)
 * surfaces as an asynchronous `error` event on the spawned child, not as a
 * throw from `spawn()`. Under Bun that event fires before the microtask
 * queue drains, so a listener attached after any `await` boundary — such as
 * awaiting the `open` package's promise — is too late: the listenerless
 * event escalates to an uncaughtException and kills the process. The only
 * reliable window is the same synchronous tick as the `spawn()` call, which
 * both Bun and Node guarantee (spawn errors are never emitted synchronously).
 *
 * macOS and non-WSL Linux therefore spawn their opener directly with
 * listeners attached in-tick. Windows and WSL delegate to the `open`
 * package for its shell quoting and interop routing; their openers
 * (cmd/powershell) always exist, so the post-await attachment there cannot
 * miss a missing-binary error.
 *
 * Resolves `true` once the opener process spawns, `false` when the browser
 * could not be opened — callers should then surface the URL so the user can
 * visit it manually.
 */
export function openUrlInBrowser(url: string): Promise<boolean> {
	if (
		process.platform === "darwin" ||
		(process.platform === "linux" && !isWsl())
	) {
		return spawnOpenerDirectly(
			process.platform === "darwin" ? "open" : "xdg-open",
			url,
		);
	}
	return openViaPackage(url);
}

function spawnOpenerDirectly(command: string, url: string): Promise<boolean> {
	return new Promise((resolve) => {
		let subprocess: ReturnType<typeof spawn>;
		try {
			subprocess = spawn(command, [url], {
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

async function openViaPackage(url: string): Promise<boolean> {
	try {
		const subprocess = await open(url, { wait: false });
		return await new Promise<boolean>((resolve) => {
			// Permanent no-op listener so a late `error` can never become an
			// uncaughtException.
			subprocess.on("error", () => {});
			subprocess.once("error", () => resolve(false));
			subprocess.once("spawn", () => resolve(true));
			// `spawn` event support varies across runtimes; don't hang if
			// neither event fires.
			const timer = setTimeout(() => resolve(true), OPEN_TIMEOUT_MS);
			timer.unref?.();
		});
	} catch {
		return false;
	}
}
