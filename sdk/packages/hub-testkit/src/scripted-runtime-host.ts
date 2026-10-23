/**
 * A `RuntimeHost` that replays a declarative script instead of calling a model.
 *
 * This is the seam the testkit hooks: `startHubWebSocketServer({ sessionHost })`
 * accepts any `RuntimeHost`, subscribes to its `CoreSessionEvent` stream in the
 * `HubServerTransport` constructor, and hands it `capabilities.requestToolApproval`
 * on `startSession`. Driving that one interface exercises the entire real hub
 * server — command dispatch, event projection, approval bookkeeping — with zero
 * nondeterminism from an actual agent.
 */

import type {
	AgentEvent,
	AgentResult,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@cline/shared";
import {
	type ApprovalMode,
	type ScriptStep,
	scriptedTurnText,
	type TurnScript,
	toTurnScript,
} from "./script";

/** Structural mirror of core's `CoreSessionEvent` union (only the arms we emit). */
type ScriptedSessionEvent =
	| {
			type: "agent_event";
			payload: { sessionId: string; event: AgentEvent };
	  }
	| { type: "status"; payload: { sessionId: string; status: string } };

type SessionEventListener = (event: ScriptedSessionEvent) => void;

const FIXED_ISO = new Date(0).toISOString();

export interface ScriptedRuntimeHostOptions {
	workspaceRoot?: string;
	providerId?: string;
	modelId?: string;
	approvals?: ApprovalMode;
	/** Script used for turns that have no queued script. */
	defaultScript?: ScriptStep[] | TurnScript;
}

interface ScriptedSession {
	sessionId: string;
	status: "idle" | "running" | "completed" | "failed" | "cancelled";
	messages: unknown[];
	usage: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens: number;
		cacheWriteTokens: number;
		totalCost: number;
	};
	abort?: { reason: string; resolve: () => void };
	aborted: boolean;
}

/**
 * Lets the hub's async event projection finish before the next event is emitted.
 *
 * `HubServerTransport` fires `void projectSessionEvent(...)` per event, and some
 * arms await (usage lookups, snapshot reads). Without draining between emits, a
 * synchronous projection could overtake an awaited one and reorder the wire
 * stream. `setImmediate` runs only once the microtask queue is empty, so this is
 * the cheap deterministic barrier.
 */
function drainMicrotasks(): Promise<void> {
	return new Promise<void>((resolve) => {
		setImmediate(resolve);
	});
}

export class ScriptedRuntimeHost {
	private readonly listeners = new Set<SessionEventListener>();
	private readonly sessions = new Map<string, ScriptedSession>();
	private readonly queue: TurnScript[] = [];
	private readonly gates = new Map<string, () => void>();
	private readonly pendingGateReleases = new Set<string>();
	private requestApproval:
		| ((
				request: ToolApprovalRequest,
		  ) => Promise<ToolApprovalResult> | ToolApprovalResult)
		| undefined;

	readonly workspaceRoot: string;
	private providerId: string;
	private modelId: string;
	private readonly approvals: ApprovalMode;
	private readonly defaultScript: TurnScript;

	constructor(options: ScriptedRuntimeHostOptions = {}) {
		this.workspaceRoot = options.workspaceRoot ?? "/testkit/workspace";
		this.providerId = options.providerId ?? "testkit";
		this.modelId = options.modelId ?? "testkit-model";
		this.approvals = options.approvals ?? "wait-for-respond";
		this.defaultScript = toTurnScript(
			options.defaultScript ?? { steps: [{ kind: "text", chunks: ["ok"] }] },
		);
	}

	/** Queue the script for the next `session.send_input` / `run.start`. */
	enqueue(script: ScriptStep[] | TurnScript): void {
		this.queue.push(toTurnScript(script));
	}

	/** Unblock a `{ kind: "gate" }` step. Safe to call before the step is reached. */
	releaseGate(id: string): void {
		const release = this.gates.get(id);
		if (release) {
			this.gates.delete(id);
			release();
			return;
		}
		this.pendingGateReleases.add(id);
	}

	// --- RuntimeHost -------------------------------------------------------

	subscribe(listener: SessionEventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async startSession(input: {
		config: { sessionId?: string; cwd?: string; workspaceRoot?: string };
		capabilities?: {
			requestToolApproval?: (
				request: ToolApprovalRequest,
			) => Promise<ToolApprovalResult> | ToolApprovalResult;
		};
	}): Promise<unknown> {
		const sessionId = input.config.sessionId?.trim() || "testkit-session";
		this.requestApproval = input.capabilities?.requestToolApproval;
		this.sessions.set(sessionId, {
			sessionId,
			status: "idle",
			messages: [],
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0,
			},
			aborted: false,
		});
		const workspaceRoot =
			input.config.workspaceRoot?.trim() || this.workspaceRoot;
		return {
			sessionId,
			manifest: {
				version: 1,
				session_id: sessionId,
				source: "core",
				pid: 1,
				started_at: FIXED_ISO,
				status: "running",
				interactive: true,
				provider: this.providerId,
				model: this.modelId,
				cwd: workspaceRoot,
				workspace_root: workspaceRoot,
				enable_tools: true,
				enable_spawn: false,
				enable_teams: false,
			},
			manifestPath: "",
			messagesPath: "",
			result: undefined,
		};
	}

	async runTurn(input: {
		sessionId: string;
		prompt: string;
	}): Promise<AgentResult> {
		const session = this.ensureSession(input.sessionId);
		const script = this.queue.shift() ?? this.defaultScript;
		session.status = "running";
		session.aborted = false;
		session.messages.push({ role: "user", content: input.prompt });

		let denial: { toolName: string; reason?: string } | undefined;
		const toolCalls: Array<{
			name: string;
			input?: unknown;
			output?: unknown;
			error?: string;
		}> = [];

		await this.emit(session.sessionId, {
			type: "iteration_start",
			iteration: 1,
			agentId: "agent-1",
			conversationId: "conversation-1",
		});

		let toolCallSeq = 0;
		let hadToolCalls = false;
		for (const step of script.steps) {
			if (session.aborted) {
				break;
			}
			switch (step.kind) {
				case "text": {
					for (const chunk of step.chunks) {
						await this.emit(session.sessionId, {
							type: "content_start",
							contentType: "text",
							text: chunk,
						});
					}
					await this.emit(session.sessionId, {
						type: "content_end",
						contentType: "text",
						text: step.chunks.join(""),
					});
					break;
				}
				case "reasoning": {
					for (const chunk of step.chunks) {
						await this.emit(session.sessionId, {
							type: "content_start",
							contentType: "reasoning",
							reasoning: chunk,
							redacted: step.redacted === true,
						});
					}
					await this.emit(session.sessionId, {
						type: "content_end",
						contentType: "reasoning",
						reasoning: step.chunks.join(""),
					});
					break;
				}
				case "tool": {
					hadToolCalls = true;
					toolCallSeq += 1;
					const toolCallId = step.toolCallId ?? `call-${toolCallSeq}`;
					await this.emit(session.sessionId, {
						type: "content_start",
						contentType: "tool",
						toolName: step.name,
						toolCallId,
						input: step.input,
					});
					const needsApproval =
						step.requiresApproval ?? this.approvals === "wait-for-respond";
					let approval: ToolApprovalResult = { approved: true };
					if (needsApproval && this.requestApproval) {
						approval = await this.requestApproval({
							sessionId: session.sessionId,
							agentId: "agent-1",
							conversationId: "conversation-1",
							iteration: 1,
							toolCallId,
							toolName: step.name,
							input: step.input,
							policy: { autoApprove: false },
						});
					}
					const error = approval.approved
						? step.error
						: `Tool ${step.name} was denied${approval.reason ? `: ${approval.reason}` : ""}`;
					const output =
						approval.approved && !step.error ? step.output : undefined;
					if (!approval.approved) {
						denial = { toolName: step.name, reason: approval.reason };
					}
					session.messages.push({
						role: "assistant",
						content: [
							{
								type: "tool_use",
								id: toolCallId,
								name: step.name,
								input: step.input ?? null,
							},
						],
					});
					session.messages.push({
						role: "user",
						content: [
							{
								type: "tool_result",
								tool_use_id: toolCallId,
								content: error ?? JSON.stringify(output ?? null),
								is_error: error !== undefined,
							},
						],
					});
					toolCalls.push({ name: step.name, input: step.input, output, error });
					await this.emit(session.sessionId, {
						type: "content_end",
						contentType: "tool",
						toolName: step.name,
						toolCallId,
						output,
						error,
					});
					break;
				}
				case "usage": {
					session.usage = {
						inputTokens: session.usage.inputTokens + step.inputTokens,
						outputTokens: session.usage.outputTokens + step.outputTokens,
						cacheReadTokens:
							session.usage.cacheReadTokens + (step.cacheReadTokens ?? 0),
						cacheWriteTokens:
							session.usage.cacheWriteTokens + (step.cacheWriteTokens ?? 0),
						totalCost: session.usage.totalCost + (step.cost ?? 0),
					};
					await this.emit(session.sessionId, {
						type: "usage",
						agentId: "agent-1",
						conversationId: "conversation-1",
						inputTokens: step.inputTokens,
						outputTokens: step.outputTokens,
						cacheReadTokens: step.cacheReadTokens ?? 0,
						cacheWriteTokens: step.cacheWriteTokens ?? 0,
						cost: step.cost ?? 0,
						totalInputTokens: session.usage.inputTokens,
						totalOutputTokens: session.usage.outputTokens,
						totalCacheReadTokens: session.usage.cacheReadTokens,
						totalCacheWriteTokens: session.usage.cacheWriteTokens,
						totalCost: session.usage.totalCost,
					});
					break;
				}
				case "gate": {
					await this.waitForGate(step.id);
					break;
				}
				case "abortable-stall": {
					await this.waitForAbort(session);
					break;
				}
			}
		}

		await this.emit(session.sessionId, {
			type: "iteration_end",
			iteration: 1,
			hadToolCalls,
			toolCallCount: toolCalls.length,
		});

		const aborted = session.aborted;
		const finishReason = aborted
			? "aborted"
			: (script.finishReason ?? "completed");
		const text = aborted
			? (session.abort?.reason ?? "aborted")
			: denial
				? `Tool ${denial.toolName} was denied${denial.reason ? `: ${denial.reason}` : ""}`
				: scriptedTurnText(script);
		session.messages.push({ role: "assistant", content: text });
		session.status = aborted
			? "cancelled"
			: finishReason === "completed"
				? "completed"
				: "failed";
		session.abort = undefined;

		return {
			text,
			usage: {
				inputTokens: session.usage.inputTokens,
				outputTokens: session.usage.outputTokens,
				cacheReadTokens: session.usage.cacheReadTokens,
				cacheWriteTokens: session.usage.cacheWriteTokens,
				totalCost: session.usage.totalCost,
			},
			messages: [],
			toolCalls: toolCalls.map((call) => ({
				name: call.name,
				input: call.input,
				output: call.output,
				error: call.error,
			})),
			iterations: 1,
			finishReason,
			model: { id: this.modelId, provider: this.providerId },
			startedAt: new Date(0),
			endedAt: new Date(0),
			durationMs: 0,
		} as unknown as AgentResult;
	}

	async abort(sessionId: string, reason?: unknown): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return;
		}
		session.aborted = true;
		const abortReason = typeof reason === "string" ? reason : "aborted";
		const pending = session.abort;
		session.abort = { reason: abortReason, resolve: () => {} };
		pending?.resolve();
	}

	async stopSession(): Promise<void> {}

	async dispose(): Promise<void> {
		// Unblock anything still parked so hub shutdown never hangs.
		for (const [id, release] of [...this.gates]) {
			this.gates.delete(id);
			release();
		}
		for (const session of this.sessions.values()) {
			session.aborted = true;
			session.abort?.resolve();
		}
		this.listeners.clear();
	}

	async getSession(sessionId: string): Promise<unknown> {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return undefined;
		}
		return {
			sessionId,
			source: "core",
			startedAt: FIXED_ISO,
			updatedAt: FIXED_ISO,
			status: session.status,
			interactive: true,
			provider: this.providerId,
			model: this.modelId,
			cwd: this.workspaceRoot,
			workspaceRoot: this.workspaceRoot,
			enableTools: true,
			enableSpawn: false,
			enableTeams: false,
			isSubagent: false,
			agentId: "agent-1",
			conversationId: "conversation-1",
		};
	}

	/**
	 * `session.update_connection`'s target. Host-level on purpose: the scripted
	 * host serves one provider/model pair, and what the tests need is that a
	 * change is APPLIED and then visible on every record the hub re-reads.
	 */
	async updateSessionConnection(
		_sessionId: string,
		updates: { providerId?: string; modelId?: string },
	): Promise<void> {
		if (updates.providerId !== undefined) this.providerId = updates.providerId;
		if (updates.modelId !== undefined) this.modelId = updates.modelId;
	}

	/** `catalog.list`: the models this scripted machine pretends to run. */
	async listModelCatalog(): Promise<unknown> {
		return {
			providers: [
				{
					id: this.providerId,
					name: "Testkit",
					enabled: true,
					defaultModelId: this.modelId,
				},
			],
			modelsByProvider: {
				[this.providerId]: [
					{ id: this.modelId, name: "Testkit Model" },
					{ id: `${this.modelId}-mini`, name: "Testkit Mini" },
				],
			},
		};
	}

	async listSessions(): Promise<unknown[]> {
		return await Promise.all(
			[...this.sessions.keys()].map((id) => this.getSession(id)),
		);
	}

	async deleteSession(sessionId: string): Promise<boolean> {
		return this.sessions.delete(sessionId);
	}

	async updateSession(): Promise<{ updated: boolean }> {
		return { updated: false };
	}

	async updateSessionCompactionState(): Promise<{ updated: boolean }> {
		return { updated: false };
	}

	async readSessionCompactionState(): Promise<undefined> {
		return undefined;
	}

	async readSessionMessages(sessionId: string): Promise<unknown[]> {
		return structuredClone(this.sessions.get(sessionId)?.messages ?? []);
	}

	async getAccumulatedUsage(sessionId: string): Promise<unknown> {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return undefined;
		}
		return {
			usage: { ...session.usage },
			aggregateUsage: { ...session.usage },
		};
	}

	async restoreSession(): Promise<never> {
		throw new Error("ScriptedRuntimeHost does not support restoreSession");
	}

	async dispatchHookEvent(): Promise<void> {}

	// --- internals ---------------------------------------------------------

	private ensureSession(sessionId: string): ScriptedSession {
		const existing = this.sessions.get(sessionId);
		if (existing) {
			return existing;
		}
		const session: ScriptedSession = {
			sessionId,
			status: "idle",
			messages: [],
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0,
			},
			aborted: false,
		};
		this.sessions.set(sessionId, session);
		return session;
	}

	private async emit(sessionId: string, event: AgentEvent): Promise<void> {
		for (const listener of this.listeners) {
			listener({ type: "agent_event", payload: { sessionId, event } });
		}
		await drainMicrotasks();
	}

	private async waitForGate(id: string): Promise<void> {
		if (this.pendingGateReleases.delete(id)) {
			return;
		}
		await new Promise<void>((resolve) => {
			this.gates.set(id, resolve);
		});
	}

	private async waitForAbort(session: ScriptedSession): Promise<void> {
		if (session.aborted) {
			return;
		}
		await new Promise<void>((resolve) => {
			session.abort = { reason: "aborted", resolve };
		});
	}
}
