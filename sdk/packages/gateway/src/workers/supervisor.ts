/**
 * Worker supervisor (Gateway RFC, Phase 4).
 *
 * One long-lived execution worker per bot, reached through a swappable
 * `WorkerDriver`. The supervisor owns the out-of-process contract —
 * initialize, execute, event, capability-call, interrupt, drain,
 * heartbeat — plus idle reaping and crash containment: when a worker
 * dies, the in-flight attempts fail, the session survives untouched, and
 * any retry is an explicit decision of the attempt layer above.
 *
 * Isolation is enforced here, not assumed: `isolationPolicy: "required"`
 * refuses to run on a non-production isolation mode and fails closed
 * when the driver is unavailable. The development-only unsandboxed mode
 * must be requested explicitly and is always visible in `health()`.
 */

import type {
	EngineInvocation,
	EngineOutcome,
	EnginePort,
	EngineRunHandle,
} from "@cline/bot";
import type { BotId, WorkerId } from "@cline/shared/gateway";
import { createWorkerId } from "@cline/shared/gateway";
import type { WorkerConnection, WorkerDriver, WorkerSpawnSpec } from "./driver";
import { WorkerIsolationUnavailableError } from "./driver";
import type { WorkerToSupervisorMessage } from "./protocol";
import { WORKER_PROTOCOL_VERSION } from "./protocol";

export type WorkerCapabilityHandler = (
	params: Record<string, unknown> | undefined,
	context: { botId: BotId; workerId: WorkerId },
) => Promise<unknown> | unknown;

export type SupervisorIsolationPolicy = "required" | "development";

export interface WorkerSupervisorOptions {
	driver: WorkerDriver;
	/**
	 * `required` (default): only production isolation modes may run and an
	 * unavailable driver fails closed. `development`: any driver runs, and
	 * health/telemetry mark the supervisor as development-mode.
	 */
	isolationPolicy?: SupervisorIsolationPolicy;
	/** Build the per-bot spawn spec (mounts, network, credentials). */
	spawnSpecFor: (
		botId: BotId,
		workerId: WorkerId,
	) => Omit<WorkerSpawnSpec, "workerId" | "botId">;
	/** Gateway-owned capabilities workers may call. */
	capabilities?: Record<string, WorkerCapabilityHandler>;
	clock?: () => number;
	/** Reap a worker after this long without executions. 0 disables. */
	idleReapMs?: number;
	/** Heartbeat cadence. 0 disables the automatic timer. */
	heartbeatIntervalMs?: number;
	/** A heartbeat unanswered for this long marks the worker hung. */
	heartbeatTimeoutMs?: number;
	initializeTimeoutMs?: number;
	telemetry?: (event: Record<string, unknown>) => void;
}

interface PendingExecution {
	readonly executionId: string;
	readonly botId: BotId;
	resolve(outcome: EngineOutcome): void;
	readonly listeners: Set<(event: unknown) => void>;
	settled: boolean;
}

interface SupervisedWorker {
	readonly workerId: WorkerId;
	readonly botId: BotId;
	readonly connection: WorkerConnection;
	readonly startedAt: number;
	state: "initializing" | "ready" | "draining" | "dead";
	lastActivityAt: number;
	lastHeartbeatAckAt: number;
	pendingHeartbeatSeq?: number;
	pendingHeartbeatSentAt?: number;
	heartbeatSeq: number;
	readonly executions: Map<string, PendingExecution>;
	readonly ready: Promise<void>;
	crashCount: number;
}

const PRODUCTION_ISOLATION_MODES = new Set(["sandbox-seatbelt"]);

export class WorkerCrashedError extends Error {
	constructor(workerId: WorkerId) {
		super(
			`Worker ${workerId} crashed; the attempt failed, the session survives, and any retry is explicit`,
		);
		this.name = "WorkerCrashed";
	}
}

export class WorkerSupervisor {
	private readonly options: WorkerSupervisorOptions;
	private readonly driver: WorkerDriver;
	private readonly clock: () => number;
	private readonly workers = new Map<BotId, SupervisedWorker>();
	private readonly telemetry: (event: Record<string, unknown>) => void;
	private nextExecutionId = 0;
	private sweepTimer: ReturnType<typeof setInterval> | undefined;
	private stopped = false;

	constructor(options: WorkerSupervisorOptions) {
		this.options = options;
		this.driver = options.driver;
		this.clock = options.clock ?? (() => Date.now());
		this.telemetry = options.telemetry ?? (() => {});
		const policy = options.isolationPolicy ?? "required";
		if (
			policy === "required" &&
			!PRODUCTION_ISOLATION_MODES.has(this.driver.isolation)
		) {
			throw new WorkerIsolationUnavailableError(
				this.driver.id,
				`isolation mode "${this.driver.isolation}" is not a production isolation; ` +
					'pass isolationPolicy: "development" to run it deliberately',
			);
		}
		const interval = Math.min(
			options.heartbeatIntervalMs || Number.POSITIVE_INFINITY,
			options.idleReapMs || Number.POSITIVE_INFINITY,
		);
		if (Number.isFinite(interval) && interval > 0) {
			this.sweepTimer = setInterval(
				() => this.sweep(),
				Math.max(10, Math.floor(interval / 2)),
			);
			this.sweepTimer.unref?.();
		}
	}

	get isolationPolicy(): SupervisorIsolationPolicy {
		return this.options.isolationPolicy ?? "required";
	}

	/** Health/telemetry view; development-only modes are always visible. */
	health(): Record<string, unknown> {
		return {
			driver: this.driver.id,
			isolation: this.driver.isolation,
			isolationPolicy: this.isolationPolicy,
			development: !PRODUCTION_ISOLATION_MODES.has(this.driver.isolation),
			available: this.driver.availability().available,
			workers: [...this.workers.values()].map((worker) => ({
				workerId: worker.workerId,
				botId: worker.botId,
				state: worker.state,
				pid: worker.connection.pid,
				startedAt: worker.startedAt,
				lastActivityAt: worker.lastActivityAt,
				activeExecutions: worker.executions.size,
				crashCount: worker.crashCount,
			})),
		};
	}

	/** An `EnginePort` that routes each invocation to its bot's worker. */
	enginePort(): EnginePort {
		return {
			start: (invocation) => this.startExecution(invocation),
		};
	}

	/** Count of live workers (for tests and status). */
	get workerCount(): number {
		return this.workers.size;
	}

	workerForBot(
		botId: BotId,
	): { workerId: WorkerId; state: string } | undefined {
		const worker = this.workers.get(botId);
		return worker
			? { workerId: worker.workerId, state: worker.state }
			: undefined;
	}

	/**
	 * Idle reaping + hung-heartbeat detection. Runs on a timer and is
	 * callable directly for deterministic tests.
	 */
	sweep(now: number = this.clock()): void {
		const idleReapMs = this.options.idleReapMs ?? 0;
		const heartbeatIntervalMs = this.options.heartbeatIntervalMs ?? 0;
		const heartbeatTimeoutMs = this.options.heartbeatTimeoutMs ?? 5_000;
		for (const worker of [...this.workers.values()]) {
			if (worker.state !== "ready") {
				continue;
			}
			if (
				idleReapMs > 0 &&
				worker.executions.size === 0 &&
				now - worker.lastActivityAt >= idleReapMs
			) {
				this.telemetry({
					kind: "worker.idleReaped",
					workerId: worker.workerId,
					botId: worker.botId,
				});
				this.retire(worker);
				continue;
			}
			if (heartbeatIntervalMs > 0) {
				if (
					worker.pendingHeartbeatSeq !== undefined &&
					worker.pendingHeartbeatSentAt !== undefined &&
					now - worker.pendingHeartbeatSentAt >= heartbeatTimeoutMs
				) {
					this.telemetry({
						kind: "worker.heartbeatTimeout",
						workerId: worker.workerId,
						botId: worker.botId,
					});
					// A hung worker is treated exactly like a crash.
					worker.connection.kill();
					this.handleWorkerDeath(worker);
					continue;
				}
				if (
					worker.pendingHeartbeatSeq === undefined &&
					now - worker.lastHeartbeatAckAt >= heartbeatIntervalMs
				) {
					worker.heartbeatSeq += 1;
					worker.pendingHeartbeatSeq = worker.heartbeatSeq;
					worker.pendingHeartbeatSentAt = now;
					worker.connection.send({
						t: "heartbeat",
						seq: worker.heartbeatSeq,
					});
				}
			}
		}
	}

	/** Drain every worker (bounded), then stop them. */
	async drain(timeoutMs = 5_000): Promise<void> {
		const workers = [...this.workers.values()];
		await Promise.all(
			workers.map(async (worker) => {
				if (worker.state !== "ready") {
					return;
				}
				worker.state = "draining";
				const drained = new Promise<void>((resolve) => {
					const unsubscribe = worker.connection.onMessage((message) => {
						if (message.t === "drained") {
							unsubscribe();
							resolve();
						}
					});
				});
				worker.connection.send({ t: "drain" });
				await Promise.race([
					drained,
					new Promise((resolve) => setTimeout(resolve, timeoutMs)),
				]);
			}),
		);
	}

	stop(): void {
		this.stopped = true;
		if (this.sweepTimer) {
			clearInterval(this.sweepTimer);
			this.sweepTimer = undefined;
		}
		for (const worker of [...this.workers.values()]) {
			this.retire(worker);
		}
	}

	// ---------------------------------------------------------------------
	// Internals
	// ---------------------------------------------------------------------

	private startExecution(invocation: EngineInvocation): EngineRunHandle {
		this.nextExecutionId += 1;
		const executionId = `exe_${this.nextExecutionId}`;
		let resolveOutcome!: (outcome: EngineOutcome) => void;
		const result = new Promise<EngineOutcome>((resolve) => {
			resolveOutcome = resolve;
		});
		const pending: PendingExecution = {
			executionId,
			botId: invocation.botId,
			resolve: (outcome) => {
				if (!pending.settled) {
					pending.settled = true;
					resolveOutcome(outcome);
				}
			},
			listeners: new Set(),
			settled: false,
		};

		const workerPromise = this.workerFor(invocation.botId);
		void workerPromise
			.then((worker) => {
				if (pending.settled) {
					return;
				}
				worker.executions.set(executionId, pending);
				worker.lastActivityAt = this.clock();
				worker.connection.send({
					t: "execute",
					executionId,
					invocation: {
						runId: invocation.runId,
						sessionId: invocation.sessionId,
						botId: invocation.botId,
						input: invocation.input,
						workspaceRoot: invocation.workspaceRoot,
						effectiveConfig: invocation.effectiveConfig as Record<
							string,
							unknown
						>,
						...(invocation.overrides
							? {
									overrides: invocation.overrides as Record<string, unknown>,
								}
							: {}),
					},
				});
			})
			.catch((error) => {
				pending.resolve({
					status: "failed",
					outputText: "",
					error: {
						name:
							error instanceof WorkerIsolationUnavailableError
								? "WorkerIsolationUnavailable"
								: "WorkerSpawnFailed",
						message: error instanceof Error ? error.message : String(error),
					},
				});
			});

		const sendWhenReady = (send: (worker: SupervisedWorker) => void): void => {
			void workerPromise.then(
				(worker) => {
					if (!pending.settled && worker.state !== "dead") {
						send(worker);
					}
				},
				() => {},
			);
		};

		return {
			result,
			steer: (text: string): boolean => {
				if (pending.settled) {
					return false;
				}
				sendWhenReady((worker) =>
					worker.connection.send({ t: "steer", executionId, text }),
				);
				return true;
			},
			interrupt: (reason?: string) => {
				sendWhenReady((worker) =>
					worker.connection.send({
						t: "interrupt",
						executionId,
						mode: "interrupt",
						...(reason ? { reason } : {}),
					}),
				);
			},
			abort: (reason?: string) => {
				sendWhenReady((worker) =>
					worker.connection.send({
						t: "interrupt",
						executionId,
						mode: "abort",
						...(reason ? { reason } : {}),
					}),
				);
			},
			subscribe: (listener: (event: unknown) => void) => {
				pending.listeners.add(listener);
				return () => {
					pending.listeners.delete(listener);
				};
			},
		};
	}

	/** One long-lived worker per bot, spawned lazily and reused. */
	private async workerFor(botId: BotId): Promise<SupervisedWorker> {
		if (this.stopped) {
			throw new Error("WorkerSupervisor is stopped");
		}
		const existing = this.workers.get(botId);
		if (existing && existing.state !== "dead") {
			await existing.ready;
			return existing;
		}
		const availability = this.driver.availability();
		if (!availability.available) {
			// Required isolation fails closed instead of degrading.
			throw new WorkerIsolationUnavailableError(
				this.driver.id,
				availability.reason ?? "unavailable",
			);
		}
		const workerId = createWorkerId();
		const spec: WorkerSpawnSpec = {
			workerId,
			botId,
			...this.options.spawnSpecFor(botId, workerId),
		};
		const connection = await this.driver.spawn(spec);
		const now = this.clock();
		let resolveReady!: () => void;
		let rejectReady!: (error: Error) => void;
		const ready = new Promise<void>((resolve, reject) => {
			resolveReady = resolve;
			rejectReady = reject;
		});
		// A worker that never initializes is dead, not silently pending.
		ready.catch(() => {});
		const worker: SupervisedWorker = {
			workerId,
			botId,
			connection,
			startedAt: now,
			state: "initializing",
			lastActivityAt: now,
			lastHeartbeatAckAt: now,
			heartbeatSeq: 0,
			executions: new Map(),
			ready,
			crashCount: 0,
		};
		this.workers.set(botId, worker);

		connection.onMessage((message) =>
			this.handleWorkerMessage(worker, message, resolveReady),
		);
		connection.onExit((info) => {
			if (info.crashed) {
				worker.crashCount += 1;
				this.telemetry({
					kind: "worker.crashed",
					workerId,
					botId,
					code: info.code,
					signal: info.signal,
				});
			}
			rejectReady(new WorkerCrashedError(workerId));
			this.handleWorkerDeath(worker);
		});

		connection.send({
			t: "initialize",
			protocolVersion: WORKER_PROTOCOL_VERSION,
			workerId,
			botId,
		});
		const timeoutMs = this.options.initializeTimeoutMs ?? 10_000;
		const timeout = setTimeout(() => {
			rejectReady(
				new Error(`Worker ${workerId} failed to initialize in ${timeoutMs}ms`),
			);
			this.retire(worker);
		}, timeoutMs);
		timeout.unref?.();
		try {
			await ready;
		} finally {
			clearTimeout(timeout);
		}
		return worker;
	}

	private handleWorkerMessage(
		worker: SupervisedWorker,
		message: WorkerToSupervisorMessage,
		resolveReady: () => void,
	): void {
		worker.lastActivityAt = this.clock();
		switch (message.t) {
			case "initialized":
				worker.state = "ready";
				resolveReady();
				return;
			case "event": {
				const pending = worker.executions.get(message.executionId);
				if (pending) {
					for (const listener of pending.listeners) {
						listener(message.event);
					}
				}
				return;
			}
			case "executed": {
				const pending = worker.executions.get(message.executionId);
				if (pending) {
					worker.executions.delete(message.executionId);
					pending.resolve(message.outcome);
				}
				return;
			}
			case "capability-call":
				void this.dispatchCapability(worker, message);
				return;
			case "heartbeat-ack":
				if (worker.pendingHeartbeatSeq === message.seq) {
					worker.pendingHeartbeatSeq = undefined;
					worker.pendingHeartbeatSentAt = undefined;
					worker.lastHeartbeatAckAt = this.clock();
				}
				return;
			case "drained":
				return;
		}
	}

	private async dispatchCapability(
		worker: SupervisedWorker,
		message: Extract<WorkerToSupervisorMessage, { t: "capability-call" }>,
	): Promise<void> {
		const handler = this.options.capabilities?.[message.capability];
		if (!handler) {
			worker.connection.send({
				t: "capability-result",
				callId: message.callId,
				ok: false,
				error: `Unknown capability: ${message.capability}`,
			});
			return;
		}
		try {
			const result = await handler(message.params, {
				botId: worker.botId,
				workerId: worker.workerId,
			});
			worker.connection.send({
				t: "capability-result",
				callId: message.callId,
				ok: true,
				result,
			});
		} catch (error) {
			worker.connection.send({
				t: "capability-result",
				callId: message.callId,
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/**
	 * Crash containment: every in-flight attempt on the dead worker fails
	 * — the run attempt settles, the session is untouched, and whether to
	 * retry is the attempt layer's explicit decision. The bot's next
	 * execution spawns a fresh worker.
	 */
	private handleWorkerDeath(worker: SupervisedWorker): void {
		if (worker.state === "dead") {
			return;
		}
		worker.state = "dead";
		if (this.workers.get(worker.botId) === worker) {
			this.workers.delete(worker.botId);
		}
		for (const pending of worker.executions.values()) {
			pending.resolve({
				status: "failed",
				outputText: "",
				error: {
					name: "WorkerCrashed",
					message: new WorkerCrashedError(worker.workerId).message,
				},
			});
		}
		worker.executions.clear();
	}

	private retire(worker: SupervisedWorker): void {
		worker.connection.kill();
		this.handleWorkerDeath(worker);
	}
}
