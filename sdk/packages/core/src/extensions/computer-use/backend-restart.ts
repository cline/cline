import { type ChildProcess, spawn } from "node:child_process";
import { connect, isIP } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { ComputerUseClient } from "./client";
import {
	type ComputerUseResponse,
	GET_DISPLAY_INFO_ACTION,
	SHUTDOWN_BACKEND_ACTION,
} from "./protocol";

/**
 * Brings the computer-use backend back when its process is gone.
 *
 * The backend (qwanban's qbt) is a separate process the agent host does not
 * own: it may be started by a human, a service, or this module. `ensureRunning`
 * never disrupts a responsive backend. Explicit forced recovery may ask the
 * qbt connected at the configured loopback endpoint to shut itself down; OS
 * process termination remains limited to a process tree this module spawned.
 * The replacement is launched only after the old endpoint closes.
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
	/** Working directory for the launch command. Defaults to the host process cwd. */
	cwd?: string;
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

export interface ComputerBackendRestartCapability {
	/** Overall wait budget; tool timeouts must outlive this. */
	budgetMs: number;
	ensureRunning(signal?: AbortSignal): Promise<ComputerBackendEnsureResult>;
	forceRestart(signal?: AbortSignal): Promise<ComputerBackendEnsureResult>;
}

/** Local process management is valid only when the configured backend is local. */
export function isComputerUseLoopbackHost(host: string | undefined): boolean {
	if (!host) return true;
	const normalized = host
		.trim()
		.toLowerCase()
		.replace(/^\[|\]$/g, "");
	if (normalized === "localhost" || normalized === "localhost.") return true;
	if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
	if (normalized.startsWith("::ffff:")) {
		const mappedIpv4 = normalized.slice("::ffff:".length);
		return isIP(mappedIpv4) === 4 && mappedIpv4.split(".")[0] === "127";
	}
	return isIP(normalized) === 4 && normalized.split(".")[0] === "127";
}

export class ComputerBackendRestart {
	private readonly options: ComputerBackendRestartOptions;
	private readonly probeTimeoutMs: number;
	private readonly readyTimeoutMs: number;
	private readonly pollIntervalMs: number;
	private readonly client: ComputerUseClient;
	private readonly processManagementEnabled: boolean;
	private run:
		| {
				kind: "ensure" | "force";
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
		this.processManagementEnabled = isComputerUseLoopbackHost(options.host);
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
	 * Cancellation stops only that caller's wait; disposal owns cancellation of
	 * the shared lifecycle operation.
	 */
	async ensureRunning(
		signal?: AbortSignal,
	): Promise<ComputerBackendEnsureResult> {
		return this.runOperation("ensure", signal);
	}

	/**
	 * Replaces the backend process this instance launched, even when it still
	 * answers probes. This recovers native resources that can become invalid
	 * while the process remains alive. A responsive process owned by someone
	 * else is never killed.
	 */
	async forceRestart(
		signal?: AbortSignal,
	): Promise<ComputerBackendEnsureResult> {
		while (this.run?.kind === "ensure") {
			const joined = await this.joinRun(this.run, signal);
			if (signal?.aborted) return joined;
		}
		return this.runOperation("force", signal);
	}

	private async runOperation(
		kind: "ensure" | "force",
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
				kind,
				controller,
				promise: Promise.resolve()
					.then(() =>
						kind === "force"
							? this.forceRestartUncached(controller.signal)
							: this.ensureRunningUncached(controller.signal),
					)
					.finally(() => {
						if (this.run === run) this.run = undefined;
					}),
			};
			this.run = run;
		}
		return this.joinRun(this.run, signal);
	}

	private async joinRun(
		run: NonNullable<ComputerBackendRestart["run"]>,
		signal?: AbortSignal,
	): Promise<ComputerBackendEnsureResult> {
		if (!signal) return run.promise;
		if (signal.aborted) return this.cancelledResult();
		let onAbort: () => void = () => {};
		const cancelled = new Promise<ComputerBackendEnsureResult>((resolve) => {
			onAbort = () => resolve(this.cancelledResult());
		});
		signal?.addEventListener("abort", onAbort, { once: true });
		try {
			return await Promise.race([run.promise, cancelled]);
		} finally {
			signal.removeEventListener("abort", onAbort);
		}
	}

	private cancelledResult(): ComputerBackendEnsureResult {
		return { status: "failed_to_start", error: "backend restart cancelled" };
	}

	private async forceRestartUncached(
		signal: AbortSignal,
	): Promise<ComputerBackendEnsureResult> {
		try {
			signal.throwIfAborted();
			if (!this.processManagementEnabled) {
				throw new Error(
					"backend process management is disabled for non-loopback hosts",
				);
			}
			if (!this.child) {
				await this.requestShutdown(signal);
			}
			await this.killSpawned();
			this.client.close();
			signal.throwIfAborted();
			return await this.launchBackend(signal);
		} catch (error) {
			return {
				status: "failed_to_start",
				error: this.errorMessage(signal.aborted ? signal.reason : error),
			};
		}
	}

	private async requestShutdown(signal: AbortSignal): Promise<void> {
		let response: ComputerUseResponse;
		try {
			response = await this.client.send(
				{ action: SHUTDOWN_BACKEND_ACTION },
				{ signal },
			);
		} catch (error) {
			signal.throwIfAborted();
			if ((error as NodeJS.ErrnoException).code !== "ECONNREFUSED") throw error;
			// A refused connection means there is no process to stop. Other
			// transport failures do not prove that launching a duplicate is safe.
			this.client.close();
			return;
		}
		if (!response.ok) {
			throw new Error(response.error ?? "backend refused shutdown");
		}
		this.client.close();
		const deadline = Date.now() + this.probeTimeoutMs;
		while (Date.now() < deadline) {
			signal.throwIfAborted();
			await delay(Math.min(50, deadline - Date.now()), undefined, { signal });
			if (await this.backendPortIsClosed(signal)) return;
		}
		throw new Error("backend acknowledged shutdown but did not exit");
	}

	private backendPortIsClosed(signal: AbortSignal): Promise<boolean> {
		return new Promise((resolve, reject) => {
			const socket = connect({
				host: this.options.host ?? "127.0.0.1",
				port: this.options.port,
			});
			let settled = false;
			const finish = (result: boolean, error?: Error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				signal.removeEventListener("abort", onAbort);
				socket.destroy();
				if (error) reject(error);
				else resolve(result);
			};
			const onAbort = () => finish(false, this.abortError(signal.reason));
			const timer = setTimeout(() => finish(false), 250);
			signal.addEventListener("abort", onAbort, { once: true });
			socket.once("connect", () => finish(false));
			socket.once("error", (error: NodeJS.ErrnoException) => {
				if (error.code === "ECONNREFUSED") finish(true);
				else finish(false, error);
			});
			if (signal.aborted) onAbort();
		});
	}

	private abortError(reason: unknown): Error {
		return reason instanceof Error ? reason : new Error(String(reason));
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
		try {
			signal.throwIfAborted();
			const running = await this.probe(signal);
			signal.throwIfAborted();
			if (running) return { status: "already_running" };
			if (!this.processManagementEnabled) {
				return {
					status: "failed_to_start",
					error:
						"backend process management is disabled for non-loopback hosts",
				};
			}
			await this.killSpawned();
			signal.throwIfAborted();
			return await this.launchBackend(signal);
		} catch (error) {
			return {
				status: "failed_to_start",
				error: this.errorMessage(signal.aborted ? signal.reason : error),
			};
		}
	}

	private async launchBackend(
		signal: AbortSignal,
	): Promise<ComputerBackendEnsureResult> {
		let launched = false;
		try {
			const child = spawn(this.options.command, {
				shell: true,
				detached: true,
				stdio: "ignore",
				cwd: this.options.cwd,
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
			let message = this.errorMessage(reason);
			try {
				if (launched) await this.killSpawned();
			} catch (cleanupError) {
				message += `; cleanup failed: ${String(cleanupError)}`;
			}
			return { status: "failed_to_start", error: message };
		}
	}

	private errorMessage(reason: unknown): string {
		if (reason instanceof Error && reason.cause instanceof Error) {
			return reason.cause.message;
		}
		return reason instanceof Error ? reason.message : String(reason);
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
