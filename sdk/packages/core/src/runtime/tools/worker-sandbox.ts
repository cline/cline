import { Worker } from "node:worker_threads";
import { withResolvedClineBuildEnv } from "@cline/shared";
import type { SandboxCallOptions } from "./subprocess-sandbox";
import {
	MAX_NODE_TIMER_DELAY_MS,
	normalizeIdleTimeoutMs,
} from "./subprocess-sandbox-lifecycle";

interface SandboxResponseMessage {
	type: "response";
	id: string;
	ok: boolean;
	result?: unknown;
	error?: { message: string; stack?: string };
}

interface SandboxEventMessage {
	type: "event";
	name: string;
	payload?: unknown;
}

/** Sent by the bootstrap once it listens for calls. */
interface SandboxReadyMessage {
	type: "ready";
}

export interface WorkerSandboxOptions {
	/** Inline CommonJS script to run as the worker (`eval: true`). Mutually exclusive with {@link bootstrapFile}. */
	bootstrapScript?: string;
	/** Path to a JavaScript file to run as the worker. Mutually exclusive with {@link bootstrapScript}. */
	bootstrapFile?: string;
	/**
	 * Terminate the worker after this many milliseconds with no calls in
	 * flight. The next call starts a fresh worker transparently. Disabled when
	 * omitted.
	 */
	idleTimeoutMs?: number;
	name?: string;
	onEvent?: (event: { name: string; payload?: unknown }) => void;
	/**
	 * Called when a worker ends on its own (a crash, an uncaught error,
	 * `process.exit()`), not when this sandbox terminates it for a timeout,
	 * idle reclaim, or shutdown.
	 */
	onUnexpectedExit?: (error: Error) => void;
	/**
	 * A bootstrap method run before a graceful stop (idle reclaim or
	 * `shutdown()`), so code in the worker can clean up what terminating it
	 * would not, such as child processes it spawned. Not run when a call
	 * times out: the worker may be stuck.
	 */
	disposeMethod?: string;
	disposeTimeoutMs?: number;
}

type QueuedCall = { id: string; message: SandboxCallMessage };

interface SandboxCallMessage {
	type: "call";
	id: string;
	method: string;
	args: unknown;
}

type PendingRequest = {
	worker: Worker;
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeout?: NodeJS.Timeout;
};

function asError(value: unknown): Error {
	if (value instanceof Error) {
		return value;
	}
	return new Error(String(value));
}

/**
 * Runs a bootstrap in a worker thread and speaks the same call/response/event
 * protocol as {@link SubprocessSandbox}. Unlike the subprocess it needs no
 * `node`/`bun` executable on PATH: the worker runs inside the host runtime,
 * so it also works from a compiled single-file binary.
 *
 * A worker has its own module graph, globals, and timers, and `terminate()`
 * stops it even mid-loop, so a hung or leaking plugin is reclaimed without
 * touching the host. It shares the host's process (memory limit, cwd, env
 * snapshot, native addons), so it is isolation, not a security boundary.
 */
export class WorkerSandbox {
	private readonly options: WorkerSandboxOptions;
	private readonly idleTimeoutMs: number | undefined;
	private worker: Worker | null = null;
	private requestCounter = 0;
	private readonly pending = new Map<string, PendingRequest>();
	private idleTimer: NodeJS.Timeout | undefined;
	private readonly exited = new WeakSet<Worker>();
	private readonly shutdowns = new Map<Worker, Promise<void>>();
	/**
	 * Calls posted before the worker reports ready. Bun drops messages that
	 * reach a worker before its bootstrap attaches a listener (Node queues
	 * them), and the bootstrap may still be importing when the first call is
	 * made.
	 */
	private readonly outboxes = new WeakMap<Worker, QueuedCall[]>();
	/**
	 * Set while an idle worker runs its dispose method and stops. Calls made
	 * meanwhile wait and start a fresh worker, so none reaches a plugin that
	 * already cleaned up.
	 */
	private draining: Promise<void> | undefined;
	/**
	 * Workers this sandbox decided to stop, from the moment cleanup starts.
	 * An exit while cleanup runs (a disposer calling `process.exit()` or
	 * throwing from a timer) is part of that stop, not a crash.
	 */
	private readonly stopping = new WeakSet<Worker>();

	constructor(options: WorkerSandboxOptions) {
		this.options = options;
		this.idleTimeoutMs = normalizeIdleTimeoutMs(options.idleTimeoutMs);
		if (
			options.idleTimeoutMs !== undefined &&
			this.idleTimeoutMs === undefined
		) {
			throw new RangeError(
				`idleTimeoutMs must be an integer between 1 and ${MAX_NODE_TIMER_DELAY_MS}`,
			);
		}
	}

	private get label(): string {
		return this.options.name ?? "worker-sandbox";
	}

	private isAvailable(worker: Worker): boolean {
		return !this.exited.has(worker) && !this.shutdowns.has(worker);
	}

	private clearIdleTimer(): void {
		if (!this.idleTimer) {
			return;
		}
		clearTimeout(this.idleTimer);
		this.idleTimer = undefined;
	}

	private hasPendingRequests(worker: Worker): boolean {
		for (const pending of this.pending.values()) {
			if (pending.worker === worker) {
				return true;
			}
		}
		return false;
	}

	private armIdleTimer(worker: Worker): void {
		if (this.worker !== worker) {
			return;
		}
		this.clearIdleTimer();
		if (
			this.idleTimeoutMs === undefined ||
			!this.isAvailable(worker) ||
			this.hasPendingRequests(worker)
		) {
			return;
		}
		const timer = setTimeout(() => {
			if (this.idleTimer === timer) {
				this.idleTimer = undefined;
			}
			if (
				this.worker !== worker ||
				!this.isAvailable(worker) ||
				this.hasPendingRequests(worker)
			) {
				return;
			}
			this.draining = this.stopGracefully(worker).finally(() => {
				this.draining = undefined;
			});
		}, this.idleTimeoutMs);
		timer.unref();
		this.idleTimer = timer;
	}

	private clearPendingRequest(id: string): PendingRequest | undefined {
		const pending = this.pending.get(id);
		if (!pending) {
			return undefined;
		}
		this.pending.delete(id);
		if (pending.timeout) {
			clearTimeout(pending.timeout);
		}
		this.armIdleTimer(pending.worker);
		return pending;
	}

	start(): void {
		if (this.worker && this.isAvailable(this.worker)) {
			return;
		}
		this.worker = null;
		this.clearIdleTimer();

		const worker = this.options.bootstrapFile
			? new Worker(this.options.bootstrapFile, this.workerOptions(false))
			: new Worker(
					this.options.bootstrapScript ?? "",
					this.workerOptions(true),
				);
		this.worker = worker;
		this.outboxes.set(worker, []);

		let stderrBuffer = "";
		// Plugin stdout must not reach the host's stdout, which may carry a
		// protocol (matches the subprocess sandbox, which ignores it).
		worker.stdout?.resume();
		worker.stderr?.setEncoding("utf8");
		worker.stderr?.on("data", (chunk: string) => {
			const next = stderrBuffer + chunk;
			stderrBuffer = next.length > 4000 ? next.slice(-4000) : next;
		});
		worker.on("message", (message) => {
			this.onMessage(
				worker,
				message as
					| SandboxResponseMessage
					| SandboxEventMessage
					| SandboxReadyMessage,
			);
		});
		let workerError: Error | undefined;
		worker.on("error", (error) => {
			// An uncaught exception in the worker ends the worker, not the host.
			workerError = asError(error);
		});
		worker.on("exit", (code) => {
			this.exited.add(worker);
			if (this.worker === worker) {
				this.worker = null;
				this.clearIdleTimer();
			}
			const detail = [workerError?.message, stderrBuffer.trim()]
				.filter(Boolean)
				.join(": ");
			const error = new Error(
				`${this.label} exited (code=${String(code)})${detail ? `: ${detail}` : ""}`,
			);
			if (workerError?.stack) error.stack = workerError.stack;
			const intended = this.shutdowns.has(worker) || this.stopping.has(worker);
			this.failPendingForWorker(worker, error);
			if (!intended) {
				try {
					this.options.onUnexpectedExit?.(error);
				} catch {
					// Reporting must never turn into a host failure.
				}
			}
		});
		this.armIdleTimer(worker);
	}

	private workerOptions(
		evalScript: boolean,
	): ConstructorParameters<typeof Worker>[1] {
		return {
			eval: evalScript,
			stdout: true,
			stderr: true,
			env: withResolvedClineBuildEnv(process.env),
		};
	}

	async call<TResult = unknown>(
		method: string,
		args: unknown,
		options: SandboxCallOptions = {},
	): Promise<TResult> {
		if (this.draining) await this.draining;
		this.start();
		const worker = this.worker;
		if (!worker || !this.isAvailable(worker)) {
			throw new Error(`${this.label} is not available`);
		}
		return await this.send<TResult>(worker, method, args, options);
	}

	/** Runs the dispose method (best effort), then terminates the worker. */
	private async stopGracefully(worker: Worker): Promise<void> {
		this.stopping.add(worker);
		const method = this.options.disposeMethod;
		if (method && this.isAvailable(worker)) {
			await this.send(
				worker,
				method,
				{},
				{
					timeoutMs: this.options.disposeTimeoutMs,
				},
			).catch(() => {
				// Cleanup is best effort; the worker is stopped either way.
			});
		}
		await this.shutdownWorker(worker);
	}

	private async send<TResult>(
		worker: Worker,
		method: string,
		args: unknown,
		options: SandboxCallOptions,
	): Promise<TResult> {
		this.clearIdleTimer();
		const id = `req_${++this.requestCounter}`;
		return await new Promise<TResult>((resolve, reject) => {
			const pending: PendingRequest = {
				worker,
				resolve: (value) => resolve(value as TResult),
				reject,
			};
			if ((options.timeoutMs ?? 0) > 0) {
				pending.timeout = setTimeout(() => {
					const entry = this.clearPendingRequest(id);
					if (!entry) {
						return;
					}
					// terminate() stops the worker even inside a synchronous loop.
					this.shutdownWorker(entry.worker).catch(() => {
						// Best-effort shutdown after timeout.
					});
					entry.reject(
						new Error(
							`${this.label} call timed out after ${options.timeoutMs}ms: ${method}`,
						),
					);
				}, options.timeoutMs);
			}
			this.pending.set(id, pending);
			try {
				const message: SandboxCallMessage = { type: "call", id, method, args };
				const outbox = this.outboxes.get(worker);
				if (outbox) {
					// Queue a snapshot, as postMessage would send: the caller may
					// change `args` before the worker is ready, and cloning now
					// surfaces DataCloneError here instead of at flush time.
					outbox.push({ id, message: structuredClone(message) });
				} else {
					worker.postMessage(message);
				}
			} catch (error) {
				// postMessage throws synchronously (DataCloneError) when the
				// payload holds functions or other uncloneable values. Reject with
				// the original error so callers can retry with a cleaned payload.
				this.clearPendingRequest(id);
				reject(asError(error));
			}
		});
	}

	async shutdown(): Promise<void> {
		this.clearIdleTimer();
		if (this.draining) await this.draining;
		const worker = this.worker;
		const inFlight = [...this.shutdowns.values()];
		if (worker) {
			inFlight.push(this.stopGracefully(worker));
		}
		if (inFlight.length === 0) {
			this.failPending(new Error(`${this.label} shutdown`));
			return;
		}
		await Promise.all(inFlight);
	}

	private shutdownWorker(worker: Worker): Promise<void> {
		const existing = this.shutdowns.get(worker);
		if (existing) {
			return existing;
		}
		if (this.worker === worker) {
			this.worker = null;
			this.clearIdleTimer();
		}
		const shutdown = worker
			.terminate()
			.then(
				() => undefined,
				() => undefined,
			)
			.finally(() => {
				this.exited.add(worker);
				this.failPendingForWorker(worker, new Error(`${this.label} shutdown`));
				if (this.shutdowns.get(worker) === shutdown) {
					this.shutdowns.delete(worker);
				}
			});
		this.shutdowns.set(worker, shutdown);
		return shutdown;
	}

	private onMessage(
		worker: Worker,
		message: SandboxResponseMessage | SandboxEventMessage | SandboxReadyMessage,
	): void {
		if (!message) {
			return;
		}
		if (message.type === "ready") {
			const outbox = this.outboxes.get(worker);
			this.outboxes.delete(worker);
			for (const queued of outbox ?? []) {
				// A queued call whose request already timed out is dropped.
				if (!this.pending.has(queued.id)) continue;
				try {
					worker.postMessage(queued.message);
				} catch (error) {
					// Snapshots are clones, so this should not happen; if it does,
					// reject that call rather than throw from the message listener.
					this.clearPendingRequest(queued.id)?.reject(asError(error));
				}
			}
			return;
		}
		if (message.type === "event") {
			if (
				this.worker === worker &&
				typeof message.name === "string" &&
				message.name.length > 0
			) {
				this.options.onEvent?.({
					name: message.name,
					payload: message.payload,
				});
			}
			return;
		}
		if (message.type !== "response" || !message.id) {
			return;
		}
		const matching = this.pending.get(message.id);
		if (!matching || matching.worker !== worker) {
			return;
		}
		const pending = this.clearPendingRequest(message.id);
		if (!pending) {
			return;
		}
		if (message.ok) {
			pending.resolve(message.result);
			return;
		}
		pending.reject(
			new Error(message.error?.message || `${this.label} call failed`),
		);
	}

	private failPendingForWorker(worker: Worker, error: Error): void {
		for (const [id, pending] of this.pending.entries()) {
			if (pending.worker !== worker) {
				continue;
			}
			this.pending.delete(id);
			if (pending.timeout) {
				clearTimeout(pending.timeout);
			}
			pending.reject(error);
		}
	}

	private failPending(error: Error): void {
		for (const [id, pending] of this.pending.entries()) {
			this.pending.delete(id);
			if (pending.timeout) {
				clearTimeout(pending.timeout);
			}
			pending.reject(error);
		}
	}
}
