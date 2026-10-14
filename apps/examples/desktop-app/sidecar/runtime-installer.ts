import { spawn } from "node:child_process";

/** Own installer subprocesses so shutdown can stop them before SSH cleanup. */
export class RuntimeInstallers {
	private readonly controller = new AbortController();
	private readonly pending = new Set<Promise<void>>();

	run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
		if (this.controller.signal.aborted)
			return Promise.reject(new Error("Runtime installation cancelled"));
		const child = spawn(command, args, {
			env,
			detached: process.platform !== "win32",
			windowsHide: true,
			stdio: ["ignore", "ignore", "pipe"],
		});
		const promise = new Promise<void>((resolve, reject) => {
			let stderr = "";
			child.stderr.on("data", (data) => {
				stderr = (stderr + data.toString()).slice(-8192);
			});
			const terminate = () => {
				if (!child.pid) return;
				if (process.platform === "win32") {
					const killer = spawn(
						"taskkill",
						["/T", "/F", "/PID", String(child.pid)],
						{
							windowsHide: true,
							stdio: "ignore",
						},
					);
					killer.on("error", () => child.kill());
				} else {
					try {
						process.kill(-child.pid, "SIGKILL");
					} catch {
						child.kill("SIGKILL");
					}
				}
			};
			const timeout = setTimeout(terminate, 600_000);
			this.controller.signal.addEventListener("abort", terminate, {
				once: true,
			});
			const cleanup = () => {
				clearTimeout(timeout);
				this.controller.signal.removeEventListener("abort", terminate);
			};
			child.once("error", (error) => {
				cleanup();
				reject(error);
			});
			child.once("close", (code) => {
				cleanup();
				if (this.controller.signal.aborted)
					reject(new Error("Runtime installation cancelled"));
				else if (code === 0) resolve();
				else
					reject(
						new Error(`Runtime installer failed (${code}): ${stderr.trim()}`),
					);
			});
		});
		this.pending.add(promise);
		void promise.finally(() => this.pending.delete(promise)).catch(() => {});
		return promise;
	}

	async dispose(): Promise<void> {
		this.controller.abort();
		await Promise.allSettled(this.pending);
	}
}

export const desktopRuntimeInstallers = new RuntimeInstallers();
