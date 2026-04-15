import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type * as LlmsProviders from "@clinebot/llms";
import { RpcSessionClient } from "@clinebot/rpc";
import {
	type AgentEvent,
	type AgentResult,
	createSessionId,
	type RpcChatRunTurnRequest,
	type RpcChatStartSessionRequest,
	type RpcChatTurnResult,
	type TeamProgressLifecycleEvent,
	type TeamProgressSummary,
	type ToolApprovalRequest,
	type ToolApprovalResult,
	type ToolPolicy,
} from "@clinebot/shared";
import type { HookEventPayload } from "../hooks";
import type { CoreSessionEvent } from "../types/events";
import type { SessionRecord } from "../types/sessions";
import type { RpcCoreSessionService } from "./rpc-session-service";
import type {
	SendSessionInput,
	SessionAccumulatedUsage,
	SessionManager,
	StartSessionInput,
	StartSessionResult,
} from "./session-manager";
import { toSessionRecord } from "./utils/helpers";

type ApprovalRequester = (
	request: ToolApprovalRequest,
) => Promise<ToolApprovalResult>;

const DEFAULT_MANUAL_APPROVAL_POLICY: ToolPolicy = {
	enabled: true,
	autoApprove: false,
};

function unsupportedRpcFeature(name: string): Error {
	return new Error(
		`RPC-backed ClineCore does not support ${name}. Use local backend mode for this session.`,
	);
}

function validateRpcStartInput(input: StartSessionInput): void {
	if (input.defaultToolExecutors) {
		throw unsupportedRpcFeature("custom tool executors");
	}
	if (input.userInstructionWatcher) {
		throw unsupportedRpcFeature("user instruction watchers");
	}
	if (input.teamToolsFactory) {
		throw unsupportedRpcFeature("custom team tools factories");
	}
	if (
		input.config.baseUrl ||
		input.config.headers ||
		input.config.providerConfig
	) {
		throw unsupportedRpcFeature("custom provider connection settings");
	}
	if (
		input.config.knownModels ||
		input.config.thinking !== undefined ||
		input.config.reasoningEffort
	) {
		throw unsupportedRpcFeature("custom model capability overrides");
	}
	if (
		input.config.hooks ||
		input.config.extensionContext ||
		input.config.extraTools ||
		input.config.pluginPaths ||
		input.config.extensions ||
		input.config.execution
	) {
		throw unsupportedRpcFeature("runtime extensions or custom tools");
	}
	if (
		input.config.compaction ||
		input.config.checkpoint ||
		input.config.onTeamEvent ||
		input.config.onConsecutiveMistakeLimitReached
	) {
		throw unsupportedRpcFeature("custom runtime lifecycle hooks");
	}
	if (
		input.config.toolRoutingRules ||
		input.config.skills ||
		input.config.workspaceMetadata
	) {
		throw unsupportedRpcFeature("advanced runtime routing metadata");
	}
	if (input.config.logger || input.config.telemetry) {
		throw unsupportedRpcFeature("session-scoped logger or telemetry instances");
	}
}

function toRpcStartRequest(
	input: StartSessionInput,
): RpcChatStartSessionRequest {
	const workspaceRoot =
		input.config.workspaceRoot?.trim() || input.config.cwd.trim();
	return {
		sessionId: input.config.sessionId?.trim() || undefined,
		workspaceRoot,
		cwd: input.config.cwd,
		provider: input.config.providerId,
		model: input.config.modelId,
		mode: input.config.mode,
		apiKey: input.config.apiKey?.trim() || "",
		systemPrompt: input.config.systemPrompt,
		rules: input.config.rules,
		maxIterations: input.config.maxIterations,
		enableTools: input.config.enableTools,
		enableSpawn: input.config.enableSpawnAgent,
		enableTeams: input.config.enableAgentTeams,
		disableMcpSettingsTools: input.config.disableMcpSettingsTools,
		autoApproveTools: input.toolPolicies?.["*"]?.autoApprove,
		teamName: input.config.teamName ?? "",
		missionStepInterval: input.config.missionLogIntervalSteps ?? 3,
		missionTimeIntervalMs: input.config.missionLogIntervalMs ?? 120_000,
		toolPolicies: input.toolPolicies,
		initialMessages: input.initialMessages as
			| RpcChatStartSessionRequest["initialMessages"]
			| undefined,
		sessions: undefined,
		source: input.source,
		interactive: input.interactive === true,
	};
}

async function buildTurnRequest(
	config: RpcChatStartSessionRequest,
	messages: LlmsProviders.Message[] | undefined,
	input: {
		prompt: string;
		userImages?: string[];
		userFiles?: string[];
		delivery?: "queue" | "steer";
	},
): Promise<RpcChatRunTurnRequest> {
	return {
		config,
		messages: messages as RpcChatRunTurnRequest["messages"] | undefined,
		prompt: input.prompt,
		delivery: input.delivery,
		attachments:
			input.userImages?.length || input.userFiles?.length
				? {
						userImages: input.userImages,
						userFiles: input.userFiles
							? await Promise.all(
									input.userFiles.map(async (path) => ({
										name: path.split("/").at(-1) || path,
										content: await readFile(path, "utf8"),
									})),
								)
							: undefined,
					}
				: undefined,
	};
}

function toAgentResult(
	result: RpcChatTurnResult,
	config: RpcChatStartSessionRequest,
	startedAt: Date,
): AgentResult {
	const endedAt = new Date();
	return {
		text: result.text,
		usage: result.usage,
		messages: result.messages as LlmsProviders.Message[],
		toolCalls: result.toolCalls.map((call) => ({
			id: createSessionId(),
			name: call.name,
			input: call.input,
			output: call.output,
			error: call.error,
			durationMs: call.durationMs ?? 0,
			startedAt,
			endedAt,
		})),
		iterations: result.iterations,
		finishReason: result.finishReason as AgentResult["finishReason"],
		model: {
			id: config.model,
			provider: config.provider,
		},
		startedAt,
		endedAt,
		durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()),
	};
}

function accumulateUsage(
	base: SessionAccumulatedUsage | undefined,
	result: RpcChatTurnResult,
): SessionAccumulatedUsage {
	return {
		inputTokens: (base?.inputTokens ?? 0) + result.usage.inputTokens,
		outputTokens: (base?.outputTokens ?? 0) + result.usage.outputTokens,
		cacheReadTokens:
			(base?.cacheReadTokens ?? 0) + (result.usage.cacheReadTokens ?? 0),
		cacheWriteTokens:
			(base?.cacheWriteTokens ?? 0) + (result.usage.cacheWriteTokens ?? 0),
		totalCost: (base?.totalCost ?? 0) + (result.usage.totalCost ?? 0),
	};
}

export class RpcSessionHost implements SessionManager {
	public readonly runtimeAddress: string;
	private readonly client: RpcSessionClient;
	private readonly listeners = new Set<(event: CoreSessionEvent) => void>();
	private readonly sessionConfigs = new Map<
		string,
		RpcChatStartSessionRequest
	>();
	private readonly sessionApprovals = new Map<
		string,
		ApprovalRequester | undefined
	>();
	private readonly usageBySession = new Map<string, SessionAccumulatedUsage>();
	private readonly trackedSessionIds = new Set<string>();
	private stopEventStream?: () => void;

	constructor(
		private readonly backend: RpcCoreSessionService,
		private readonly defaultToolPolicies?: RpcChatStartSessionRequest["toolPolicies"],
		private readonly defaultRequestToolApproval?: ApprovalRequester,
	) {
		this.runtimeAddress = backend.address;
		this.client = new RpcSessionClient({
			address: backend.address,
		});
	}

	async start(input: StartSessionInput): Promise<StartSessionResult> {
		validateRpcStartInput(input);
		const config = toRpcStartRequest(input);
		if (!config.toolPolicies && this.defaultToolPolicies) {
			config.toolPolicies = this.defaultToolPolicies;
		}
		const response = await this.client.startRuntimeSession(config);
		const sessionId = response.sessionId.trim();
		if (!sessionId) {
			throw new Error("RPC runtime start returned an empty session id");
		}
		const startResult = response.startResult;
		if (!startResult) {
			throw new Error("RPC runtime start did not return session artifacts");
		}

		this.sessionConfigs.set(sessionId, { ...config, sessionId });
		this.sessionApprovals.set(
			sessionId,
			input.requestToolApproval ?? this.defaultRequestToolApproval,
		);
		this.usageBySession.set(sessionId, {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		});
		this.trackedSessionIds.add(sessionId);
		this.refreshEventStream();

		let result: AgentResult | undefined;
		if (input.prompt?.trim()) {
			result = await this.send({
				sessionId,
				prompt: input.prompt,
				userImages: input.userImages,
				userFiles: input.userFiles,
			});
		}

		const manifest = this.backend.readSessionManifest(sessionId);
		if (!manifest) {
			throw new Error(`Session manifest unavailable for ${sessionId}`);
		}

		return {
			sessionId,
			manifest,
			manifestPath: startResult.manifestPath,
			transcriptPath: startResult.transcriptPath,
			hookPath: startResult.hookPath,
			messagesPath: startResult.messagesPath,
			result,
		};
	}

	async send(input: SendSessionInput): Promise<AgentResult | undefined> {
		const config = this.sessionConfigs.get(input.sessionId);
		if (!config) {
			throw new Error(
				`RPC-backed session ${input.sessionId} is not attached to this ClineCore instance`,
			);
		}
		const messages = await this.readMessages(input.sessionId);
		const startedAt = new Date();
		const response = await this.client.sendRuntimeSession(
			input.sessionId,
			await buildTurnRequest(config, messages, input),
		);
		if (!response.result) {
			return undefined;
		}
		const usage = accumulateUsage(
			this.usageBySession.get(input.sessionId),
			response.result,
		);
		this.usageBySession.set(input.sessionId, usage);
		const result = toAgentResult(response.result, config, startedAt);
		await this.syncRemoteSessionState(input.sessionId);
		return result;
	}

	async getAccumulatedUsage(
		sessionId: string,
	): Promise<SessionAccumulatedUsage | undefined> {
		const usage = this.usageBySession.get(sessionId);
		return usage ? { ...usage } : undefined;
	}

	async abort(sessionId: string, reason?: unknown): Promise<void> {
		void reason;
		await this.client.abortRuntimeSession(sessionId);
	}

	async stop(sessionId: string): Promise<void> {
		await this.client.stopRuntimeSession(sessionId);
		this.detachSession(sessionId);
		this.emit({
			type: "status",
			payload: { sessionId, status: "cancelled" },
		});
		this.emit({
			type: "ended",
			payload: {
				sessionId,
				reason: "rpc_stop_requested",
				ts: Date.now(),
			},
		});
	}

	async dispose(reason = "rpc_session_host_dispose"): Promise<void> {
		const sessionIds = [...this.trackedSessionIds];
		await Promise.allSettled(
			sessionIds.map(async (sessionId) => {
				try {
					await this.client.abortRuntimeSession(sessionId);
				} catch {
					// Best effort before stop.
				}
				try {
					await this.client.stopRuntimeSession(sessionId);
				} catch {
					// Best effort during dispose.
				}
				this.emit({
					type: "ended",
					payload: { sessionId, reason, ts: Date.now() },
				});
			}),
		);
		this.stopEventStream?.();
		this.stopEventStream = undefined;
		this.sessionConfigs.clear();
		this.sessionApprovals.clear();
		this.usageBySession.clear();
		this.trackedSessionIds.clear();
		this.client.close();
	}

	async get(sessionId: string): Promise<SessionRecord | undefined> {
		const row = await this.client.getSession(sessionId);
		return row ? toSessionRecord(row) : undefined;
	}

	async list(limit = 200): Promise<SessionRecord[]> {
		const rows = await this.backend.listSessions(limit);
		return rows.map(toSessionRecord);
	}

	async delete(sessionId: string): Promise<boolean> {
		const result = await this.backend.deleteSession(sessionId);
		if (result.deleted) {
			this.detachSession(sessionId);
		}
		return result.deleted;
	}

	async update(
		sessionId: string,
		updates: {
			prompt?: string | null;
			metadata?: Record<string, unknown> | null;
			title?: string | null;
		},
	): Promise<{ updated: boolean }> {
		const result = await this.backend.updateSession({
			sessionId,
			prompt: updates.prompt,
			metadata: updates.metadata,
			title: updates.title,
		});
		return { updated: result.updated };
	}

	async readMessages(sessionId: string): Promise<LlmsProviders.Message[]> {
		const row = await this.client.getSession(sessionId);
		const messagesPath = row?.messagesPath?.trim();
		if (!messagesPath || !existsSync(messagesPath)) return [];
		try {
			const raw = (await readFile(messagesPath, "utf8")).trim();
			if (!raw) return [];
			const parsed = JSON.parse(raw) as unknown;
			if (Array.isArray(parsed)) return parsed as LlmsProviders.Message[];
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				const messages = (parsed as { messages?: unknown }).messages;
				if (Array.isArray(messages)) return messages as LlmsProviders.Message[];
			}
			return [];
		} catch {
			return [];
		}
	}

	async readTranscript(sessionId: string, maxChars?: number): Promise<string> {
		const row = await this.client.getSession(sessionId);
		if (!row?.transcriptPath || !existsSync(row.transcriptPath)) return "";
		const raw = await readFile(row.transcriptPath, "utf8");
		if (typeof maxChars === "number" && Number.isFinite(maxChars)) {
			const normalizedMaxChars = Math.max(0, Math.floor(maxChars));
			if (normalizedMaxChars === 0) {
				return "";
			}
			return raw.slice(-normalizedMaxChars);
		}
		return raw;
	}

	async readHooks(sessionId: string, limit = 200): Promise<unknown[]> {
		const row = await this.client.getSession(sessionId);
		if (!row?.hookPath || !existsSync(row.hookPath)) return [];
		const lines = (await readFile(row.hookPath, "utf8"))
			.split("\n")
			.filter((line) => line.trim().length > 0);
		return lines.slice(-Math.max(1, Math.floor(limit))).map((line) => {
			try {
				return JSON.parse(line) as unknown;
			} catch {
				return { raw: line };
			}
		});
	}

	async handleHookEvent(payload: HookEventPayload): Promise<void> {
		const shouldTouchSessions =
			payload.hookName === "tool_call" || !!payload.parent_agent_id;
		if (!shouldTouchSessions) {
			return;
		}
		await this.backend.queueSpawnRequest(payload);
		const subSessionId =
			await this.backend.upsertSubagentSessionFromHook(payload);
		if (!subSessionId) {
			return;
		}
		await this.backend.appendSubagentHookAudit(subSessionId, payload);
		if (payload.hookName === "tool_call") {
			await this.backend.appendSubagentTranscriptLine(
				subSessionId,
				`[tool] ${payload.tool_call?.name ?? "unknown"}`,
			);
		}
		if (payload.hookName === "agent_end") {
			await this.backend.appendSubagentTranscriptLine(
				subSessionId,
				"[done] completed",
			);
		}
		if (payload.hookName === "session_shutdown") {
			await this.backend.appendSubagentTranscriptLine(
				subSessionId,
				`[shutdown] ${payload.reason ?? "session shutdown"}`,
			);
		}
		await this.backend.applySubagentStatus(subSessionId, payload);
	}

	subscribe(listener: (event: CoreSessionEvent) => void): () => void {
		this.listeners.add(listener);
		this.refreshEventStream();
		return () => {
			this.listeners.delete(listener);
			if (this.listeners.size === 0) {
				this.stopEventStream?.();
				this.stopEventStream = undefined;
			}
		};
	}

	async updateSessionModel(): Promise<void> {
		// Model updates for remote sessions are applied per-turn from the stored config.
	}

	private emit(event: CoreSessionEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	private detachSession(sessionId: string): void {
		this.sessionConfigs.delete(sessionId);
		this.sessionApprovals.delete(sessionId);
		this.usageBySession.delete(sessionId);
		this.trackedSessionIds.delete(sessionId);
		this.refreshEventStream();
	}

	private refreshEventStream(): void {
		if (this.listeners.size === 0) {
			return;
		}
		this.stopEventStream?.();
		this.stopEventStream = undefined;
		if (this.trackedSessionIds.size === 0) {
			return;
		}
		this.stopEventStream = this.client.streamEvents(
			{
				clientId: `core-session-host-${createSessionId()}`,
				sessionIds: [...this.trackedSessionIds],
			},
			{
				onEvent: (event) => {
					void this.handleRpcEvent(event);
				},
			},
		);
	}

	private async handleRpcEvent(event: {
		sessionId: string;
		eventType: string;
		payload: Record<string, unknown>;
	}): Promise<void> {
		if (event.eventType === "approval.requested") {
			await this.handleApprovalRequest(event.sessionId, event.payload);
			return;
		}
		const mapped = this.mapRpcEvent(
			event.sessionId,
			event.eventType,
			event.payload,
		);
		if (mapped) {
			this.emit(mapped);
		}
	}

	private async handleApprovalRequest(
		sessionId: string,
		payload: Record<string, unknown>,
	): Promise<void> {
		const requester = this.sessionApprovals.get(sessionId);
		if (!requester) {
			return;
		}
		const approvalId =
			typeof payload.approvalId === "string" ? payload.approvalId.trim() : "";
		const toolCallId =
			typeof payload.toolCallId === "string" ? payload.toolCallId.trim() : "";
		const toolName =
			typeof payload.toolName === "string" ? payload.toolName.trim() : "";
		if (!approvalId || !toolCallId || !toolName) {
			return;
		}
		let inputJson: unknown;
		if (typeof payload.inputJson === "string" && payload.inputJson.trim()) {
			try {
				inputJson = JSON.parse(payload.inputJson);
			} catch {
				inputJson = payload.inputJson;
			}
		}
		const decision = await requester({
			agentId: "",
			conversationId: sessionId,
			iteration: 0,
			toolCallId,
			toolName,
			input: inputJson,
			policy: DEFAULT_MANUAL_APPROVAL_POLICY,
		});
		await this.client.respondToolApproval({
			approvalId,
			approved: decision.approved,
			reason: decision.reason,
			responderClientId: `core-session-host-${sessionId}`,
		});
	}

	private mapRpcEvent(
		sessionId: string,
		eventType: string,
		payload: Record<string, unknown>,
	): CoreSessionEvent | undefined {
		if (eventType === "runtime.chat.text_delta") {
			return {
				type: "agent_event",
				payload: {
					sessionId,
					event: {
						type: "content_start",
						contentType: "text",
						text: typeof payload.text === "string" ? payload.text : undefined,
						accumulated:
							typeof payload.accumulated === "string"
								? payload.accumulated
								: undefined,
					} satisfies AgentEvent,
				},
			};
		}
		if (eventType === "runtime.chat.tool_call_start") {
			return {
				type: "agent_event",
				payload: {
					sessionId,
					event: {
						type: "content_start",
						contentType: "tool",
						toolCallId:
							typeof payload.toolCallId === "string"
								? payload.toolCallId
								: undefined,
						toolName:
							typeof payload.toolName === "string"
								? payload.toolName
								: undefined,
						input: payload.input,
					} satisfies AgentEvent,
				},
			};
		}
		if (eventType === "runtime.chat.tool_call_end") {
			return {
				type: "agent_event",
				payload: {
					sessionId,
					event: {
						type: "content_end",
						contentType: "tool",
						toolCallId:
							typeof payload.toolCallId === "string"
								? payload.toolCallId
								: undefined,
						toolName:
							typeof payload.toolName === "string"
								? payload.toolName
								: undefined,
						output: payload.output,
						error:
							typeof payload.error === "string" ? payload.error : undefined,
						durationMs:
							typeof payload.durationMs === "number"
								? payload.durationMs
								: undefined,
					} satisfies AgentEvent,
				},
			};
		}
		if (eventType === "runtime.chat.error") {
			return {
				type: "agent_event",
				payload: {
					sessionId,
					event: {
						type: "error",
						error: new Error(
							typeof payload.message === "string"
								? payload.message
								: "RPC runtime error",
						),
						recoverable: payload.recoverable === true,
						iteration:
							typeof payload.iteration === "number" ? payload.iteration : 0,
					} satisfies AgentEvent,
				},
			};
		}
		if (eventType === "runtime.chat.pending_prompts") {
			const prompts = Array.isArray(payload.prompts) ? payload.prompts : [];
			return {
				type: "pending_prompts",
				payload: {
					sessionId,
					prompts: prompts.map((prompt) => {
						const typed = prompt as Record<string, unknown>;
						return {
							id: typeof typed.id === "string" ? typed.id : "",
							prompt: typeof typed.prompt === "string" ? typed.prompt : "",
							delivery: typed.delivery === "steer" ? "steer" : "queue",
							attachmentCount:
								typeof typed.attachmentCount === "number"
									? typed.attachmentCount
									: 0,
						};
					}),
				},
			};
		}
		if (eventType === "runtime.team.progress.v1") {
			const summary =
				typeof payload.summary === "object" && payload.summary
					? payload.summary
					: undefined;
			const lifecycle =
				typeof payload.lastEvent === "object" && payload.lastEvent
					? payload.lastEvent
					: undefined;
			if (!summary || !lifecycle) {
				return undefined;
			}
			const typedSummary = summary as {
				teamName?: string;
			} & TeamProgressSummary;
			return {
				type: "team_progress",
				payload: {
					sessionId,
					teamName: typedSummary.teamName ?? "",
					summary: summary as TeamProgressSummary,
					lifecycle: lifecycle as TeamProgressLifecycleEvent,
				},
			};
		}
		return undefined;
	}

	private async syncRemoteSessionState(sessionId: string): Promise<void> {
		const row = await this.client.getSession(sessionId);
		if (!row || row.status === "running") {
			return;
		}
		this.emit({
			type: "status",
			payload: { sessionId, status: row.status },
		});
		this.emit({
			type: "ended",
			payload: {
				sessionId,
				reason: row.status,
				ts: row.endedAt ? new Date(row.endedAt).getTime() : Date.now(),
			},
		});
		this.detachSession(sessionId);
	}
}
