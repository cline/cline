import type {
	AgentEvent,
	AgentFinishReason,
	AgentResult,
	AgentUsage,
	HubEventEnvelope,
	SessionRecord as HubSessionRecord,
	JsonValue,
	ToolApprovalRequest,
	ToolApprovalResult,
	ToolContext,
} from "@clinebot/shared";
import { isHubToolExecutorName } from "@clinebot/shared";
import type { ToolExecutors } from "../extensions/tools";
import type { HookEventPayload } from "../hooks";
import { NodeHubClient } from "../hub/client";
import type {
	PendingPromptMutationResult,
	PendingPromptsAction,
	PendingPromptsDeleteInput,
	PendingPromptsListInput,
	PendingPromptsUpdateInput,
	RestoreSessionInput,
	RestoreSessionResult,
	RuntimeHost,
	RuntimeHostSubscribeOptions,
	SendSessionInput,
	SessionAccumulatedUsage,
	StartSessionInput,
	StartSessionResult,
} from "../runtime/host/runtime-host";
import {
	type SessionManifest,
	SessionManifestSchema,
} from "../session/models/session-manifest";
import type {
	CoreSettingsListInput,
	CoreSettingsMutationResult,
	CoreSettingsSnapshot,
	CoreSettingsToggleInput,
} from "../settings";
import { SessionSource, type SessionStatus } from "../types/common";
import type { CoreSessionEvent, SessionPendingPrompt } from "../types/events";
import type { SessionRecord } from "../types/sessions";
import { RuntimeHostEventBus } from "./runtime-host-support";

function toJsonRecord(
	value: Record<string, unknown> | undefined,
): Record<string, JsonValue | undefined> | undefined {
	if (!value) {
		return undefined;
	}
	return JSON.parse(JSON.stringify(value)) as Record<
		string,
		JsonValue | undefined
	>;
}

function serializeSettingsInput(
	input: CoreSettingsListInput | CoreSettingsToggleInput | undefined,
): Record<string, unknown> | undefined {
	if (!input) {
		return undefined;
	}
	const { userInstructionWatcher: _userInstructionWatcher, ...serializable } =
		input;
	return JSON.parse(JSON.stringify(serializable)) as Record<string, unknown>;
}

function parseToolContext(value: unknown): ToolContext {
	const payload =
		value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	return {
		agentId: typeof payload.agentId === "string" ? payload.agentId : "",
		conversationId:
			typeof payload.conversationId === "string" ? payload.conversationId : "",
		iteration: typeof payload.iteration === "number" ? payload.iteration : 0,
		metadata:
			payload.metadata &&
			typeof payload.metadata === "object" &&
			!Array.isArray(payload.metadata)
				? (payload.metadata as Record<string, unknown>)
				: undefined,
	};
}

function parseApprovalInput(value: unknown): unknown {
	if (typeof value !== "string") {
		return value;
	}
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

function isAgentFinishReason(value: unknown): value is AgentFinishReason {
	return (
		value === "completed" ||
		value === "max_iterations" ||
		value === "aborted" ||
		value === "mistake_limit" ||
		value === "error"
	);
}

function parseDoneUsage(value: unknown): AgentUsage | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const payload = value as Record<string, unknown>;
	const inputTokens =
		typeof payload.inputTokens === "number" ? payload.inputTokens : undefined;
	const outputTokens =
		typeof payload.outputTokens === "number" ? payload.outputTokens : undefined;
	if (inputTokens === undefined || outputTokens === undefined) {
		return undefined;
	}
	return {
		inputTokens,
		outputTokens,
		cacheReadTokens:
			typeof payload.cacheReadTokens === "number" ? payload.cacheReadTokens : 0,
		cacheWriteTokens:
			typeof payload.cacheWriteTokens === "number"
				? payload.cacheWriteTokens
				: 0,
		totalCost: typeof payload.totalCost === "number" ? payload.totalCost : 0,
	};
}

function doneEventFromPayload(
	payload: Record<string, unknown> | undefined,
): AgentEvent {
	const result =
		payload?.result &&
		typeof payload.result === "object" &&
		!Array.isArray(payload.result)
			? (payload.result as Record<string, unknown>)
			: undefined;
	const reasonCandidate = payload?.reason ?? result?.finishReason;
	const reason = isAgentFinishReason(reasonCandidate)
		? reasonCandidate
		: reasonCandidate === "failed"
			? "error"
			: "completed";
	const usage = parseDoneUsage(payload?.usage ?? result?.usage);
	return {
		type: "done",
		reason,
		text:
			typeof payload?.text === "string"
				? payload.text
				: typeof result?.text === "string"
					? result.text
					: "",
		iterations:
			typeof payload?.iterations === "number"
				? payload.iterations
				: typeof result?.iterations === "number"
					? result.iterations
					: 0,
		usage,
	};
}

function hubReplyErrorMessage(
	reply: { error?: { message?: string } },
	command: string,
): string {
	return reply.error?.message ?? `hub command failed: ${command}`;
}

export interface HubRuntimeHostOptions {
	url: string;
	authToken?: string;
	clientType?: string;
	displayName?: string;
	requestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult> | ToolApprovalResult;
}

function mapStatus(
	status: HubSessionRecord["status"] | undefined,
): SessionStatus {
	switch (status) {
		case "idle":
		case "completed":
			return "completed";
		case "failed":
			return "failed";
		case "aborted":
			return "cancelled";
		default:
			return "running";
	}
}

function toSessionRecord(session: HubSessionRecord): SessionRecord {
	const metadata =
		session.metadata && typeof session.metadata === "object"
			? JSON.parse(JSON.stringify(session.metadata))
			: undefined;
	return {
		sessionId: session.sessionId,
		parentSessionId:
			typeof metadata?.parentSessionId === "string"
				? metadata.parentSessionId
				: undefined,
		agentId:
			session.runtimeSession?.agentId ||
			(typeof metadata?.agentId === "string" ? metadata.agentId : undefined),
		parentAgentId:
			typeof metadata?.parentAgentId === "string"
				? metadata.parentAgentId
				: undefined,
		conversationId:
			typeof metadata?.conversationId === "string"
				? metadata.conversationId
				: undefined,
		isSubagent:
			typeof metadata?.isSubagent === "boolean" ? metadata.isSubagent : false,
		source:
			typeof metadata?.source === "string"
				? metadata.source
				: SessionSource.CORE,
		pid: typeof metadata?.pid === "number" ? metadata.pid : undefined,
		startedAt: new Date(session.createdAt).toISOString(),
		endedAt:
			mapStatus(session.status) === "running"
				? undefined
				: new Date(session.updatedAt).toISOString(),
		exitCode:
			mapStatus(session.status) === "completed"
				? 0
				: mapStatus(session.status) === "failed"
					? 1
					: undefined,
		status: mapStatus(session.status),
		interactive: metadata?.interactive === true,
		provider:
			typeof metadata?.provider === "string" ? metadata.provider : "hub",
		model: typeof metadata?.model === "string" ? metadata.model : "hub",
		cwd: session.cwd?.trim() || session.workspaceRoot,
		workspaceRoot: session.workspaceRoot,
		teamName:
			typeof metadata?.teamName === "string" ? metadata.teamName : undefined,
		enableTools:
			session.runtimeOptions?.enableTools ?? metadata?.enableTools === true,
		enableSpawn:
			session.runtimeOptions?.enableSpawn ?? metadata?.enableSpawn === true,
		enableTeams:
			session.runtimeOptions?.enableTeams ?? metadata?.enableTeams === true,
		prompt: typeof metadata?.prompt === "string" ? metadata.prompt : undefined,
		metadata,
		updatedAt: new Date(session.updatedAt).toISOString(),
		messagesPath:
			typeof metadata?.messagesPath === "string"
				? metadata.messagesPath
				: undefined,
		hookPath:
			typeof metadata?.hookPath === "string" ? metadata.hookPath : undefined,
	};
}

function buildManifest(
	sessionId: string,
	input: StartSessionInput,
	session: HubSessionRecord | undefined,
): SessionManifest {
	const workspaceRoot =
		session?.workspaceRoot?.trim() ||
		input.config.workspaceRoot ||
		input.config.cwd;
	return SessionManifestSchema.parse({
		version: 1,
		session_id: sessionId,
		source: input.source ?? SessionSource.CORE,
		pid: process.pid,
		started_at: new Date(session?.createdAt ?? Date.now()).toISOString(),
		status: mapStatus(session?.status),
		interactive: input.interactive === true,
		provider: input.config.providerId,
		model: input.config.modelId,
		cwd: session?.cwd?.trim() || input.config.cwd,
		workspace_root: workspaceRoot,
		team_name: input.config.teamName,
		enable_tools: input.config.enableTools,
		enable_spawn: input.config.enableSpawnAgent,
		enable_teams: input.config.enableAgentTeams,
		prompt: input.prompt?.trim() || undefined,
		metadata:
			input.sessionMetadata && Object.keys(input.sessionMetadata).length > 0
				? input.sessionMetadata
				: undefined,
	});
}

export class HubRuntimeHost implements RuntimeHost {
	public readonly runtimeAddress: string;
	private readonly client: NodeHubClient;
	private readonly events = new RuntimeHostEventBus();
	private readonly sessionToolExecutors = new Map<
		string,
		Partial<ToolExecutors>
	>();
	private readonly sessionSubscriptions = new Map<string, () => void>();
	private readonly pendingApprovalToolCallIds = new Set<string>();
	private readonly requestToolApproval:
		| HubRuntimeHostOptions["requestToolApproval"]
		| undefined;

	constructor(
		options: HubRuntimeHostOptions,
		clientContext?: { workspaceRoot?: string; cwd?: string },
	) {
		this.requestToolApproval = options.requestToolApproval;
		this.runtimeAddress = options.url;
		this.client = new NodeHubClient({
			url: options.url,
			authToken: options.authToken,
			clientType: options.clientType ?? "core-hub-runtime",
			displayName: options.displayName ?? "core hub runtime",
			workspaceRoot: clientContext?.workspaceRoot,
			cwd: clientContext?.cwd,
		});
	}

	async connect(): Promise<void> {
		await this.client.connect();
	}

	async start(input: StartSessionInput): Promise<StartSessionResult> {
		const advertisedToolExecutors = Object.keys(
			input.localRuntime?.defaultToolExecutors ?? {},
		).filter(isHubToolExecutorName);
		const reply = await this.client.command("session.create", {
			workspaceRoot: input.config.workspaceRoot?.trim() || input.config.cwd,
			cwd: input.config.cwd,
			sessionConfig: toJsonRecord(input.config as Record<string, unknown>),
			metadata: {
				...(input.sessionMetadata ?? {}),
				source: input.source ?? SessionSource.CORE,
				provider: input.config.providerId,
				model: input.config.modelId,
				enableTools: input.config.enableTools,
				enableSpawn: input.config.enableSpawnAgent,
				enableTeams: input.config.enableAgentTeams,
				teamName: input.config.teamName,
				prompt: input.prompt,
				interactive: input.interactive === true,
			},
			runtimeOptions: {
				toolExecutors: advertisedToolExecutors,
			},
			toolPolicies: toJsonRecord(
				input.toolPolicies as Record<string, unknown> | undefined,
			),
			initialMessages: input.initialMessages,
		});
		const session = reply.payload?.session as HubSessionRecord | undefined;
		const sessionId = session?.sessionId?.trim();
		if (!sessionId) {
			throw new Error("Hub runtime did not return a session id.");
		}
		if (input.localRuntime?.defaultToolExecutors) {
			this.sessionToolExecutors.set(
				sessionId,
				input.localRuntime.defaultToolExecutors,
			);
		}
		this.ensureSessionSubscription(sessionId);

		return {
			sessionId,
			manifest: buildManifest(sessionId, input, session),
			manifestPath: "",
			messagesPath: "",
			result: undefined,
		};
	}

	async restore(input: RestoreSessionInput): Promise<RestoreSessionResult> {
		const sessionId = input.sessionId.trim();
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		const restoreMessages = input.restore?.messages !== false;
		if (restoreMessages && !input.start) {
			throw new Error("start is required when restore.messages is true");
		}
		const startConfig = input.start;
		const advertisedToolExecutors = startConfig
			? Object.keys(
					startConfig.localRuntime?.defaultToolExecutors ?? {},
				).filter(isHubToolExecutorName)
			: [];
		const reply = await this.client.command(
			"session.restore",
			{
				sessionId,
				checkpointRunCount: input.checkpointRunCount,
				restore: input.restore,
				...(startConfig
					? {
							workspaceRoot:
								startConfig.config.workspaceRoot?.trim() ||
								startConfig.config.cwd,
							cwd: startConfig.config.cwd ?? input.cwd,
							sessionConfig: toJsonRecord(
								startConfig.config as Record<string, unknown>,
							),
							metadata: {
								...(startConfig.sessionMetadata ?? {}),
								source: startConfig.source ?? SessionSource.CORE,
								provider: startConfig.config.providerId,
								model: startConfig.config.modelId,
								enableTools: startConfig.config.enableTools,
								enableSpawn: startConfig.config.enableSpawnAgent,
								enableTeams: startConfig.config.enableAgentTeams,
								teamName: startConfig.config.teamName,
								prompt: startConfig.prompt,
								interactive: startConfig.interactive === true,
							},
							runtimeOptions: {
								toolExecutors: advertisedToolExecutors,
							},
							toolPolicies: toJsonRecord(
								startConfig.toolPolicies as Record<string, unknown> | undefined,
							),
						}
					: {}),
			},
			sessionId,
		);
		if (!reply.ok) {
			const errorMsg =
				typeof reply.payload?.error === "string"
					? reply.payload.error
					: "session.restore failed";
			throw new Error(errorMsg);
		}
		const session = reply.payload?.session as HubSessionRecord | undefined;
		const newSessionId = session?.sessionId?.trim();
		if (restoreMessages && !newSessionId) {
			throw new Error("Hub checkpoint restore returned no session id");
		}
		if (newSessionId && startConfig?.localRuntime?.defaultToolExecutors) {
			this.sessionToolExecutors.set(
				newSessionId,
				startConfig.localRuntime.defaultToolExecutors,
			);
		}
		if (newSessionId) {
			this.ensureSessionSubscription(newSessionId);
		}
		const messages = Array.isArray(reply.payload?.messages)
			? (reply.payload.messages as import("@clinebot/llms").Message[])
			: undefined;
		const checkpoint = reply.payload?.checkpoint as
			| RestoreSessionResult["checkpoint"]
			| undefined;
		if (!checkpoint) {
			throw new Error("Hub checkpoint restore returned no checkpoint");
		}
		return {
			sessionId: newSessionId,
			startResult: newSessionId
				? {
						sessionId: newSessionId,
						manifest: buildManifest(
							newSessionId,
							startConfig ?? ({} as StartSessionInput),
							session,
						),
						manifestPath: "",
						messagesPath: "",
						result: undefined,
					}
				: undefined,
			messages,
			checkpoint,
		};
	}

	async send(input: SendSessionInput): Promise<AgentResult | undefined> {
		this.ensureSessionSubscription(input.sessionId);
		const reply = await this.client.command(
			"run.start",
			{
				sessionId: input.sessionId,
				input: input.prompt,
				attachments:
					(input.userImages?.length ?? 0) > 0 ||
					(input.userFiles?.length ?? 0) > 0
						? {
								...(input.userImages?.length
									? { userImages: input.userImages }
									: {}),
								...(input.userFiles?.length
									? {
											userFiles: input.userFiles,
										}
									: {}),
							}
						: undefined,
				delivery: input.delivery,
			},
			input.sessionId,
			{ timeoutMs: null },
		);
		return reply.payload?.result as AgentResult | undefined;
	}

	async pendingPrompts(
		action: "list",
		input: PendingPromptsListInput,
	): Promise<SessionPendingPrompt[]>;
	async pendingPrompts(
		action: "update",
		input: PendingPromptsUpdateInput,
	): Promise<PendingPromptMutationResult>;
	async pendingPrompts(
		action: "delete",
		input: PendingPromptsDeleteInput,
	): Promise<PendingPromptMutationResult>;
	async pendingPrompts(
		action: PendingPromptsAction,
		input:
			| PendingPromptsListInput
			| PendingPromptsUpdateInput
			| PendingPromptsDeleteInput,
	): Promise<SessionPendingPrompt[] | PendingPromptMutationResult> {
		switch (action) {
			case "list":
				return await this.listPendingPromptEntries(input);
			case "update":
				return await this.editPendingPromptEntry(
					input as PendingPromptsUpdateInput,
				);
			case "delete":
				return await this.deletePendingPromptEntry(
					input as PendingPromptsDeleteInput,
				);
		}
	}

	private async listPendingPromptEntries(
		input: PendingPromptsListInput,
	): Promise<SessionPendingPrompt[]> {
		this.ensureSessionSubscription(input.sessionId);
		const reply = await this.client.command(
			"session.pending_prompts",
			{ sessionId: input.sessionId },
			input.sessionId,
		);
		return Array.isArray(reply.payload?.prompts)
			? (reply.payload.prompts as SessionPendingPrompt[])
			: [];
	}

	private async editPendingPromptEntry(
		input: PendingPromptsUpdateInput,
	): Promise<PendingPromptMutationResult> {
		this.ensureSessionSubscription(input.sessionId);
		const reply = await this.client.command(
			"session.update_pending_prompt",
			{ ...input },
			input.sessionId,
		);
		return {
			sessionId: input.sessionId,
			prompts: Array.isArray(reply.payload?.prompts)
				? (reply.payload.prompts as SessionPendingPrompt[])
				: [],
			prompt: reply.payload?.prompt as SessionPendingPrompt | undefined,
			updated: reply.payload?.updated === true,
		};
	}

	private async deletePendingPromptEntry(
		input: PendingPromptsDeleteInput,
	): Promise<PendingPromptMutationResult> {
		this.ensureSessionSubscription(input.sessionId);
		const reply = await this.client.command(
			"session.remove_pending_prompt",
			{ ...input },
			input.sessionId,
		);
		return {
			sessionId: input.sessionId,
			prompts: Array.isArray(reply.payload?.prompts)
				? (reply.payload.prompts as SessionPendingPrompt[])
				: [],
			prompt: reply.payload?.prompt as SessionPendingPrompt | undefined,
			removed: reply.payload?.removed === true,
		};
	}

	async getAccumulatedUsage(
		sessionId: string,
	): Promise<SessionAccumulatedUsage | undefined> {
		const reply = await this.client.command(
			"session.get",
			undefined,
			sessionId,
		);
		const session = reply.payload?.session as
			| (HubSessionRecord & { usage?: SessionAccumulatedUsage })
			| undefined;
		return session?.usage ? { ...session.usage } : undefined;
	}

	async abort(sessionId: string, reason?: unknown): Promise<void> {
		await this.client.command(
			"run.abort",
			{ sessionId, reason: typeof reason === "string" ? reason : undefined },
			sessionId,
		);
	}

	async stop(sessionId: string): Promise<void> {
		this.sessionToolExecutors.delete(sessionId);
		this.disposeSessionSubscription(sessionId);
		await this.client.command("session.detach", { sessionId }, sessionId);
	}

	async dispose(): Promise<void> {
		for (const [sessionId, unsubscribe] of this.sessionSubscriptions) {
			unsubscribe();
			try {
				await this.client.command("session.detach", { sessionId }, sessionId);
			} catch {
				// Best-effort detach during shutdown.
			}
		}
		this.sessionSubscriptions.clear();
		this.sessionToolExecutors.clear();
		await this.client.dispose();
	}

	async get(sessionId: string): Promise<SessionRecord | undefined> {
		const reply = await this.client.command(
			"session.get",
			undefined,
			sessionId,
		);
		const session = reply.payload?.session as HubSessionRecord | undefined;
		return session ? toSessionRecord(session) : undefined;
	}

	async list(limit = 100): Promise<SessionRecord[]> {
		const reply = await this.client.command("session.list", { limit });
		const sessions =
			(reply.payload?.sessions as HubSessionRecord[] | undefined) ?? [];
		return sessions.map(toSessionRecord);
	}

	async listSettings(
		input?: CoreSettingsListInput,
	): Promise<CoreSettingsSnapshot> {
		const reply = await this.client.command(
			"settings.list",
			serializeSettingsInput(input),
		);
		if (!reply.ok) {
			throw new Error(hubReplyErrorMessage(reply, "settings.list"));
		}
		return reply.payload?.snapshot as CoreSettingsSnapshot;
	}

	async toggleSetting(
		input: CoreSettingsToggleInput,
	): Promise<CoreSettingsMutationResult> {
		const reply = await this.client.command(
			"settings.toggle",
			serializeSettingsInput(input),
		);
		if (!reply.ok) {
			throw new Error(hubReplyErrorMessage(reply, "settings.toggle"));
		}
		return {
			snapshot: reply.payload?.snapshot as CoreSettingsSnapshot,
			changedTypes: Array.isArray(reply.payload?.changedTypes)
				? (reply.payload
						.changedTypes as CoreSettingsMutationResult["changedTypes"])
				: [],
		};
	}

	async delete(sessionId: string): Promise<boolean> {
		this.sessionToolExecutors.delete(sessionId);
		this.disposeSessionSubscription(sessionId);
		const reply = await this.client.command("session.delete", { sessionId });
		return reply.payload?.deleted === true;
	}

	async update(
		sessionId: string,
		updates: {
			prompt?: string | null;
			metadata?: Record<string, unknown> | null;
			title?: string | null;
		},
	): Promise<{ updated: boolean }> {
		const metadata: Record<string, unknown> = {
			...(updates.metadata ?? {}),
		};
		if (typeof updates.prompt === "string") {
			metadata.prompt = updates.prompt;
		}
		if (typeof updates.title === "string") {
			metadata.title = updates.title;
		}
		const reply = await this.client.command("session.update", {
			sessionId,
			metadata,
		});
		return { updated: reply.ok };
	}

	async readMessages(
		sessionId: string,
	): Promise<import("@clinebot/llms").Message[]> {
		const target = sessionId.trim();
		if (!target) {
			return [];
		}
		const reply = await this.client.command(
			"session.messages",
			{ sessionId: target },
			target,
		);
		if (!reply.ok) {
			throw new Error(hubReplyErrorMessage(reply, "session.messages"));
		}
		const messages = reply.payload?.messages;
		return Array.isArray(messages)
			? (messages as import("@clinebot/llms").Message[])
			: [];
	}

	async handleHookEvent(_payload: HookEventPayload): Promise<void> {
		await this.client.command("session.hook", { payload: _payload });
	}

	subscribe(
		listener: (event: CoreSessionEvent) => void,
		options?: RuntimeHostSubscribeOptions,
	): () => void {
		return this.events.subscribe(listener, options);
	}

	private ensureSessionSubscription(sessionId: string): void {
		const target = sessionId.trim();
		if (!target || this.sessionSubscriptions.has(target)) {
			return;
		}
		const subscription = this.client.subscribe(
			(event) => {
				this.handleHubEvent(event);
			},
			{ sessionId: target },
		);
		this.sessionSubscriptions.set(
			target,
			typeof subscription === "function" ? subscription : () => {},
		);
	}

	private disposeSessionSubscription(sessionId: string): void {
		const target = sessionId.trim();
		if (!target) {
			return;
		}
		this.sessionSubscriptions.get(target)?.();
		this.sessionSubscriptions.delete(target);
	}

	private emitToolCallContentStart(input: {
		sessionId: string;
		toolCallId?: string;
		toolName?: string;
		toolInput?: unknown;
	}): void {
		this.events.emit({
			type: "agent_event",
			payload: {
				sessionId: input.sessionId,
				event: {
					type: "content_start",
					contentType: "tool",
					toolCallId: input.toolCallId,
					toolName: input.toolName,
					input: input.toolInput,
				},
			},
		});
	}

	private handleHubEvent(event: HubEventEnvelope): void {
		const sessionId = event.sessionId?.trim();
		if (event.event === "capability.requested") {
			void this.handleCapabilityRequest(event);
			return;
		}
		if (event.event === "approval.requested") {
			void this.handleApprovalRequested(event);
			return;
		}
		if (!sessionId) {
			return;
		}

		switch (event.event) {
			case "iteration.started": {
				this.events.emit({
					type: "agent_event",
					payload: {
						sessionId,
						event: {
							type: "iteration_start",
							iteration:
								typeof event.payload?.iteration === "number"
									? event.payload.iteration
									: 0,
						},
					},
				});
				return;
			}
			case "iteration.finished": {
				this.events.emit({
					type: "agent_event",
					payload: {
						sessionId,
						event: {
							type: "iteration_end",
							iteration:
								typeof event.payload?.iteration === "number"
									? event.payload.iteration
									: 0,
							hadToolCalls: event.payload?.hadToolCalls === true,
							toolCallCount:
								typeof event.payload?.toolCallCount === "number"
									? event.payload.toolCallCount
									: 0,
						},
					},
				});
				return;
			}
			case "assistant.delta": {
				const text =
					typeof event.payload?.text === "string" ? event.payload.text : "";
				if (!text) {
					return;
				}
				this.events.emit({
					type: "agent_event",
					payload: {
						sessionId,
						event: {
							type: "content_start",
							contentType: "text",
							text,
						},
					},
				});
				return;
			}
			case "assistant.finished": {
				this.events.emit({
					type: "agent_event",
					payload: {
						sessionId,
						event: {
							type: "content_end",
							contentType: "text",
							text:
								typeof event.payload?.text === "string"
									? event.payload.text
									: undefined,
						},
					},
				});
				return;
			}
			case "reasoning.delta": {
				const text =
					typeof event.payload?.text === "string" ? event.payload.text : "";
				const redacted = event.payload?.redacted === true;
				if (!text && !redacted) {
					return;
				}
				this.events.emit({
					type: "agent_event",
					payload: {
						sessionId,
						event: {
							type: "content_start",
							contentType: "reasoning",
							reasoning: text,
							redacted,
						},
					},
				});
				return;
			}
			case "reasoning.finished": {
				this.events.emit({
					type: "agent_event",
					payload: {
						sessionId,
						event: {
							type: "content_end",
							contentType: "reasoning",
							reasoning:
								typeof event.payload?.reasoning === "string"
									? event.payload.reasoning
									: undefined,
						},
					},
				});
				return;
			}
			case "agent.done": {
				this.events.emit({
					type: "agent_event",
					payload: {
						sessionId,
						event: doneEventFromPayload(event.payload),
					},
				});
				return;
			}
			case "tool.started": {
				const toolCallId =
					typeof event.payload?.toolCallId === "string"
						? event.payload.toolCallId
						: undefined;
				if (toolCallId && this.pendingApprovalToolCallIds.delete(toolCallId)) {
					return;
				}
				this.emitToolCallContentStart({
					sessionId,
					toolCallId,
					toolName:
						typeof event.payload?.toolName === "string"
							? event.payload.toolName
							: undefined,
					toolInput: event.payload?.input,
				});
				return;
			}
			case "tool.finished": {
				const toolCallId =
					typeof event.payload?.toolCallId === "string"
						? event.payload.toolCallId
						: undefined;
				if (toolCallId) {
					this.pendingApprovalToolCallIds.delete(toolCallId);
				}
				this.events.emit({
					type: "agent_event",
					payload: {
						sessionId,
						event: {
							type: "content_end",
							contentType: "tool",
							toolCallId,
							toolName:
								typeof event.payload?.toolName === "string"
									? event.payload.toolName
									: undefined,
							output: event.payload?.output,
							error:
								typeof event.payload?.error === "string"
									? event.payload.error
									: undefined,
						},
					},
				});
				return;
			}
			case "run.started":
			case "session.created":
			case "session.updated":
			case "session.attached":
			case "session.detached": {
				const session = event.payload?.session as HubSessionRecord | undefined;
				this.events.emit({
					type: "status",
					payload: {
						sessionId,
						status: session?.status ?? "running",
					},
				});
				return;
			}
			case "session.pending_prompts": {
				this.events.emit({
					type: "pending_prompts",
					payload: {
						sessionId,
						prompts: Array.isArray(event.payload?.prompts)
							? (event.payload.prompts as SessionPendingPrompt[])
							: [],
					},
				});
				return;
			}
			case "session.pending_prompt_submitted": {
				const prompt = event.payload?.prompt as
					| SessionPendingPrompt
					| undefined;
				if (!prompt) {
					return;
				}
				this.events.emit({
					type: "pending_prompt_submitted",
					payload: {
						sessionId,
						id: prompt.id,
						prompt: prompt.prompt,
						delivery: prompt.delivery,
						attachmentCount: prompt.attachmentCount,
					},
				});
				return;
			}
			case "run.completed":
			case "run.aborted": {
				this.events.emit({
					type: "agent_event",
					payload: {
						sessionId,
						event: doneEventFromPayload({
							...event.payload,
							reason:
								typeof event.payload?.reason === "string"
									? event.payload.reason
									: event.event === "run.aborted"
										? "aborted"
										: "completed",
						}),
					},
				});
				this.events.emit({
					type: "ended",
					payload: {
						sessionId,
						reason:
							typeof event.payload?.reason === "string"
								? event.payload.reason
								: event.event === "run.aborted"
									? "aborted"
									: "completed",
						ts: event.timestamp ?? Date.now(),
					},
				});
				return;
			}
			default:
				return;
		}
	}

	private async handleCapabilityRequest(
		event: HubEventEnvelope,
	): Promise<void> {
		const sessionId = event.sessionId?.trim();
		if (!sessionId) {
			return;
		}
		const targetClientId =
			typeof event.payload?.targetClientId === "string"
				? event.payload.targetClientId
				: undefined;
		if (targetClientId && targetClientId !== this.client.getClientId()) {
			return;
		}
		const requestId =
			typeof event.payload?.requestId === "string"
				? event.payload.requestId
				: "";
		const capabilityName =
			typeof event.payload?.capabilityName === "string"
				? event.payload.capabilityName
				: "";
		if (!requestId || !capabilityName.startsWith("tool_executor.")) {
			return;
		}
		const executorName = capabilityName.slice("tool_executor.".length);
		const executors = this.sessionToolExecutors.get(sessionId);
		const executor = executors?.[executorName as keyof ToolExecutors] as
			| ((...args: unknown[]) => Promise<unknown>)
			| undefined;
		if (typeof executor !== "function") {
			await this.client.command(
				"capability.respond",
				{
					requestId,
					ok: false,
					error: `No executor registered for ${executorName}`,
				},
				sessionId,
			);
			return;
		}
		const payload =
			event.payload?.payload &&
			typeof event.payload.payload === "object" &&
			!Array.isArray(event.payload.payload)
				? (event.payload.payload as Record<string, unknown>)
				: {};
		const args = Array.isArray(payload.args) ? [...payload.args] : [];
		const context = parseToolContext(payload.context);
		try {
			const result = await executor(...args, context);
			await this.client.command(
				"capability.respond",
				{
					requestId,
					ok: true,
					payload: { result },
				},
				sessionId,
			);
		} catch (error) {
			await this.client.command(
				"capability.respond",
				{
					requestId,
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				},
				sessionId,
			);
		}
	}

	private async handleApprovalRequested(
		event: HubEventEnvelope,
	): Promise<void> {
		const sessionId = event.sessionId?.trim();
		if (!sessionId || !this.requestToolApproval) {
			return;
		}
		const approvalId =
			typeof event.payload?.approvalId === "string"
				? event.payload.approvalId.trim()
				: "";
		const toolCallId =
			typeof event.payload?.toolCallId === "string"
				? event.payload.toolCallId
				: "";
		const toolName =
			typeof event.payload?.toolName === "string" ? event.payload.toolName : "";
		if (!approvalId || !toolCallId || !toolName) {
			return;
		}
		const policy =
			event.payload?.policy &&
			typeof event.payload.policy === "object" &&
			!Array.isArray(event.payload.policy)
				? (event.payload.policy as ToolApprovalRequest["policy"])
				: { autoApprove: false };
		const input = parseApprovalInput(event.payload?.inputJson);
		this.pendingApprovalToolCallIds.add(toolCallId);
		this.emitToolCallContentStart({
			sessionId,
			toolCallId,
			toolName,
			toolInput: input,
		});
		const result = await Promise.resolve(
			this.requestToolApproval({
				sessionId,
				agentId:
					typeof event.payload?.agentId === "string"
						? event.payload.agentId
						: "",
				conversationId:
					typeof event.payload?.conversationId === "string"
						? event.payload.conversationId
						: sessionId,
				iteration:
					typeof event.payload?.iteration === "number"
						? event.payload.iteration
						: 0,
				toolCallId,
				toolName,
				input,
				policy,
			}),
		).catch((error) => ({
			approved: false,
			reason:
				error instanceof Error
					? error.message
					: `Tool approval request failed: ${String(error)}`,
		}));
		await this.client
			.command(
				"approval.respond",
				{
					approvalId,
					approved: result.approved,
					reason: result.reason,
				},
				sessionId,
			)
			.catch(() => {});
	}
}
