import { type ChildProcess, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { ComputerUseClient } from "./client";
import { GET_DISPLAY_INFO_ACTION } from "./protocol";

/**
 * Brings the computer-use backend back when its process is gone.
 *
 * The backend (qwanban's qbt) is a separate process the agent host does not
 * own: it may be started by a human, a service, or this module. The single
 * rule that keeps ownership unambiguous: this module only ever terminates a
 * backend it spawned itself. `ensureRunning` therefore probes first and
 * returns `already_running` when the backend answers, spawns the configured
 * launch command only when disconnected, and kills its own spawn if it never
 * becomes ready.
 *
 * Readiness is the same query tool construction uses (`get_display_info`):
 * the port accepting is not enough — the backend must actually answer.
 */

const DEFAULT_PROBE_TIMEOUT_MS = 3_000;
const DEFAULT_READY_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

export interface ComputerBackendRestartOptions {
	/** Reuse the tools' connection. The caller retains ownership of this client. */
	client?: ComputerUseClient;
	/** Backend host, defaults to loopback. */
	host?: string;
	/** Backend TCP port, the same target the tools dial. */
	port: number;
	/**
	 * Shell command that starts the backend, e.g.
	 * `cargo run -- serve 1234 5678`. Runs via the platform shell, so a cd
	 * prefix or env vars are allowed; the backend must end up answering on
	 * `host`:`port`.
	 */
	command: string;
	/** Per-probe budget. Default 3 s. */
	probeTimeoutMs?: number;
	/** Overall wait for the spawned backend to answer. Default 120 s. */
	readyTimeoutMs?: number;
	/** Delay between readiness probes while waiting. Default 1 s. */
	pollIntervalMs?: number;
}

export type ComputerBackendEnsureResult =
	| { status: "already_running" }
	| { status: "started" }
	| { status: "failed_to_start"; error: string };

export class ComputerBackendRestart {
	private readonly options: ComputerBackendRestartOptions;
	private readonly probeTimeoutMs: number;
	private readonly readyTimeoutMs: number;
	private readonly pollIntervalMs: number;
	private readonly client: ComputerUseClient;
	private run:
		| {
				controller: AbortController;
				promise: Promise<ComputerBackendEnsureResult>;
		  }
		| undefined;
	private child: ChildProcess | undefined;
	private disposed = false;
	private disposePromise: Promise<void> | undefined;

	constructor(options: ComputerBackendRestartOptions) {
		this.options = { ...options };
		this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
		this.readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
		this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
		this.client =
			options.client ??
			new ComputerUseClient({
				host: options.host,
				port: options.port,
				connectTimeoutMs: this.probeTimeoutMs,
				requestTimeoutMs: this.probeTimeoutMs,
			});
	}

	/** Overall wait budget for a spawned backend to answer; hosts use it to size tool timeouts. */
	get budgetMs(): number {
		return this.readyTimeoutMs;
	}

	/**
	 * Probes the backend; spawns the launch command only when it is down.
	 * Concurrent calls share one run, so the backend is never spawned twice.
	 * Any caller's cancellation cancels that shared run, including owned cleanup.
	 */
	async ensureRunning(
		signal?: AbortSignal,
	): Promise<ComputerBackendEnsureResult> {
		if (this.disposed || signal?.aborted) {
			return {
				status: "failed_to_start",
				error: this.disposed
					? "backend restart disposed"
					: "backend restart cancelled",
			};
		}
		if (!this.run) {
			// Publish one run before probing; disposal and cancellation take effect
			// immediately and are checked after every wait before launch or success.
			const controller = new AbortController();
			const run = {
				controller,
				promise: Promise.resolve()
					.then(() => this.ensureRunningUncached(controller.signal))
					.finally(() => {
						if (this.run === run) this.run = undefined;
					}),
			};
			this.run = run;
		}
		const run = this.run;
		const onAbort = () =>
			run.controller.abort(new Error("backend restart cancelled"));
		signal?.addEventListener("abort", onAbort, { once: true });
		try {
			return await run.promise;
		} finally {
			signal?.removeEventListener("abort", onAbort);
		}
	}

	/**
	 * Terminates a backend this module spawned. Never touches a backend it
	 * did not spawn: a human- or service-owned backend outlives this process.
	 */
	async dispose(): Promise<void> {
		this.disposed = true;
		this.run?.controller.abort(new Error("backend restart disposed"));
		this.disposePromise ??= (async () => {
			await this.run?.promise;
			try {
				await this.killSpawned();
			} finally {
				if (!this.options.client) this.client.close();
			}
		})();
		return this.disposePromise;
	}

	private async ensureRunningUncached(
		signal: AbortSignal,
	): Promise<ComputerBackendEnsureResult> {
		let launched = false;
		try {
			signal.throwIfAborted();
			const running = await this.probe(signal);
			signal.throwIfAborted();
			if (running) return { status: "already_running" };
			await this.killSpawned();
			signal.throwIfAborted();
			const child = spawn(this.options.command, {
				shell: true,
				detached: true,
				stdio: "ignore",
			});
			this.child = child;
			launched = true;
			const launchFailure = new AbortController();
			child.once("error", (error) => launchFailure.abort(error));
			child.once("exit", (code, exitSignal) => {
				if (code === 0) {
					// A daemonized backend is not an owned child. Do not hunt for it.
					if (this.child === child) this.child = undefined;
				} else {
					launchFailure.abort(
						new Error(
							`launch command exited with ${
								exitSignal ? `signal ${exitSignal}` : `code ${code}`
							} before the backend answered`,
						),
					);
				}
			});
			child.unref();
			const readySignal = AbortSignal.any([signal, launchFailure.signal]);
			const deadline = Date.now() + this.readyTimeoutMs;
			while (Date.now() < deadline) {
				await delay(
					Math.min(this.pollIntervalMs, deadline - Date.now()),
					undefined,
					{ signal: readySignal },
				);
				readySignal.throwIfAborted();
				if (Date.now() >= deadline) break;
				const ready = await this.probe(
					readySignal,
					Math.min(this.probeTimeoutMs, deadline - Date.now()),
					true,
				);
				readySignal.throwIfAborted();
				if (ready) return { status: "started" };
			}
			throw new Error(`backend did not answer within ${this.readyTimeoutMs}ms`);
		} catch (error) {
			const reason = signal.aborted ? signal.reason : error;
			let message = reason instanceof Error ? reason.message : String(reason);
			// timers/promises wraps abort reasons in AbortError.cause.
			if (reason instanceof Error && reason.cause instanceof Error)
				message = reason.cause.message;
			try {
				if (launched) await this.killSpawned();
			} catch (cleanupError) {
				message += `; cleanup failed: ${String(cleanupError)}`;
			}
			return { status: "failed_to_start", error: message };
		}
	}

	private async probe(
		signal: AbortSignal,
		timeoutMs = this.probeTimeoutMs,
		starting = false,
	): Promise<boolean> {
		signal.throwIfAborted();
		const timeout = new AbortController();
		const timer = setTimeout(
			() => timeout.abort(new Error("backend probe timed out")),
			timeoutMs,
		);
		const probeSignal = AbortSignal.any([signal, timeout.signal]);
		const request = this.client.send(
			{ action: GET_DISPLAY_INFO_ACTION },
			{ signal: probeSignal },
		);
		let onAbort: () => void = () => {};
		try {
			const response = await Promise.race([
				request,
				new Promise<never>((_, reject) => {
					onAbort = () => reject(probeSignal.reason);
					probeSignal.addEventListener("abort", onAbort, { once: true });
					if (probeSignal.aborted) onAbort();
				}),
			]);
			if (!response.ok || !response.display) {
				throw new Error(
					response.error ?? "backend did not return display info",
				);
			}
			return true;
		} catch (error) {
			signal.throwIfAborted();
			// A queued request timing out does not establish that the backend died.
			// During startup keep waiting; before launch fail rather than duplicate it.
			if (!starting && (this.client.isConnected || timeout.signal.aborted)) {
				throw new Error(
					`backend did not answer the probe; refusing to launch a duplicate: ${String(error)}`,
				);
			}
			return false;
		} finally {
			clearTimeout(timer);
			probeSignal.removeEventListener("abort", onAbort);
			if (!this.options.client && probeSignal.aborted) {
				// send cannot cancel a pending TCP connect. Its bounded connect must
				// settle before closing an owned client, so it cannot reopen afterwards.
				await request.catch(() => {});
				this.client.close();
			}
		}
	}

	private async killSpawned(): Promise<void> {
		const child = this.child;
		if (!child) return;
		if (
			!child.pid ||
			child.exitCode === 0 ||
			(process.platform === "win32" &&
				(child.exitCode !== null || child.signalCode !== null))
		) {
			this.child = undefined;
			return;
		}
		if (process.platform === "win32") {
			// shell:true spawns cmd.exe wrapping the real backend: kill the
			// whole tree, not just the wrapper, and wait for taskkill to finish.
			await new Promise<void>((resolve, reject) => {
				const killer = spawn(
					"taskkill",
					["/pid", String(child.pid), "/T", "/F"],
					{ stdio: "ignore" },
				);
				killer.once("error", reject);
				killer.once("exit", (code) => {
					if (
						code === 0 ||
						child.exitCode !== null ||
						child.signalCode !== null
					)
						resolve();
					else reject(new Error(`taskkill exited with code ${code}`));
				});
			});
		} else {
			try {
				// detached:true makes the shell a process-group leader on Unix.
				process.kill(-child.pid, "SIGKILL");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
			}
		}
		if (child.exitCode === null && child.signalCode === null) {
			await new Promise<void>((resolve) => child.once("exit", () => resolve()));
		}
		if (this.child === child) this.child = undefined;
	}
}
