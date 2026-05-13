import type {
	AgentEvent,
	AgentFinishReason,
	AgentResult,
	AgentToolContext,
	AgentUsage,
	HubClientContribution,
	HubEventEnvelope,
	SessionRecord as HubSessionRecord,
	ITelemetryService,
	JsonValue,
	ToolApprovalRequest,
} from "@cline/shared";
import {
	captureSdkError,
	createSessionId,
	HUB_CHECKPOINT_CAPABILITY,
	HUB_COMPACTION_CAPABILITY,
	HUB_CUSTOM_TOOL_CAPABILITY_PREFIX,
	HUB_HOOK_CAPABILITY_PREFIX,
	HUB_MISTAKE_LIMIT_CAPABILITY,
	HUB_TOOL_EXECUTOR_CAPABILITY_PREFIX,
	HUB_USER_INSTRUCTIONS_SNAPSHOT_CAPABILITY,
	isHubToolExecutorName,
} from "@cline/shared";
import type { HookEventPayload } from "../../hooks";
import type { RuntimeCapabilities } from "../../runtime/capabilities";
import { normalizeRuntimeCapabilities } from "../../runtime/capabilities";
import type {
	PendingPromptMutationResult,
	PendingPromptsServiceApi,
	RestoreSessionInput,
	RestoreSessionResult,
	RuntimeHost,
	RuntimeHostSubscribeOptions,
	SendSessionInput,
	SessionAccumulatedUsage,
	SessionUsageSummary,
	StartSessionInput,
	StartSessionResult,
} from "../../runtime/host/runtime-host";
import { RuntimeHostEventBus } from "../../runtime/host/runtime-host-support";
import {
	type SessionManifest,
	SessionManifestSchema,
} from "../../session/models/session-manifest";
import {
	type CoreSessionSnapshot,
	coreSessionSnapshotToRecord,
} from "../../session/session-snapshot";
import type {
	CoreSettingsListInput,
	CoreSettingsMutationResult,
	CoreSettingsSnapshot,
	CoreSettingsToggleInput,
} from "../../settings";
import { SessionSource, type SessionStatus } from "../../types/common";
import type {
	CoreSessionEvent,
	SessionPendingPrompt,
} from "../../types/events";
import type { SessionRecord } from "../../types/sessions";
import {
	type HubClientOptions,
	isHubCommandTimeoutError,
	NodeHubClient,
	restartLocalHubIfIdleAfterStartupTimeout,
} from "../client";

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

const HUB_HOOK_NAMES = [
	"beforeRun",
	"afterRun",
	"beforeModel",
	"afterModel",
	"beforeTool",
	"afterTool",
	"onEvent",
] as const;

function toJsonSerializable(
	value: unknown,
): Record<string, JsonValue | undefined> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
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
	const { userInstructionService: _userInstructionService, ...serializable } =
		input;
	return JSON.parse(JSON.stringify(serializable)) as Record<string, unknown>;
}

function parseToolContext(value: unknown): AgentToolContext {
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

type ClientContributionHandler = (input: {
	payload: Record<string, unknown>;
	abortSignal: AbortSignal;
	progress: (payload: Record<string, unknown>) => void;
}) => Promise<Record<string, unknown> | undefined>;

interface ClientContributionRegistration {
	manifest: HubClientContribution[];
	handlers: Map<string, ClientContributionHandler>;
}

function addClientContribution(
	registration: ClientContributionRegistration,
	contribution: HubClientContribution,
	handler: ClientContributionHandler,
): void {
	registration.manifest.push(contribution);
	registration.handlers.set(contribution.capabilityName, handler);
}

function buildClientContributionRegistration(
	localRuntime: StartSessionInput["localRuntime"] | undefined,
	capabilities: RuntimeCapabilities,
): ClientContributionRegistration {
	const registration: ClientContributionRegistration = {
		manifest: [],
		handlers: new Map(),
	};

	for (const executor of Object.keys(capabilities.toolExecutors ?? {}).filter(
		isHubToolExecutorName,
	)) {
		const executorFn = capabilities.toolExecutors?.[executor] as
			| ((...args: unknown[]) => Promise<unknown>)
			| undefined;
		if (typeof executorFn !== "function") continue;
		addClientContribution(
			registration,
			{
				kind: "toolExecutor",
				executor,
				capabilityName: `${HUB_TOOL_EXECUTOR_CAPABILITY_PREFIX}${executor}`,
			},
			async ({ payload, abortSignal }) => {
				const args = Array.isArray(payload.args) ? [...payload.args] : [];
				const context = {
					...parseToolContext(payload.context),
					signal: abortSignal,
				};
				return { result: await executorFn(...args, context) };
			},
		);
	}

	for (const tool of localRuntime?.extraTools ?? []) {
		addClientContribution(
			registration,
			{
				kind: "tool",
				name: tool.name,
				description: tool.description,
				inputSchema: toJsonRecord(tool.inputSchema) ?? {},
				...(tool.lifecycle
					? {
							lifecycle: toJsonRecord(
								tool.lifecycle as Record<string, unknown>,
							),
						}
					: {}),
				capabilityName: `${HUB_CUSTOM_TOOL_CAPABILITY_PREFIX}${tool.name}`,
			},
			async ({ payload, abortSignal, progress }) => {
				const context = {
					...parseToolContext(payload.context),
					signal: abortSignal,
				};
				const result = await tool.execute(payload.input, {
					...context,
					emitUpdate: (update) => {
						progress({ update });
					},
				});
				return { result };
			},
		);
	}

	const hooks = localRuntime?.hooks as Record<string, unknown> | undefined;
	if (hooks) {
		for (const name of HUB_HOOK_NAMES) {
			const hook = hooks[name];
			if (typeof hook !== "function") continue;
			addClientContribution(
				registration,
				{
					kind: "hook",
					name,
					capabilityName: `${HUB_HOOK_CAPABILITY_PREFIX}${name}`,
				},
				async ({ payload }) => ({
					control: await hook(payload.context),
				}),
			);
		}
	}

	if (localRuntime?.compaction?.compact) {
		const compact = localRuntime.compaction.compact;
		addClientContribution(
			registration,
			{
				kind: "compaction",
				capabilityName: HUB_COMPACTION_CAPABILITY,
				config: toJsonSerializable(localRuntime.compaction),
			},
			async ({ payload }) => ({
				result: await compact(payload.context as never),
			}),
		);
	}

	if (localRuntime?.checkpoint?.createCheckpoint) {
		const createCheckpoint = localRuntime.checkpoint.createCheckpoint;
		addClientContribution(
			registration,
			{
				kind: "checkpoint",
				capabilityName: HUB_CHECKPOINT_CAPABILITY,
				config: toJsonSerializable(localRuntime.checkpoint),
			},
			async ({ payload }) => ({
				result: await createCheckpoint(payload.context as never),
			}),
		);
	}

	if (localRuntime?.onConsecutiveMistakeLimitReached) {
		const decide = localRuntime.onConsecutiveMistakeLimitReached;
		addClientContribution(
			registration,
			{
				kind: "mistakeLimit",
				capabilityName: HUB_MISTAKE_LIMIT_CAPABILITY,
			},
			async ({ payload }) => ({
				result: await decide(payload.context as never),
			}),
		);
	}

	if (localRuntime?.userInstructionService) {
		const service = localRuntime.userInstructionService;
		addClientContribution(
			registration,
			{
				kind: "userInstructionService",
				capabilityName: HUB_USER_INSTRUCTIONS_SNAPSHOT_CAPABILITY,
			},
			async () => {
				await service.start().catch(() => {});
				return {
					snapshot: {
						records: {
							skill: service.listRecords("skill"),
							rule: service.listRecords("rule"),
							workflow: service.listRecords("workflow"),
						},
						runtimeCommands: service.listRuntimeCommands(),
					},
				};
			},
		);
	}

	return registration;
}

function abortReasonMessage(value: unknown): string {
	if (typeof value === "string" && value.trim()) {
		return value.trim();
	}
	if (value instanceof Error) {
		return value.message;
	}
	if (value && typeof value === "object" && "message" in value) {
		const message = (value as { message?: unknown }).message;
		if (typeof message === "string" && message.trim()) {
			return message.trim();
		}
	}
	return "Capability request was cancelled.";
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

function accumulatedUsageFromMetrics(
	value: HubSessionRecord["usage"],
): SessionAccumulatedUsage | undefined {
	if (!value) {
		return undefined;
	}
	return {
		inputTokens: typeof value.inputTokens === "number" ? value.inputTokens : 0,
		outputTokens:
			typeof value.outputTokens === "number" ? value.outputTokens : 0,
		cacheReadTokens:
			typeof value.cacheReadTokens === "number" ? value.cacheReadTokens : 0,
		cacheWriteTokens:
			typeof value.cacheWriteTokens === "number" ? value.cacheWriteTokens : 0,
		totalCost: typeof value.totalCost === "number" ? value.totalCost : 0,
	};
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function usageMetric(
	record: Record<string, unknown> | undefined,
	key: string,
): number {
	return finiteNumber(record?.[key]) ?? 0;
}

function usageEventFromPayload(payload: Record<string, unknown> | undefined): {
	event: Extract<AgentEvent, { type: "usage" }>;
	teamAgentId?: string;
	teamRole?: "lead" | "teammate";
} {
	const delta =
		payload?.delta && typeof payload.delta === "object"
			? (payload.delta as Record<string, unknown>)
			: undefined;
	const totals =
		payload?.totals && typeof payload.totals === "object"
			? (payload.totals as Record<string, unknown>)
			: undefined;
	const agent =
		payload?.agent && typeof payload.agent === "object"
			? (payload.agent as Record<string, unknown>)
			: undefined;
	const teamRole =
		agent?.teamRole === "teammate" || agent?.teamRole === "lead"
			? agent.teamRole
			: undefined;
	return {
		event: {
			type: "usage",
			agentId: typeof agent?.agentId === "string" ? agent.agentId : undefined,
			conversationId:
				typeof agent?.conversationId === "string"
					? agent.conversationId
					: undefined,
			parentAgentId:
				typeof agent?.parentAgentId === "string"
					? agent.parentAgentId
					: undefined,
			inputTokens: usageMetric(delta, "inputTokens"),
			outputTokens: usageMetric(delta, "outputTokens"),
			cacheReadTokens: usageMetric(delta, "cacheReadTokens"),
			cacheWriteTokens: usageMetric(delta, "cacheWriteTokens"),
			cost: finiteNumber(delta?.totalCost),
			totalInputTokens: usageMetric(totals, "inputTokens"),
			totalOutputTokens: usageMetric(totals, "outputTokens"),
			totalCacheReadTokens: usageMetric(totals, "cacheReadTokens"),
			totalCacheWriteTokens: usageMetric(totals, "cacheWriteTokens"),
			totalCost: finiteNumber(totals?.totalCost),
		},
		teamAgentId:
			typeof agent?.teamAgentId === "string" ? agent.teamAgentId : undefined,
		teamRole,
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
	capabilities?: RuntimeCapabilities;
	telemetry?: ITelemetryService;
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

function parseCoreSessionSnapshot(
	value: unknown,
): CoreSessionSnapshot | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const snapshot = value as Partial<CoreSessionSnapshot>;
	return snapshot.version === 1 && typeof snapshot.sessionId === "string"
		? (JSON.parse(JSON.stringify(snapshot)) as CoreSessionSnapshot)
		: undefined;
}

function sessionRecordFromPayload(
	payload: Record<string, unknown> | undefined,
): SessionRecord | undefined {
	const snapshot = parseCoreSessionSnapshot(payload?.snapshot);
	if (snapshot) {
		return coreSessionSnapshotToRecord(snapshot);
	}
	const session = payload?.session as HubSessionRecord | undefined;
	return session ? toSessionRecord(session) : undefined;
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

function buildManifestFromSnapshot(
	snapshot: CoreSessionSnapshot,
	input: StartSessionInput,
): SessionManifest {
	return SessionManifestSchema.parse({
		version: 1,
		session_id: snapshot.sessionId,
		source: snapshot.source,
		pid: process.pid,
		started_at: snapshot.createdAt,
		status: snapshot.status,
		interactive: snapshot.interactive,
		provider: snapshot.model.providerId,
		model: snapshot.model.modelId,
		cwd: snapshot.workspace.cwd,
		workspace_root: snapshot.workspace.root,
		team_name: snapshot.team?.name,
		enable_tools: snapshot.capabilities.enableTools,
		enable_spawn: snapshot.capabilities.enableSpawn,
		enable_teams: snapshot.capabilities.enableTeams,
		prompt: (snapshot.prompt ?? input.prompt?.trim()) || undefined,
		metadata: snapshot.metadata,
		messages_path: snapshot.artifacts?.messagesPath,
	});
}

export class HubRuntimeHost implements RuntimeHost {
	public runtimeAddress: string;
	public readonly pendingPrompts: PendingPromptsServiceApi;
	private client: NodeHubClient;
	private readonly clientOptions: Omit<HubClientOptions, "url">;
	private readonly clientContext?: { workspaceRoot?: string; cwd?: string };
	private readonly events = new RuntimeHostEventBus();
	private readonly sessionCapabilities = new Map<string, RuntimeCapabilities>();
	private readonly sessionClientContributionHandlers = new Map<
		string,
		Map<string, ClientContributionHandler>
	>();
	private readonly sessionSubscriptions = new Map<string, () => void>();
	private readonly pendingApprovalToolCallIds = new Set<string>();
	private readonly agentDoneEmittedForCurrentRunBySession = new Set<string>();
	private readonly activeCapabilityAbortControllers = new Map<
		string,
		AbortController
	>();
	private readonly defaultCapabilities: RuntimeCapabilities;
	private readonly telemetry?: ITelemetryService;

	constructor(
		options: HubRuntimeHostOptions,
		clientContext?: { workspaceRoot?: string; cwd?: string },
	) {
		this.clientContext = clientContext;
		this.clientOptions = {
			authToken: options.authToken,
			clientType: options.clientType ?? "core-hub-runtime",
			displayName: options.displayName ?? "core hub runtime",
			workspaceRoot: clientContext?.workspaceRoot,
			cwd: clientContext?.cwd,
		};
		this.defaultCapabilities =
			normalizeRuntimeCapabilities(options.capabilities) ?? {};
		this.telemetry = options.telemetry;
		this.runtimeAddress = options.url;
		this.pendingPrompts = {
			list: (input) => this.requestPendingPromptsList(input),
			update: (input) => this.requestPendingPromptUpdate(input),
			delete: (input) => this.requestPendingPromptDelete(input),
		};
		this.client = this.createClient(options.url);
	}

	private createClient(url: string): NodeHubClient {
		return new NodeHubClient({ ...this.clientOptions, url });
	}

	private async replaceClient(url: string): Promise<void> {
		const previous = this.client;
		this.client = this.createClient(url);
		this.runtimeAddress = url;
		await Promise.resolve(previous.dispose()).catch(() => undefined);
	}

	private async recoverLocalHubStartupDeadlock(
		error: unknown,
	): Promise<boolean> {
		if (!isHubCommandTimeoutError(error, "session.create")) {
			return false;
		}
		const restartedUrl = await restartLocalHubIfIdleAfterStartupTimeout({
			url: this.client.getUrl(),
			workspaceRoot: this.clientContext?.workspaceRoot,
			cwd: this.clientContext?.cwd,
		}).catch(() => undefined);
		if (!restartedUrl) {
			return false;
		}
		await this.replaceClient(restartedUrl);
		return true;
	}

	private registerPlannedSession(
		sessionId: string,
		capabilities: RuntimeCapabilities,
		clientContributionHandlers: Map<string, ClientContributionHandler>,
	): void {
		this.sessionCapabilities.set(sessionId, capabilities);
		if (clientContributionHandlers.size > 0) {
			this.sessionClientContributionHandlers.set(
				sessionId,
				clientContributionHandlers,
			);
		}
		// The hub may call back into client contributions while handling
		// `session.create` (for example user_instructions.snapshot during local
		// runtime bootstrap). Subscribe before sending the command so those
		// capability.requested events are observed and answered instead of
		// deadlocking session.create.
		this.ensureSessionSubscription(sessionId);
	}

	private cleanupPlannedSession(sessionId: string): void {
		this.sessionCapabilities.delete(sessionId);
		this.sessionClientContributionHandlers.delete(sessionId);
		this.disposeSessionSubscription(sessionId);
	}

	async connect(): Promise<void> {
		await this.client.connect();
	}

	async startSession(input: StartSessionInput): Promise<StartSessionResult> {
		const capabilities = this.resolveCapabilities(input);
		const clientContributions = buildClientContributionRegistration(
			input.localRuntime,
			capabilities,
		);
		const plannedSessionId =
			input.config.sessionId?.trim() || createSessionId();
		const sendCreateCommand = () =>
			this.client.command("session.create", {
				workspaceRoot: input.config.workspaceRoot?.trim() || input.config.cwd,
				cwd: input.config.cwd,
				sessionConfig: toJsonRecord({
					...(input.config as Record<string, unknown>),
					sessionId: plannedSessionId,
				}),
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
					...(clientContributions.manifest.length > 0
						? { clientContributions: clientContributions.manifest }
						: {}),
					...(input.localRuntime?.configExtensions
						? { configExtensions: input.localRuntime.configExtensions }
						: {}),
				},
				toolPolicies: toJsonRecord(
					input.toolPolicies as Record<string, unknown> | undefined,
				),
				initialMessages: input.initialMessages,
			});
		this.registerPlannedSession(
			plannedSessionId,
			capabilities,
			clientContributions.handlers,
		);
		let reply: Awaited<ReturnType<NodeHubClient["command"]>>;
		try {
			reply = await sendCreateCommand();
		} catch (error) {
			this.cleanupPlannedSession(plannedSessionId);
			if (await this.recoverLocalHubStartupDeadlock(error)) {
				this.registerPlannedSession(
					plannedSessionId,
					capabilities,
					clientContributions.handlers,
				);
				try {
					reply = await sendCreateCommand();
				} catch (retryError) {
					this.cleanupPlannedSession(plannedSessionId);
					throw retryError;
				}
			} else {
				throw error;
			}
		}
		const snapshot = parseCoreSessionSnapshot(reply.payload?.snapshot);
		const session = reply.payload?.session as HubSessionRecord | undefined;
		const sessionId = (snapshot?.sessionId ?? session?.sessionId)?.trim();
		if (!sessionId) {
			this.cleanupPlannedSession(plannedSessionId);
			throw new Error("Hub runtime did not return a session id.");
		}
		if (sessionId !== plannedSessionId) {
			this.cleanupPlannedSession(plannedSessionId);
			this.registerPlannedSession(
				sessionId,
				capabilities,
				clientContributions.handlers,
			);
		}

		return {
			sessionId,
			manifest: snapshot
				? buildManifestFromSnapshot(snapshot, input)
				: buildManifest(sessionId, input, session),
			manifestPath: "",
			messagesPath: "",
			result: undefined,
		};
	}

	async restoreSession(
		input: RestoreSessionInput,
	): Promise<RestoreSessionResult> {
		const sessionId = input.sessionId.trim();
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		const restoreMessages = input.restore?.messages !== false;
		if (restoreMessages && !input.start) {
			throw new Error("start is required when restore.messages is true");
		}
		const startConfig = input.start;
		const capabilities = startConfig
			? this.resolveCapabilities(startConfig)
			: undefined;
		const clientContributions = startConfig
			? buildClientContributionRegistration(
					startConfig.localRuntime,
					capabilities ?? {},
				)
			: {
					manifest: [],
					handlers: new Map<string, ClientContributionHandler>(),
				};
		const plannedSessionId = startConfig
			? startConfig.config.sessionId?.trim() || createSessionId()
			: undefined;
		if (plannedSessionId && capabilities) {
			this.sessionCapabilities.set(plannedSessionId, capabilities);
		}
		if (plannedSessionId && clientContributions.handlers.size > 0) {
			this.sessionClientContributionHandlers.set(
				plannedSessionId,
				clientContributions.handlers,
			);
			this.ensureSessionSubscription(plannedSessionId);
		}
		let reply: Awaited<ReturnType<NodeHubClient["command"]>>;
		try {
			reply = await this.client.command(
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
								sessionConfig: toJsonRecord({
									...(startConfig.config as Record<string, unknown>),
									sessionId: plannedSessionId,
								}),
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
									...(clientContributions.manifest.length > 0
										? { clientContributions: clientContributions.manifest }
										: {}),
									...(startConfig.localRuntime?.configExtensions
										? {
												configExtensions:
													startConfig.localRuntime.configExtensions,
											}
										: {}),
								},
								toolPolicies: toJsonRecord(
									startConfig.toolPolicies as
										| Record<string, unknown>
										| undefined,
								),
							}
						: {}),
				},
				sessionId,
			);
		} catch (error) {
			if (plannedSessionId) {
				this.sessionCapabilities.delete(plannedSessionId);
				this.sessionClientContributionHandlers.delete(plannedSessionId);
				this.disposeSessionSubscription(plannedSessionId);
			}
			throw error;
		}
		if (!reply.ok) {
			const errorMsg =
				typeof reply.payload?.error === "string"
					? reply.payload.error
					: "session.restore failed";
			if (plannedSessionId) {
				this.sessionCapabilities.delete(plannedSessionId);
				this.sessionClientContributionHandlers.delete(plannedSessionId);
				this.disposeSessionSubscription(plannedSessionId);
			}
			throw new Error(errorMsg);
		}
		const snapshot = parseCoreSessionSnapshot(reply.payload?.snapshot);
		const session = reply.payload?.session as HubSessionRecord | undefined;
		const newSessionId = (snapshot?.sessionId ?? session?.sessionId)?.trim();
		if (restoreMessages && !newSessionId) {
			if (plannedSessionId) {
				this.sessionCapabilities.delete(plannedSessionId);
				this.sessionClientContributionHandlers.delete(plannedSessionId);
				this.disposeSessionSubscription(plannedSessionId);
			}
			throw new Error("Hub checkpoint restore returned no session id");
		}
		if (newSessionId && plannedSessionId && newSessionId !== plannedSessionId) {
			this.sessionCapabilities.delete(plannedSessionId);
			this.sessionClientContributionHandlers.delete(plannedSessionId);
			this.disposeSessionSubscription(plannedSessionId);
		}
		if (newSessionId && capabilities) {
			this.sessionCapabilities.set(newSessionId, capabilities);
		}
		if (newSessionId && clientContributions.handlers.size > 0) {
			this.sessionClientContributionHandlers.set(
				newSessionId,
				clientContributions.handlers,
			);
		}
		if (newSessionId) {
			this.ensureSessionSubscription(newSessionId);
		}
		const messages = Array.isArray(reply.payload?.messages)
			? (reply.payload.messages as import("@cline/llms").Message[])
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
						manifest: snapshot
							? buildManifestFromSnapshot(
									snapshot,
									startConfig ?? ({} as StartSessionInput),
								)
							: buildManifest(
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

	async runTurn(input: SendSessionInput): Promise<AgentResult | undefined> {
		this.ensureSessionSubscription(input.sessionId);
		const reply = await this.client.command(
			"run.start",
			{
				sessionId: input.sessionId,
				input: input.prompt,
				mode: input.mode,
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
				timeoutMs: input.timeoutMs,
			},
			input.sessionId,
			{ timeoutMs: null },
		);
		return reply.payload?.result as AgentResult | undefined;
	}

	private async requestPendingPromptsList(
		input: Parameters<PendingPromptsServiceApi["list"]>[0],
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

	private async requestPendingPromptUpdate(
		input: Parameters<PendingPromptsServiceApi["update"]>[0],
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

	private async requestPendingPromptDelete(
		input: Parameters<PendingPromptsServiceApi["delete"]>[0],
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
	): Promise<SessionUsageSummary | undefined> {
		const reply = await this.client.command(
			"session.get",
			{ includeSnapshot: true },
			sessionId,
		);
		const snapshot = parseCoreSessionSnapshot(reply.payload?.snapshot);
		if (snapshot) {
			const usage = snapshot.usage ? { ...snapshot.usage } : undefined;
			const aggregateUsage = snapshot.aggregateUsage
				? { ...snapshot.aggregateUsage }
				: undefined;
			return usage || aggregateUsage ? { usage, aggregateUsage } : undefined;
		}
		const session = reply.payload?.session as HubSessionRecord | undefined;
		const usage = accumulatedUsageFromMetrics(session?.usage);
		const aggregateUsage = accumulatedUsageFromMetrics(session?.aggregateUsage);
		return usage || aggregateUsage ? { usage, aggregateUsage } : undefined;
	}

	async abort(sessionId: string, reason?: unknown): Promise<void> {
		await this.client.command(
			"run.abort",
			{ sessionId, reason: typeof reason === "string" ? reason : undefined },
			sessionId,
		);
	}

	async stopSession(sessionId: string): Promise<void> {
		this.sessionCapabilities.delete(sessionId);
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
		this.sessionCapabilities.clear();
		this.agentDoneEmittedForCurrentRunBySession.clear();
		for (const controller of this.activeCapabilityAbortControllers.values()) {
			controller.abort("Hub runtime host disposed.");
		}
		this.activeCapabilityAbortControllers.clear();
		await this.client.dispose();
	}

	async getSession(sessionId: string): Promise<SessionRecord | undefined> {
		const reply = await this.client.command(
			"session.get",
			undefined,
			sessionId,
		);
		return sessionRecordFromPayload(reply.payload);
	}

	async listSessions(limit = 100): Promise<SessionRecord[]> {
		const reply = await this.client.command("session.list", { limit });
		const snapshots = Array.isArray(reply.payload?.snapshots)
			? reply.payload.snapshots.flatMap((value) => {
					const snapshot = parseCoreSessionSnapshot(value);
					return snapshot ? [coreSessionSnapshotToRecord(snapshot)] : [];
				})
			: [];
		if (snapshots.length > 0) {
			return snapshots;
		}
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

	async deleteSession(sessionId: string): Promise<boolean> {
		this.sessionCapabilities.delete(sessionId);
		this.disposeSessionSubscription(sessionId);
		const reply = await this.client.command("session.delete", {
			sessionId,
		});
		return reply.payload?.deleted === true;
	}

	async updateSession(
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

	async readSessionMessages(
		sessionId: string,
	): Promise<import("@cline/llms").Message[]> {
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
			captureSdkError(this.telemetry, {
				component: "core",
				operation: "hub.runtime_host.read_session_messages",
				error: new Error(hubReplyErrorMessage(reply, "session.messages")),
				severity: reply.error?.code === "session_not_found" ? "warn" : "error",
				handled: true,
				context: {
					command: "session.messages",
					sessionId: target,
					errorCode: reply.error?.code,
					runtimeAddress: this.runtimeAddress,
				},
			});
			throw new Error(hubReplyErrorMessage(reply, "session.messages"));
		}
		const messages = reply.payload?.messages;
		return Array.isArray(messages)
			? (messages as import("@cline/llms").Message[])
			: [];
	}

	async dispatchHookEvent(_payload: HookEventPayload): Promise<void> {
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
		this.agentDoneEmittedForCurrentRunBySession.delete(target);
	}

	private resolveCapabilities(input: StartSessionInput): RuntimeCapabilities {
		return (
			normalizeRuntimeCapabilities(
				this.defaultCapabilities,
				input.capabilities,
			) ?? {}
		);
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

	private emitAgentDoneIfNeeded(input: {
		sessionId: string;
		payload: Record<string, unknown> | undefined;
	}): void {
		const alreadyEmitted = this.agentDoneEmittedForCurrentRunBySession.has(
			input.sessionId,
		);
		if (alreadyEmitted) {
			return;
		}
		this.agentDoneEmittedForCurrentRunBySession.add(input.sessionId);
		this.events.emit({
			type: "agent_event",
			payload: {
				sessionId: input.sessionId,
				event: doneEventFromPayload(input.payload),
			},
		});
	}

	private handleHubEvent(event: HubEventEnvelope): void {
		const sessionId = event.sessionId?.trim();
		if (event.event === "capability.requested") {
			void this.handleCapabilityRequest(event);
			return;
		}
		if (event.event === "capability.resolved") {
			this.handleCapabilityResolved(event);
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
			case "run.started": {
				this.agentDoneEmittedForCurrentRunBySession.delete(sessionId);
				const snapshot = parseCoreSessionSnapshot(event.payload?.snapshot);
				const session = event.payload?.session as HubSessionRecord | undefined;
				if (snapshot) {
					this.events.emit({
						type: "session_snapshot",
						payload: { sessionId, snapshot },
					});
				}
				this.events.emit({
					type: "status",
					payload: {
						sessionId,
						status: session?.status ?? "running",
					},
				});
				return;
			}
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
				this.emitAgentDoneIfNeeded({
					sessionId,
					payload: event.payload,
				});
				return;
			}
			case "usage.updated": {
				const usage = usageEventFromPayload(event.payload);
				this.events.emit({
					type: "agent_event",
					payload: {
						sessionId,
						event: usage.event,
						teamAgentId: usage.teamAgentId,
						teamRole: usage.teamRole,
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
			case "session.created":
			case "session.updated":
			case "session.attached":
			case "session.detached": {
				const snapshot = parseCoreSessionSnapshot(event.payload?.snapshot);
				const session = event.payload?.session as HubSessionRecord | undefined;
				if (snapshot) {
					this.events.emit({
						type: "session_snapshot",
						payload: { sessionId, snapshot },
					});
				}
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
			case "run.failed":
			case "run.aborted": {
				const reason =
					typeof event.payload?.reason === "string"
						? event.payload.reason
						: event.event === "run.aborted"
							? "aborted"
							: event.event === "run.failed"
								? "error"
								: "completed";
				this.emitAgentDoneIfNeeded({
					sessionId,
					payload: {
						...event.payload,
						reason,
					},
				});
				this.events.emit({
					type: "ended",
					payload: {
						sessionId,
						reason,
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
		if (!requestId) {
			return;
		}
		const handler = this.sessionClientContributionHandlers
			.get(sessionId)
			?.get(capabilityName);
		if (!handler) {
			await this.client
				.command(
					"capability.respond",
					{
						requestId,
						ok: false,
						error: `No client contribution handler registered for capability ${capabilityName} in session ${sessionId}.`,
					},
					sessionId,
				)
				.catch(() => {});
			return;
		}
		const payload =
			event.payload?.payload &&
			typeof event.payload.payload === "object" &&
			!Array.isArray(event.payload.payload)
				? (event.payload.payload as Record<string, unknown>)
				: {};
		const abortController = new AbortController();
		this.activeCapabilityAbortControllers.set(requestId, abortController);
		const progress = (progressPayload: Record<string, unknown>): void => {
			void this.client.command(
				"capability.progress",
				{
					requestId,
					payload: progressPayload,
				},
				sessionId,
			);
		};
		try {
			const responsePayload = await handler({
				payload,
				abortSignal: abortController.signal,
				progress,
			});
			if (abortController.signal.aborted) {
				return;
			}
			await this.client.command(
				"capability.respond",
				{
					requestId,
					ok: true,
					payload: responsePayload,
				},
				sessionId,
			);
		} catch (error) {
			if (abortController.signal.aborted) {
				return;
			}
			await this.client.command(
				"capability.respond",
				{
					requestId,
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				},
				sessionId,
			);
		} finally {
			this.activeCapabilityAbortControllers.delete(requestId);
		}
	}

	private handleCapabilityResolved(event: HubEventEnvelope): void {
		if (event.payload?.cancelled !== true) {
			return;
		}
		const requestId =
			typeof event.payload.requestId === "string"
				? event.payload.requestId.trim()
				: "";
		if (!requestId) {
			return;
		}
		const controller = this.activeCapabilityAbortControllers.get(requestId);
		if (!controller) {
			return;
		}
		controller.abort(abortReasonMessage(event.payload.error));
	}

	private async handleApprovalRequested(
		event: HubEventEnvelope,
	): Promise<void> {
		const sessionId = event.sessionId?.trim();
		if (!sessionId) {
			return;
		}
		const requestToolApproval =
			this.sessionCapabilities.get(sessionId)?.requestToolApproval ??
			this.defaultCapabilities.requestToolApproval;
		if (!requestToolApproval) {
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
			requestToolApproval({
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
