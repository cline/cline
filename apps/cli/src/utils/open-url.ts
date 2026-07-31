import open from "open";

/**
 * Opens a URL in the user's default browser without ever crashing the CLI.
 *
 * `open()` with `wait: false` resolves to the detached child process before
 * the opener binary is known to exist. When it doesn't (e.g. no `xdg-open`
 * on a headless Linux box), the failure arrives later as an async `error`
 * event on the child — with no listener attached, that escalates to an
 * uncaughtException that kills the whole process, bypassing any try/catch
 * or `.catch()` at the call site.
 *
 * Resolves `true` once the opener process spawns, `false` when the browser
 * could not be opened — callers should then surface the URL so the user can
 * visit it manually.
 */
export async function openUrlInBrowser(url: string): Promise<boolean> {
	try {
		const subprocess = await open(url, { wait: false });
		return await new Promise<boolean>((resolve) => {
			// Permanent no-op listener so a post-spawn `error` can never
			// become an uncaughtException.
			subprocess.on("error", () => {});
			subprocess.once("error", () => resolve(false));
			subprocess.once("spawn", () => resolve(true));
			// `spawn` event support varies across runtimes; don't hang if
			// neither event fires.
			const timer = setTimeout(() => resolve(true), 2000);
			timer.unref?.();
		});
	} catch {
		return false;
	}
}
