/**
 * In-process worker driver (Gateway RFC, Phase 4) — TESTS ONLY.
 *
 * Hosts the worker protocol in the supervisor's own process over an
 * in-memory message pair (delivery is still asynchronous, so ordering
 * bugs surface). Provides deterministic crash simulation so supervisor
 * crash-containment behavior is testable without real processes. Never a
 * production isolation policy: `isolation` is `in-process-test` and the
 * supervisor refuses it when isolation is required.
 */

import type {
	WorkerConnection,
	WorkerDriver,
	WorkerDriverAvailability,
	WorkerExitInfo,
	WorkerSpawnSpec,
} from "./driver";
import type { WorkerWorkloadFactory } from "./host";
import { WorkerHost } from "./host";
import type {
	SupervisorToWorkerMessage,
	WorkerToSupervisorMessage,
} from "./protocol";

class InProcessConnection implements WorkerConnection {
	readonly spec: WorkerSpawnSpec;
	private readonly listeners = new Set<
		(message: WorkerToSupervisorMessage) => void
	>();
	private readonly exitListeners = new Set<(info: WorkerExitInfo) => void>();
	private hostListener:
		| ((message: SupervisorToWorkerMessage) => void)
		| undefined;
	private host: WorkerHost | undefined;
	private alive = true;
	/** Messages sent before the supervisor subscribed (like a paused pipe). */
	private pendingToSupervisor: WorkerToSupervisorMessage[] = [];

	constructor(spec: WorkerSpawnSpec, workload: WorkerWorkloadFactory) {
		this.spec = spec;
		this.host = new WorkerHost({
			endpoint: {
				send: (message) => {
					if (!this.alive) {
						return;
					}
					queueMicrotask(() => {
						if (!this.alive) {
							return;
						}
						if (this.listeners.size === 0) {
							this.pendingToSupervisor.push(message);
							return;
						}
						for (const listener of this.listeners) {
							listener(message);
						}
					});
				},
				onMessage: (listener) => {
					this.hostListener = listener;
					return () => {
						this.hostListener = undefined;
					};
				},
			},
			workload,
		});
	}

	send(message: SupervisorToWorkerMessage): void {
		if (!this.alive) {
			return;
		}
		queueMicrotask(() => {
			if (this.alive) {
				this.hostListener?.(message);
			}
		});
	}

	onMessage(
		listener: (message: WorkerToSupervisorMessage) => void,
	): () => void {
		this.listeners.add(listener);
		if (this.pendingToSupervisor.length > 0) {
			const backlog = this.pendingToSupervisor;
			this.pendingToSupervisor = [];
			queueMicrotask(() => {
				if (!this.alive) {
					return;
				}
				for (const message of backlog) {
					for (const subscriber of this.listeners) {
						subscriber(message);
					}
				}
			});
		}
		return () => {
			this.listeners.delete(listener);
		};
	}

	onExit(listener: (info: WorkerExitInfo) => void): () => void {
		this.exitListeners.add(listener);
		return () => {
			this.exitListeners.delete(listener);
		};
	}

	kill(): void {
		this.terminate({ code: null, signal: "SIGKILL", crashed: false });
	}

	/** Test hook: die the way a SIGKILLed or segfaulting child would. */
	crash(): void {
		this.terminate({ code: null, signal: "SIGKILL", crashed: true });
	}

	/**
	 * Test hook: hang the worker — the process stays "alive" but stops
	 * processing messages (heartbeats go unanswered).
	 */
	hang(): void {
		this.host?.close();
		this.host = undefined;
	}

	private terminate(info: WorkerExitInfo): void {
		if (!this.alive) {
			return;
		}
		this.alive = false;
		this.host?.close();
		this.host = undefined;
		for (const listener of this.exitListeners) {
			listener(info);
		}
	}
}

export class InProcessWorkerDriver implements WorkerDriver {
	readonly id = "in-process";
	readonly isolation = "in-process-test" as const;
	readonly connections: InProcessConnection[] = [];
	private readonly workload: WorkerWorkloadFactory;

	constructor(workload: WorkerWorkloadFactory) {
		this.workload = workload;
	}

	availability(): WorkerDriverAvailability {
		return { available: true };
	}

	spawn(spec: WorkerSpawnSpec): Promise<WorkerConnection> {
		const connection = new InProcessConnection(spec, this.workload);
		this.connections.push(connection);
		return Promise.resolve(connection);
	}

	/** Crash the newest live worker for a bot (or any worker). */
	crashLatest(): void {
		this.connections.at(-1)?.crash();
	}
}
