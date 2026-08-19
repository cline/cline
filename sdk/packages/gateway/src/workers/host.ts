/**
 * Worker-side protocol host (Gateway RFC, Phase 4).
 *
 * Runs inside the worker (in-process for tests, a sandboxed child in
 * production) and speaks the supervision contract: initialize, execute,
 * event, capability-call, interrupt, drain, heartbeat. The actual
 * execution workload is injected as an `EnginePort` factory; the factory
 * receives the host context so workloads can reach Gateway-owned
 * resources through capability calls instead of holding credentials.
 */

import type { EngineInvocation, EnginePort, EngineRunHandle } from "@cline/bot";
import type {
	SupervisorToWorkerMessage,
	WorkerToSupervisorMessage,
} from "./protocol";
import { WORKER_PROTOCOL_VERSION } from "./protocol";

export interface WorkerEndpoint {
	send(message: WorkerToSupervisorMessage): void;
	onMessage(listener: (message: SupervisorToWorkerMessage) => void): () => void;
}

export interface WorkerHostContext {
	/** Call a Gateway-owned capability and await its result. */
	capabilityCall(
		capability: string,
		params?: Record<string, unknown>,
	): Promise<unknown>;
}

export type WorkerWorkloadFactory = (context: WorkerHostContext) => EnginePort;

export interface WorkerHostOptions {
	endpoint: WorkerEndpoint;
	workload: EnginePort | WorkerWorkloadFactory;
	pid?: number;
}

interface PendingCapabilityCall {
	resolve(value: unknown): void;
	reject(error: Error): void;
}

export class WorkerHost {
	private readonly endpoint: WorkerEndpoint;
	private readonly workload: EnginePort;
	private readonly pid?: number;
	private readonly executions = new Map<string, EngineRunHandle>();
	private readonly pendingCapabilityCalls = new Map<
		string,
		PendingCapabilityCall
	>();
	private nextCallId = 0;
	private draining = false;
	private readonly unsubscribe: () => void;

	constructor(options: WorkerHostOptions) {
		this.endpoint = options.endpoint;
		this.pid = options.pid;
		this.workload =
			typeof options.workload === "function"
				? options.workload({
						capabilityCall: (capability, params) =>
							this.capabilityCall(capability, params),
					})
				: options.workload;
		this.unsubscribe = this.endpoint.onMessage((message) =>
			this.handle(message),
		);
	}

	get activeExecutions(): number {
		return this.executions.size;
	}

	close(): void {
		this.unsubscribe();
	}

	capabilityCall(
		capability: string,
		params?: Record<string, unknown>,
	): Promise<unknown> {
		this.nextCallId += 1;
		const callId = `cap_${this.nextCallId}`;
		return new Promise((resolve, reject) => {
			this.pendingCapabilityCalls.set(callId, { resolve, reject });
			this.endpoint.send({
				t: "capability-call",
				callId,
				capability,
				...(params ? { params } : {}),
			});
		});
	}

	private handle(message: SupervisorToWorkerMessage): void {
		switch (message.t) {
			case "initialize":
				this.endpoint.send({
					t: "initialized",
					protocolVersion: WORKER_PROTOCOL_VERSION,
					workerId: message.workerId,
					...(this.pid !== undefined ? { pid: this.pid } : {}),
				});
				return;
			case "execute": {
				if (this.draining) {
					this.endpoint.send({
						t: "executed",
						executionId: message.executionId,
						outcome: {
							status: "failed",
							outputText: "",
							error: {
								name: "WorkerDraining",
								message: "Worker is draining and accepts no new executions",
							},
						},
					});
					return;
				}
				const handle = this.workload.start(
					message.invocation as unknown as EngineInvocation,
				);
				this.executions.set(message.executionId, handle);
				const unsubscribe = handle.subscribe?.((event) => {
					this.endpoint.send({
						t: "event",
						executionId: message.executionId,
						event,
					});
				});
				void handle.result.then((outcome) => {
					unsubscribe?.();
					this.executions.delete(message.executionId);
					this.endpoint.send({
						t: "executed",
						executionId: message.executionId,
						outcome: {
							status: outcome.status,
							outputText: outcome.outputText,
							...(outcome.error ? { error: outcome.error } : {}),
						},
					});
					if (this.draining && this.executions.size === 0) {
						this.endpoint.send({ t: "drained" });
					}
				});
				return;
			}
			case "steer":
				this.executions.get(message.executionId)?.steer(message.text);
				return;
			case "interrupt": {
				const targets = message.executionId
					? [this.executions.get(message.executionId)].filter(
							(handle): handle is EngineRunHandle => handle !== undefined,
						)
					: [...this.executions.values()];
				for (const handle of targets) {
					if (message.mode === "abort") {
						handle.abort(message.reason);
					} else {
						handle.interrupt(message.reason);
					}
				}
				return;
			}
			case "drain":
				this.draining = true;
				if (this.executions.size === 0) {
					this.endpoint.send({ t: "drained" });
				}
				return;
			case "heartbeat":
				this.endpoint.send({ t: "heartbeat-ack", seq: message.seq });
				return;
			case "capability-result": {
				const pending = this.pendingCapabilityCalls.get(message.callId);
				if (!pending) {
					return;
				}
				this.pendingCapabilityCalls.delete(message.callId);
				if (message.ok) {
					pending.resolve(message.result);
				} else {
					pending.reject(new Error(message.error ?? "Capability call failed"));
				}
				return;
			}
		}
	}
}
