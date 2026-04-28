import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type * as LlmsProviders from "@clinebot/llms";
import {
	type AgentConfig,
	type AgentEvent,
	type AgentResult,
	type AutomationEventEnvelope,
	type BasicLogger,
	type BasicLogMetadata,
	createSessionId,
	type ITelemetryService,
	isLikelyAuthError,
	normalizeUserInput,
	type Tool,
	type ToolApprovalRequest,
	type ToolApprovalResult,
} from "@clinebot/shared";
import { setHomeDirIfUnset } from "@clinebot/shared/storage";
import { nanoid } from "nanoid";
import { createContextCompactionPrepareTurn } from "../extensions/context/compaction";
import {
	createBuiltinTools,
	resolveToolPresetName,
	type ToolExecutors,
	ToolPresets,
} from "../extensions/tools";
import { createSpawnAgentTool, type TeamEvent } from "../extensions/tools/team";
import type { HookEventPayload } from "../hooks";
import { DefaultRuntimeBuilder } from "../runtime/runtime-builder";
import type {
	PendingPromptMutationResult,
	PendingPromptsAction,
	PendingPromptsDeleteInput,
	PendingPromptsListInput,
	PendingPromptsUpdateInput,
	RuntimeHost,
	RuntimeHostSubscribeOptions,
	SendSessionInput,
	SessionAccumulatedUsage,
	StartSessionInput,
	StartSessionResult,
} from "../runtime/runtime-host";
import {
	OAuthReauthRequiredError,
	type RuntimeOAuthResolution,
	RuntimeOAuthTokenManager,
} from "../runtime/runtime-oauth-token-manager";
import type { RuntimeBuilder } from "../runtime/session-runtime";
import { SessionRuntime } from "../runtime/session-runtime-orchestrator";
import {
	type AgentEventContext,
	buildTelemetryAgentIdentity,
	extractAgentEventMetadata,
	handleAgentEvent,
} from "../services/agent-events";
import { resolveWorkspacePath } from "../services/config";
import { filterDisabledTools } from "../services/global-settings";
import { prepareLocalRuntimeBootstrap } from "../services/local-runtime-bootstrap";
import { nowIso } from "../services/session-artifacts";
import {
	toSessionRecord,
	withLatestAssistantTurnMetadata,
} from "../services/session-data";
import {
	emitMentionTelemetry,
	emitSessionCreationTelemetry,
} from "../services/session-telemetry";
import { ProviderSettingsManager } from "../services/storage/provider-settings-manager";
import {
	captureAgentCreated,
	captureAgentTeamCreated,
	captureConversationTurnEvent,
	captureModeSwitch,
	captureSubagentExecution,
	captureTaskCompleted,
} from "../services/telemetry/core-events";
import { resolveCoreDistinctId } from "../services/telemetry/distinct-id";
import {
	accumulateUsageTotals,
	createInitialAccumulatedUsage,
} from "../services/usage";
import { enrichPromptWithMentions } from "../services/workspace";
import type { FileSessionService } from "../session/file-session-service";
import {
	type SessionManifest,
	SessionManifestSchema,
} from "../session/session-manifest";
import type { SessionRow } from "../session/session-row";
import type {
	CoreSessionService,
	RootSessionArtifacts,
} from "../session/session-service";
import {
	buildTeamRunContinuationPrompt,
	dispatchTeamEventToBackend,
	emitTeamProgress,
	formatModePrompt,
	hasPendingTeamRunWork,
	notifyTeamRunWaiters,
	shouldAutoContinueTeamRuns,
	trackTeamRunState,
	waitForTeamRunUpdates,
} from "../session/session-team-coordination";
import { SessionSource, type SessionStatus } from "../types/common";
import type { CoreSessionConfig } from "../types/config";
import type { CoreSessionEvent, SessionPendingPrompt } from "../types/events";
import type {
	ActiveSession,
	PendingPrompt,
	PreparedTurnInput,
} from "../types/session";
import type { SessionRecord } from "../types/sessions";
import {
	cloneAccumulatedUsage,
	RuntimeHostEventBus,
	readPersistedMessagesFile,
	replaySubagentHookEvent,
} from "./runtime-host-support";

type SessionBackend = CoreSessionService | FileSessionService;

const MAX_SCAN_LIMIT = 5000;
const MAX_USER_FILE_BYTES = 20 * 1_000 * 1_024;

async function loadUserFileContent(path: string): Promise<string> {
	const fileStat = await stat(path);
	if (!fileStat.isFile()) {
		throw new Error("Path is not a file");
	}
	if (fileStat.size > MAX_USER_FILE_BYTES) {
		throw new Error("File is too large to read into context.");
	}
	const content = await readFile(path, "utf8");
	if (content.includes("\u0000")) {
		throw new Error("Cannot read binary file into context.");
	}
	return content;
}

function toActiveSessionRecord(session: ActiveSession): SessionRecord {
	return {
		sessionId: session.sessionId,
		source: session.source,
		pid: process.pid,
		startedAt: session.startedAt,
		endedAt: session.endedAt ?? null,
		exitCode: session.exitCode ?? null,
		status: session.status,
		interactive: session.interactive,
		provider: session.config.providerId,
		model: session.config.modelId,
		cwd: session.config.cwd,
		workspaceRoot: resolveWorkspacePath(session.config),
		teamName: session.config.teamName?.trim() || undefined,
		enableTools: session.config.enableTools,
		enableSpawn: session.config.enableSpawnAgent,
		enableTeams: session.config.enableAgentTeams,
		parentSessionId:
			typeof session.sessionMetadata?.parentSessionId === "string"
				? session.sessionMetadata.parentSessionId
				: undefined,
		parentAgentId:
			typeof session.sessionMetadata?.parentAgentId === "string"
				? session.sessionMetadata.parentAgentId
				: undefined,
		agentId:
			typeof session.sessionMetadata?.agentId === "string"
				? session.sessionMetadata.agentId
				: undefined,
		conversationId:
			typeof session.sessionMetadata?.conversationId === "string"
				? session.sessionMetadata.conversationId
				: undefined,
		isSubagent:
			typeof session.sessionMetadata?.isSubagent === "boolean"
				? session.sessionMetadata.isSubagent
				: false,
		prompt: session.pendingPrompt,
		metadata: session.sessionMetadata,
		messagesPath: session.artifacts?.messagesPath,
		updatedAt: session.startedAt,
	};
}

export interface LocalRuntimeHostOptions {
	distinctId?: string;
	sessionService: SessionBackend;
	runtimeBuilder?: RuntimeBuilder;
	createAgent?: (config: AgentConfig) => SessionRuntime;
	defaultToolExecutors?: Partial<ToolExecutors>;
	toolPolicies?: AgentConfig["toolPolicies"];
	providerSettingsManager?: ProviderSettingsManager;
	oauthTokenManager?: RuntimeOAuthTokenManager;
	telemetry?: ITelemetryService;
	requestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult>;
	/**
	 * Default custom `fetch` implementation threaded into every
	 * `ProviderConfig.fetch` built during local session bootstrap. Used by
	 * the AI gateway providers when issuing HTTP requests.
	 */
	fetch?: typeof fetch;
}

export class LocalRuntimeHost implements RuntimeHost {
	public readonly runtimeAddress = undefined;
	private readonly sessionService: SessionBackend;
	private readonly runtimeBuilder: RuntimeBuilder;
	private readonly createAgentInstance: (config: AgentConfig) => SessionRuntime;
	private readonly defaultToolExecutors?: Partial<ToolExecutors>;
	private readonly defaultToolPolicies?: AgentConfig["toolPolicies"];
	private readonly providerSettingsManager: ProviderSettingsManager;
	private readonly oauthTokenManager: RuntimeOAuthTokenManager;
	private readonly defaultTelemetry?: ITelemetryService;
	private readonly defaultFetch?: typeof fetch;
	private readonly defaultRequestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult>;
	private readonly events = new RuntimeHostEventBus();
	private readonly sessions = new Map<string, ActiveSession>();
	private readonly usageBySession = new Map<string, SessionAccumulatedUsage>();
	private readonly subAgentStarts = new Map<
		string,
		{ startedAt: number; rootSessionId: string }
	>();

	constructor(options: LocalRuntimeHostOptions) {
		const homeDir = homedir();
		if (homeDir) setHomeDirIfUnset(homeDir);
		const distinctId = resolveCoreDistinctId(options.distinctId);
		this.sessionService = options.sessionService;
		this.runtimeBuilder = options.runtimeBuilder ?? new DefaultRuntimeBuilder();
		this.createAgentInstance =
			options.createAgent ?? ((config) => new SessionRuntime(config));
		this.defaultToolExecutors = options.defaultToolExecutors;
		this.defaultToolPolicies = options.toolPolicies;
		this.providerSettingsManager =
			options.providerSettingsManager ?? new ProviderSettingsManager();
		this.oauthTokenManager =
			options.oauthTokenManager ??
			new RuntimeOAuthTokenManager({
				providerSettingsManager: this.providerSettingsManager,
				telemetry: options.telemetry,
			});
		this.defaultTelemetry = options.telemetry;
		this.defaultTelemetry?.setDistinctId(distinctId);
		this.defaultFetch = options.fetch;
		this.defaultRequestToolApproval = options.requestToolApproval;
	}

	// ── Public API ──────────────────────────────────────────────────────

	async start(input: StartSessionInput): Promise<StartSessionResult> {
		const source = input.source ?? SessionSource.CLI;
		const startedAt = nowIso();
		const requestedSessionId = input.config.sessionId?.trim() ?? "";
		const sessionId = requestedSessionId || createSessionId();
		const startInput: StartSessionInput = input;
		this.usageBySession.set(sessionId, createInitialAccumulatedUsage());

		const sessionsDir =
			((await this.invokeOptionalValue("ensureSessionsDir")) as
				| string
				| undefined) ?? "";
		if (!sessionsDir) {
			throw new Error(
				"session service method not available: ensureSessionsDir",
			);
		}

		const sessionDir = join(sessionsDir, sessionId);
		const messagesPath = join(sessionDir, `${sessionId}.messages.json`);
		const manifestPath = join(sessionDir, `${sessionId}.json`);
		const workspacePath = resolveWorkspacePath(input.config);

		const manifest = SessionManifestSchema.parse({
			version: 1,
			session_id: sessionId,
			source,
			pid: process.pid,
			started_at: startedAt,
			status: "running",
			interactive: input.interactive === true,
			provider: startInput.config.providerId,
			model: startInput.config.modelId,
			cwd: startInput.config.cwd,
			workspace_root: workspacePath,
			team_name: startInput.config.teamName,
			enable_tools: startInput.config.enableTools,
			enable_spawn: startInput.config.enableSpawnAgent,
			enable_teams: startInput.config.enableAgentTeams,
			prompt: startInput.prompt?.trim() || undefined,
			messages_path: messagesPath,
		});

		const sessionToolExecutors =
			input.localRuntime?.defaultToolExecutors ?? this.defaultToolExecutors;
		const inputLocalConfig = input.localRuntime?.configOverrides as
			| Partial<CoreSessionConfig>
			| undefined;
		const pluginEventFallbackLogger =
			inputLocalConfig?.extensionContext?.logger ?? inputLocalConfig?.logger;
		const pluginEventFallbackAutomation =
			inputLocalConfig?.extensionContext?.automation;
		let bootstrap!: Awaited<ReturnType<typeof prepareLocalRuntimeBootstrap>>;
		bootstrap = await prepareLocalRuntimeBootstrap({
			input: startInput,
			localRuntime: input.localRuntime,
			sessionId,
			providerSettingsManager: this.providerSettingsManager,
			defaultTelemetry: this.defaultTelemetry,
			defaultToolExecutors: sessionToolExecutors,
			defaultToolPolicies: this.defaultToolPolicies,
			defaultRequestToolApproval: this.defaultRequestToolApproval,
			defaultFetch: this.defaultFetch,
			onPluginEvent: (event) => {
				if (event.name === "plugin_log") {
					this.handlePluginLog(
						sessionId,
						event.payload,
						pluginEventFallbackLogger,
					);
					return;
				}
				void this.handlePluginEvent(
					sessionId,
					event,
					pluginEventFallbackAutomation,
				);
			},
			onTeamEvent: (event: TeamEvent) => {
				void this.handleTeamEvent(sessionId, event);
				bootstrap.config.onTeamEvent?.(event);
			},
			createSpawnTool: () =>
				this.createSpawnTool(bootstrap.config, sessionId, sessionToolExecutors),
			readSessionMetadata: async () =>
				(await this.get(sessionId))?.metadata as
					| Record<string, unknown>
					| undefined,
			writeSessionMetadata: async (metadata) => {
				await this.persistSessionMetadata(sessionId, () => metadata);
			},
		});
		const runtime = await this.runtimeBuilder.build(
			bootstrap.runtimeBuilderInput,
		);
		const configWithProvider = bootstrap.config;
		const providerConfig = bootstrap.providerConfig;
		if (runtime.teamRuntime && !configWithProvider.teamName?.trim()) {
			configWithProvider.teamName = runtime.teamRuntime.getTeamName();
		}

		const tools = [...runtime.tools, ...(configWithProvider.extraTools ?? [])];

		const agentConfig = {
			sessionId,
			providerId: providerConfig.providerId,
			modelId: providerConfig.modelId,
			apiKey: providerConfig.apiKey,
			baseUrl: providerConfig.baseUrl,
			headers: providerConfig.headers,
			knownModels: providerConfig.knownModels,
			providerConfig,
			thinking: configWithProvider.thinking,
			reasoningEffort:
				configWithProvider.reasoningEffort ?? providerConfig.reasoningEffort,
			systemPrompt: configWithProvider.systemPrompt,
			maxIterations: configWithProvider.maxIterations,
			execution: configWithProvider.execution,
			prepareTurn: createContextCompactionPrepareTurn(configWithProvider),
			tools,
			hooks: bootstrap.hooks,
			extensions: bootstrap.extensions,
			hookErrorMode: configWithProvider.hookErrorMode,
			initialMessages: bootstrap.effectiveInput.initialMessages,
			userFileContentLoader: loadUserFileContent,
			toolPolicies: bootstrap.toolPolicies,
			requestToolApproval: bootstrap.requestToolApproval,
			onConsecutiveMistakeLimitReached:
				configWithProvider.onConsecutiveMistakeLimitReached,
			completionGuard: runtime.completionGuard,
			consumePendingUserMessage: () => this.consumeSteerMessage(sessionId),
			logger: runtime.logger ?? configWithProvider.logger,
			extensionContext: configWithProvider.extensionContext,
			onEvent: (event: AgentEvent) =>
				this.onAgentEvent(sessionId, configWithProvider, event),
		} as AgentConfig;
		const agent = this.createAgentInstance(agentConfig);
		if (agentConfig.onEvent) {
			agent.subscribeEvents(agentConfig.onEvent);
		}
		runtime.registerLeadAgent?.(agent);
		const rootAgentIdentity = buildTelemetryAgentIdentity({
			agentId: agent.getAgentId(),
			conversationId: agent.getConversationId(),
			teamId: runtime.teamRuntime?.getTeamId(),
			teamName: runtime.teamRuntime?.getTeamName(),
			teamRole: runtime.teamRuntime ? "lead" : undefined,
		});
		emitSessionCreationTelemetry(
			configWithProvider,
			sessionId,
			requestedSessionId.length > 0,
			workspacePath,
			rootAgentIdentity,
		);
		if (rootAgentIdentity) {
			captureAgentCreated(configWithProvider.telemetry, {
				ulid: sessionId,
				modelId: configWithProvider.modelId,
				provider: configWithProvider.providerId,
				...rootAgentIdentity,
			});
		}
		if (runtime.teamRuntime) {
			captureAgentTeamCreated(configWithProvider.telemetry, {
				ulid: sessionId,
				teamId: runtime.teamRuntime.getTeamId(),
				teamName: runtime.teamRuntime.getTeamName(),
				leadAgentId: agent.getAgentId(),
				restoredFromPersistence: runtime.teamRestoredFromPersistence === true,
			});
		}

		const active: ActiveSession = {
			sessionId,
			config: configWithProvider,
			sessionMetadata: startInput.sessionMetadata,
			source,
			startedAt,
			pendingPrompt: manifest.prompt,
			runtime,
			agent,
			started: false,
			status: "running",
			aborting: false,
			interactive: input.interactive === true,
			persistedMessages: startInput.initialMessages,
			activeTeamRunIds: new Set<string>(),
			pendingTeamRunUpdates: [],
			teamRunWaiters: [],
			pendingPrompts: [],
			drainingPendingPrompts: false,
			pluginSandboxShutdown: bootstrap.pluginSandboxShutdown,
		};
		this.sessions.set(sessionId, active);
		this.emitStatus(sessionId, "running");
		if ((startInput.initialMessages?.length ?? 0) > 0) {
			await this.ensureSessionPersisted(active);
			await this.invoke<void>(
				"persistSessionMessages",
				active.sessionId,
				startInput.initialMessages,
				active.config.systemPrompt,
			);
			if (!startInput.prompt?.trim()) {
				await this.updateStatus(active, "completed", 0);
			}
		}

		let result: AgentResult | undefined;
		try {
			if (startInput.prompt?.trim()) {
				result = await this.runTurn(active, {
					prompt: startInput.prompt,
					userImages: startInput.userImages,
					userFiles: startInput.userFiles,
				});
				if (!active.interactive) {
					await this.finalizeSingleRun(active, result.finishReason);
				}
			}
		} catch (error) {
			await this.failSession(active);
			throw error;
		}

		return {
			sessionId,
			manifest,
			manifestPath,
			messagesPath,
			result,
		};
	}

	async send(input: SendSessionInput): Promise<AgentResult | undefined> {
		const session = this.getSessionOrThrow(input.sessionId);
		const canStartRun = session.agent.canStartRun();
		const delivery =
			input.delivery ??
			(session.interactive && !canStartRun ? ("queue" as const) : undefined);
		session.config.telemetry?.capture({
			event: "session.input_sent",
			properties: {
				sessionId: input.sessionId,
				promptLength: input.prompt.length,
				userImageCount: input.userImages?.length ?? 0,
				userFileCount: input.userFiles?.length ?? 0,
				delivery: delivery ?? "immediate",
			},
		});
		if (delivery === "queue" || delivery === "steer") {
			this.enqueuePendingPrompt(input.sessionId, {
				prompt: input.prompt,
				delivery,
				userImages: input.userImages,
				userFiles: input.userFiles,
			});
			return undefined;
		}
		try {
			const result = await this.runTurn(session, {
				prompt: input.prompt,
				userImages: input.userImages,
				userFiles: input.userFiles,
			});
			if (!session.interactive) {
				await this.finalizeSingleRun(session, result.finishReason);
			}
			queueMicrotask(() => {
				void this.drainPendingPrompts(input.sessionId);
			});
			return result;
		} catch (error) {
			await this.failSession(session);
			throw error;
		}
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
				return this.listPendingPromptEntries(input.sessionId);
			case "update":
				return this.editPendingPromptEntry(input as PendingPromptsUpdateInput);
			case "delete":
				return this.deletePendingPromptEntry(
					input as PendingPromptsDeleteInput,
				);
		}
	}

	private listPendingPromptEntries(sessionId: string): SessionPendingPrompt[] {
		const session = this.sessions.get(sessionId);
		return session ? this.snapshotPendingPrompts(session) : [];
	}

	private editPendingPromptEntry(
		input: PendingPromptsUpdateInput,
	): PendingPromptMutationResult {
		const session = this.sessions.get(input.sessionId);
		if (!session || session.aborting) {
			return { sessionId: input.sessionId, prompts: [], updated: false };
		}
		const promptId = input.promptId.trim();
		const index = session.pendingPrompts.findIndex(
			(entry) => entry.id === promptId,
		);
		if (index < 0) {
			return {
				sessionId: input.sessionId,
				prompts: this.snapshotPendingPrompts(session),
				updated: false,
			};
		}

		const existing = session.pendingPrompts[index]!;
		const prompt =
			input.prompt === undefined
				? existing.prompt
				: normalizeUserInput(input.prompt).trim();
		if (!prompt) {
			throw new Error("prompt cannot be empty");
		}
		const delivery = input.delivery ?? existing.delivery;
		const next: PendingPrompt = {
			...existing,
			prompt,
			delivery,
		};
		session.pendingPrompts.splice(index, 1);
		if (delivery === "steer") {
			session.pendingPrompts.unshift(next);
		} else if (existing.delivery === "steer") {
			session.pendingPrompts.push(next);
		} else {
			session.pendingPrompts.splice(index, 0, next);
		}
		this.emitPendingPrompts(session);
		this.schedulePendingPromptDrain(input.sessionId, session);
		return {
			sessionId: input.sessionId,
			prompts: this.snapshotPendingPrompts(session),
			prompt: this.snapshotPendingPrompt(next),
			updated: true,
		};
	}

	private deletePendingPromptEntry(
		input: PendingPromptsDeleteInput,
	): PendingPromptMutationResult {
		const session = this.sessions.get(input.sessionId);
		if (!session || session.aborting) {
			return { sessionId: input.sessionId, prompts: [], removed: false };
		}
		const promptId = input.promptId.trim();
		const index = session.pendingPrompts.findIndex(
			(entry) => entry.id === promptId,
		);
		if (index < 0) {
			return {
				sessionId: input.sessionId,
				prompts: this.snapshotPendingPrompts(session),
				removed: false,
			};
		}
		const [removed] = session.pendingPrompts.splice(index, 1);
		this.emitPendingPrompts(session);
		this.schedulePendingPromptDrain(input.sessionId, session);
		return {
			sessionId: input.sessionId,
			prompts: this.snapshotPendingPrompts(session),
			prompt: removed ? this.snapshotPendingPrompt(removed) : undefined,
			removed: true,
		};
	}

	async getAccumulatedUsage(
		sessionId: string,
	): Promise<SessionAccumulatedUsage | undefined> {
		return cloneAccumulatedUsage(this.usageBySession.get(sessionId));
	}

	async abort(sessionId: string, reason?: unknown): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		session.config.telemetry?.capture({
			event: "session.aborted",
			properties: { sessionId },
		});
		session.aborting = true;
		if (session.pendingPrompts.length > 0) {
			session.pendingPrompts.length = 0;
			this.emitPendingPrompts(session);
		}
		session.agent.abort(reason);
	}

	async stop(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		session.config.telemetry?.capture({
			event: "session.stopped",
			properties: { sessionId },
		});
		// Abort the agent first if it's running, so shutdown can proceed
		session.aborting = true;
		session.agent.abort(new Error("session_stop"));
		await this.shutdownSession(session, {
			status: "cancelled",
			exitCode: 0,
			shutdownReason: "session_stop",
			endReason: "stopped",
		});
	}

	async dispose(reason = "session_manager_dispose"): Promise<void> {
		const sessions = [...this.sessions.values()];
		if (sessions.length === 0) return;
		await Promise.allSettled(
			sessions.map((session) =>
				this.shutdownSession(session, {
					status: "cancelled",
					exitCode: 0,
					shutdownReason: reason,
					endReason: "disposed",
				}),
			),
		);
		this.usageBySession.clear();
	}

	async get(sessionId: string): Promise<SessionRecord | undefined> {
		const active = this.sessions.get(sessionId);
		if (active) {
			return toActiveSessionRecord(active);
		}
		const row = await this.getRow(sessionId);
		return row ? toSessionRecord(row) : undefined;
	}

	async list(limit = 200): Promise<SessionRecord[]> {
		const rows = await this.listRows(limit);
		const persisted = rows.map(toSessionRecord);
		const seen = new Set(persisted.map((row) => row.sessionId));
		for (const active of this.sessions.values()) {
			if (seen.has(active.sessionId)) {
				continue;
			}
			persisted.unshift(toActiveSessionRecord(active));
		}
		return persisted.slice(0, limit);
	}

	async delete(sessionId: string): Promise<boolean> {
		if (this.sessions.has(sessionId)) {
			await this.stop(sessionId);
		}
		const result = await this.invoke<{ deleted: boolean }>(
			"deleteSession",
			sessionId,
		);
		if (result.deleted) {
			this.usageBySession.delete(sessionId);
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
		const result = await this.invokeOptionalValue<{ updated?: boolean }>(
			"updateSession",
			{
				sessionId,
				prompt: updates.prompt,
				metadata: updates.metadata,
				title: updates.title,
			},
		);
		return { updated: result?.updated === true };
	}

	async readMessages(sessionId: string): Promise<LlmsProviders.Message[]> {
		const row = await this.getRow(sessionId);
		return readPersistedMessagesFile(row?.messagesPath);
	}

	async handleHookEvent(payload: HookEventPayload): Promise<void> {
		await replaySubagentHookEvent(payload, {
			queueSpawnRequest: (event: HookEventPayload) =>
				this.invokeOptional("queueSpawnRequest", event),
			upsertSubagentSessionFromHook: (event: HookEventPayload) =>
				this.invokeOptionalValue<string | undefined>(
					"upsertSubagentSessionFromHook",
					event,
				),
			appendSubagentHookAudit: (sessionId: string, event: HookEventPayload) =>
				this.invokeOptional("appendSubagentHookAudit", sessionId, event),
			applySubagentStatus: (sessionId: string, event: HookEventPayload) =>
				this.invokeOptional("applySubagentStatus", sessionId, event),
		});
	}

	subscribe(
		listener: (event: CoreSessionEvent) => void,
		options?: RuntimeHostSubscribeOptions,
	): () => void {
		return this.events.subscribe(listener, options);
	}

	async updateSessionModel(sessionId: string, modelId: string): Promise<void> {
		const session = this.getSessionOrThrow(sessionId);
		session.config.modelId = modelId;
		session.runtime.delegatedAgentConfigProvider?.updateConnectionDefaults({
			modelId,
		});
		this.updateAgentConnection(session, { modelId });
	}

	// ── Turn execution ──────────────────────────────────────────────────

	private async runTurn(
		session: ActiveSession,
		input: {
			prompt: string;
			userImages?: string[];
			userFiles?: string[];
		},
	): Promise<AgentResult> {
		const preparedInput = await this.prepareTurnInput(session, input);
		const prompt = preparedInput.prompt.trim();
		if (!prompt) throw new Error("prompt cannot be empty");

		if (!session.artifacts && !session.pendingPrompt) {
			session.pendingPrompt = prompt;
		}
		await this.ensureSessionPersisted(session);
		await this.syncOAuthCredentials(session);

		let result = await this.executeAgentTurn(
			session,
			prompt,
			preparedInput.userImages,
			preparedInput.userFiles,
		);

		while (shouldAutoContinueTeamRuns(session, result.finishReason)) {
			const updates = await waitForTeamRunUpdates(session);
			if (updates.length === 0) break;
			const continuationPrompt = buildTeamRunContinuationPrompt(
				session,
				updates,
			);
			result = await this.executeAgentTurn(session, continuationPrompt);
		}

		return result;
	}

	private async executeAgentTurn(
		session: ActiveSession,
		prompt: string,
		userImages?: string[],
		userFiles?: string[],
	): Promise<AgentResult> {
		const shouldContinue =
			session.started || session.agent.getMessages().length > 0;
		const baselineMessages =
			session.persistedMessages ?? session.agent.getMessages();
		const usageBaseline =
			this.usageBySession.get(session.sessionId) ??
			createInitialAccumulatedUsage();
		session.turnUsageBaseline = usageBaseline;

		captureModeSwitch(
			session.config.telemetry,
			session.sessionId,
			session.config.mode,
		);
		captureConversationTurnEvent(session.config.telemetry, {
			ulid: session.sessionId,
			provider: session.config.providerId,
			model: session.config.modelId,
			source: "user",
			mode: session.config.mode,
			...this.getSessionAgentTelemetryIdentity(session),
		});

		try {
			const runFn = shouldContinue
				? () => session.agent.continue(prompt, userImages, userFiles)
				: () => session.agent.run(prompt, userImages, userFiles);
			const result = await this.runWithAuthRetry(
				session,
				runFn,
				baselineMessages,
			);

			session.started = true;
			const persistedMessages = withLatestAssistantTurnMetadata(
				result.messages,
				result,
				baselineMessages,
			);
			session.persistedMessages = persistedMessages;
			const accumulatedUsage = accumulateUsageTotals(
				usageBaseline,
				result.usage,
			);
			this.usageBySession.set(session.sessionId, accumulatedUsage);
			await this.persistSessionMetadata(session.sessionId, (current) => ({
				...(current ?? {}),
				totalCost: accumulatedUsage.totalCost,
			}));
			await this.invoke<void>(
				"persistSessionMessages",
				session.sessionId,
				persistedMessages,
				session.config.systemPrompt,
			);
			return result;
		} catch (error) {
			await this.invoke<void>(
				"persistSessionMessages",
				session.sessionId,
				session.agent.getMessages(),
				session.config.systemPrompt,
			);
			throw error;
		} finally {
			session.turnUsageBaseline = undefined;
		}
	}

	private async prepareTurnInput(
		session: ActiveSession,
		input: {
			prompt: string;
			userImages?: string[];
			userFiles?: string[];
		},
	): Promise<PreparedTurnInput> {
		const mentionBaseDir = resolveWorkspacePath(session.config);
		const normalizedPrompt = normalizeUserInput(input.prompt).trim();
		if (!normalizedPrompt) {
			return {
				prompt: "",
				userImages: input.userImages,
				userFiles: this.resolveAbsoluteFilePaths(
					session.config.cwd,
					input.userFiles,
				),
			};
		}

		const enriched = await enrichPromptWithMentions(
			normalizedPrompt,
			mentionBaseDir,
		);
		emitMentionTelemetry(session.config.telemetry, enriched);

		const prompt = formatModePrompt(enriched.prompt, session.config.mode);
		const explicitUserFiles = this.resolveAbsoluteFilePaths(
			session.config.cwd,
			input.userFiles,
		);
		const mentionedFiles = this.resolveAbsoluteFilePaths(
			mentionBaseDir,
			enriched.matchedFiles,
		);
		const mergedUserFiles = Array.from(
			new Set([...explicitUserFiles, ...mentionedFiles]),
		);

		return {
			prompt,
			userImages: input.userImages,
			userFiles: mergedUserFiles.length > 0 ? mergedUserFiles : undefined,
		};
	}

	// ── Session lifecycle ───────────────────────────────────────────────

	private async ensureSessionPersisted(session: ActiveSession): Promise<void> {
		if (session.artifacts) return;
		const workspacePath = resolveWorkspacePath(session.config);
		session.artifacts = (await this.invoke("createRootSessionWithArtifacts", {
			sessionId: session.sessionId,
			source: session.source,
			pid: process.pid,
			interactive: session.interactive,
			provider: session.config.providerId,
			model: session.config.modelId,
			cwd: session.config.cwd,
			workspaceRoot: workspacePath,
			teamName: session.config.teamName,
			enableTools: session.config.enableTools,
			enableSpawn: session.config.enableSpawnAgent,
			enableTeams: session.config.enableAgentTeams,
			prompt: session.pendingPrompt,
			metadata: session.sessionMetadata,
			startedAt: session.startedAt,
		})) as RootSessionArtifacts;
	}

	private async persistSessionMetadata(
		sessionId: string,
		resolveMetadata: (
			current: Record<string, unknown> | undefined,
		) => Record<string, unknown> | undefined,
	): Promise<void> {
		const session = this.sessions.get(sessionId);
		const currentManifest =
			(await this.invokeOptionalValue<SessionManifest>(
				"readSessionManifest",
				sessionId,
			)) ?? session?.artifacts?.manifest;
		const metadata = resolveMetadata(
			currentManifest?.metadata as Record<string, unknown> | undefined,
		);
		if (!session?.artifacts) {
			return;
		}
		const result = await this.invokeOptionalValue<{ updated?: boolean }>(
			"updateSession",
			{
				sessionId,
				metadata,
			},
		);
		if (result?.updated === false) {
			return;
		}
		session.artifacts.manifest.metadata = metadata;
	}

	private async finalizeSingleRun(
		session: ActiveSession,
		finishReason: AgentResult["finishReason"],
	): Promise<void> {
		if (hasPendingTeamRunWork(session)) return;
		const isAborted = finishReason === "aborted" || session.aborting;
		const isError = finishReason === "error";
		await this.shutdownSession(session, {
			status: isAborted ? "cancelled" : isError ? "failed" : "completed",
			exitCode: isError ? 1 : 0,
			shutdownReason: isError ? "session_error" : "session_complete",
			endReason: finishReason,
		});
	}

	private async failSession(session: ActiveSession): Promise<void> {
		await this.shutdownSession(session, {
			status: "failed",
			exitCode: 1,
			shutdownReason: "session_error",
			endReason: "error",
		});
	}

	private async shutdownSession(
		session: ActiveSession,
		input: {
			status: SessionStatus;
			exitCode: number | null;
			shutdownReason: string;
			endReason: string;
		},
	): Promise<void> {
		if (input.status === "completed") {
			captureTaskCompleted(session.config.telemetry, {
				ulid: session.sessionId,
				provider: session.config.providerId,
				modelId: session.config.modelId,
				mode: session.config.mode,
				durationMs: Date.now() - Date.parse(session.startedAt),
				...this.getSessionAgentTelemetryIdentity(session),
			});
		}
		notifyTeamRunWaiters(session);

		const cleanupErrors: unknown[] = [];
		const recordCleanupError = (stage: string, error: unknown) => {
			cleanupErrors.push(error);
			session.config.logger?.log("Session shutdown cleanup failed", {
				sessionId: session.sessionId,
				stage,
				error,
				severity: "warn",
			});
		};

		if (session.artifacts) {
			try {
				await this.updateStatus(session, input.status, input.exitCode);
			} catch (error) {
				recordCleanupError("update_status", error);
			}
			try {
				await session.agent.shutdown(input.shutdownReason);
			} catch (error) {
				recordCleanupError("agent_shutdown", error);
			}
		}
		try {
			await Promise.resolve(session.runtime.shutdown(input.shutdownReason));
		} catch (error) {
			recordCleanupError("runtime_shutdown", error);
		}
		try {
			await session.pluginSandboxShutdown?.();
		} catch (error) {
			recordCleanupError("plugin_sandbox_shutdown", error);
		}
		this.sessions.delete(session.sessionId);
		this.emit({
			type: "ended",
			payload: {
				sessionId: session.sessionId,
				reason: input.endReason,
				ts: Date.now(),
			},
		});
		if (cleanupErrors.length > 0 && input.status === "failed") {
			throw cleanupErrors[0];
		}
	}

	private async updateStatus(
		session: ActiveSession,
		status: SessionStatus,
		exitCode?: number | null,
	): Promise<void> {
		if (!session.artifacts) return;
		const result = await this.invoke<{ updated: boolean; endedAt?: string }>(
			"updateSessionStatus",
			session.sessionId,
			status,
			exitCode,
		);
		if (!result.updated) return;
		const latestManifest =
			(await this.invokeOptionalValue<SessionManifest>(
				"readSessionManifest",
				session.sessionId,
			)) ?? session.artifacts.manifest;
		latestManifest.status = status;
		latestManifest.ended_at = result.endedAt ?? nowIso();
		latestManifest.exit_code = typeof exitCode === "number" ? exitCode : null;
		session.artifacts.manifest = latestManifest;
		session.status = status;
		session.endedAt = latestManifest.ended_at;
		session.exitCode = latestManifest.exit_code;
		await this.invoke<void>(
			"writeSessionManifest",
			session.artifacts.manifestPath,
			latestManifest,
		);
		this.emitStatus(session.sessionId, status);
	}

	private async handlePluginEvent(
		rootSessionId: string,
		event: { name: string; payload?: unknown },
		fallbackAutomation?: NonNullable<
			CoreSessionConfig["extensionContext"]
		>["automation"],
	): Promise<void> {
		if (event.name === "plugin_log") {
			this.handlePluginLog(rootSessionId, event.payload);
			return;
		}
		if (event.name === "automation_event") {
			const session = this.sessions.get(rootSessionId);
			const automation =
				session?.config.extensionContext?.automation ?? fallbackAutomation;
			if (!automation) {
				return;
			}
			const payload =
				event.payload && typeof event.payload === "object"
					? (event.payload as AutomationEventEnvelope)
					: undefined;
			if (!payload) {
				return;
			}
			await automation.ingestEvent(payload);
			return;
		}
		if (
			event.name !== "steer_message" &&
			event.name !== "queue_message" &&
			event.name !== "pending_prompt"
		) {
			return;
		}
		const payload =
			event.payload && typeof event.payload === "object"
				? (event.payload as Record<string, unknown>)
				: undefined;
		const targetSessionId =
			typeof payload?.sessionId === "string" &&
			payload.sessionId.trim().length > 0
				? payload.sessionId.trim()
				: rootSessionId;
		const prompt =
			typeof payload?.prompt === "string" ? payload.prompt.trim() : "";
		if (!prompt) {
			return;
		}
		const delivery =
			event.name === "steer_message"
				? "steer"
				: event.name === "queue_message"
					? "queue"
					: payload?.delivery === "steer"
						? "steer"
						: "queue";
		this.enqueuePendingPrompt(targetSessionId, {
			prompt,
			delivery,
		});
	}

	private handlePluginLog(
		rootSessionId: string,
		payload: unknown,
		fallbackLogger?: BasicLogger,
	): void {
		const session = this.sessions.get(rootSessionId);
		const logger =
			fallbackLogger ??
			session?.config.extensionContext?.logger ??
			session?.config.logger;
		if (!logger || !payload || typeof payload !== "object") {
			return;
		}
		const record = payload as Record<string, unknown>;
		const message = typeof record.message === "string" ? record.message : "";
		if (!message) {
			return;
		}
		const metadata =
			record.metadata && typeof record.metadata === "object"
				? ({
						...(record.metadata as Record<string, unknown>),
					} as BasicLogMetadata)
				: {};
		metadata.sessionId ??= rootSessionId;
		if (typeof record.pluginName === "string" && record.pluginName) {
			metadata.pluginName = record.pluginName;
		}
		if (record.level === "debug") {
			logger.debug(message, metadata);
			return;
		}
		if (record.level === "error") {
			if (logger.error) {
				logger.error(message, metadata);
			} else {
				logger.log(message, { ...metadata, severity: "error" });
			}
			return;
		}
		logger.log(message, metadata);
	}

	/**
	 * Consume the first steer-delivery pending prompt for injection into the
	 * running agent loop. Called synchronously by the agent between iterations.
	 */
	private consumeSteerMessage(sessionId: string): string | undefined {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return undefined;
		}
		const steerIndex = session.pendingPrompts.findIndex(
			(entry) => entry.delivery === "steer",
		);
		if (steerIndex < 0) {
			return undefined;
		}
		const [steer] = session.pendingPrompts.splice(steerIndex, 1);
		this.emitPendingPrompts(session);
		this.emitPendingPromptSubmitted(session, steer);
		return steer.prompt;
	}

	private enqueuePendingPrompt(
		sessionId: string,
		entry: {
			prompt: string;
			delivery: "queue" | "steer";
			userImages?: string[];
			userFiles?: string[];
		},
	): void {
		const session = this.sessions.get(sessionId);
		if (!session || session.aborting) {
			return;
		}
		const { prompt, delivery, userImages, userFiles } = entry;
		const existingIndex = session.pendingPrompts.findIndex(
			(queued) => queued.prompt === prompt,
		);
		if (existingIndex >= 0) {
			const [existing] = session.pendingPrompts.splice(existingIndex, 1);
			if (delivery === "steer" || existing.delivery === "steer") {
				session.pendingPrompts.unshift({
					id: existing.id,
					prompt,
					delivery: "steer",
					userImages: userImages ?? existing.userImages,
					userFiles: userFiles ?? existing.userFiles,
				});
			} else {
				session.pendingPrompts.push({
					...existing,
					userImages: userImages ?? existing.userImages,
					userFiles: userFiles ?? existing.userFiles,
				});
			}
		} else if (delivery === "steer") {
			session.pendingPrompts.unshift({
				id: `pending_${Date.now()}_${nanoid(5)}`,
				prompt,
				delivery,
				userImages,
				userFiles,
			});
		} else {
			session.pendingPrompts.push({
				id: `pending_${Date.now()}_${nanoid(5)}`,
				prompt,
				delivery,
				userImages,
				userFiles,
			});
		}
		this.emitPendingPrompts(session);
		this.schedulePendingPromptDrain(sessionId, session);
	}

	private schedulePendingPromptDrain(
		sessionId: string,
		session: ActiveSession,
	): void {
		if (
			session.pendingPrompts.length === 0 ||
			session.aborting ||
			session.drainingPendingPrompts ||
			!session.agent.canStartRun()
		) {
			return;
		}
		queueMicrotask(() => {
			void this.drainPendingPrompts(sessionId);
		});
	}

	private async drainPendingPrompts(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session || session.aborting || session.drainingPendingPrompts) {
			return;
		}
		const canStartRun = session.agent.canStartRun();
		if (!canStartRun) {
			return;
		}
		const next = session.pendingPrompts.shift();
		if (!next) {
			return;
		}
		this.emitPendingPrompts(session);
		this.emitPendingPromptSubmitted(session, next);
		session.drainingPendingPrompts = true;
		try {
			await this.send({
				sessionId,
				prompt: next.prompt,
				userImages: next.userImages,
				userFiles: next.userFiles,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message.includes("already in progress")) {
				session.pendingPrompts.unshift(next);
				this.emitPendingPrompts(session);
			} else {
				throw error;
			}
		} finally {
			session.drainingPendingPrompts = false;
			if (session.pendingPrompts.length > 0) {
				queueMicrotask(() => {
					void this.drainPendingPrompts(sessionId);
				});
			}
		}
	}

	// ── Agent event handling ────────────────────────────────────────────

	private onAgentEvent(
		sessionId: string,
		config: CoreSessionConfig,
		event: AgentEvent,
	): void {
		const liveSession = this.sessions.get(sessionId);
		const ctx: AgentEventContext = {
			sessionId,
			config,
			liveSession,
			usageBySession: this.usageBySession,
			persistMessages: (sid, messages, systemPrompt) => {
				void this.invoke<void>(
					"persistSessionMessages",
					sid,
					messages,
					systemPrompt,
				);
			},
			emit: (e) => this.emit(e),
		};
		const eventMetadata = extractAgentEventMetadata(event);
		const isRootAgentEvent =
			liveSession &&
			eventMetadata.agentId === this.readAgentId(liveSession.agent);
		handleAgentEvent(
			ctx,
			event,
			isRootAgentEvent
				? {
						isPrimaryAgentEvent: true,
						...(liveSession?.runtime.teamRuntime
							? { teamRole: "lead" as const }
							: {}),
					}
				: { isPrimaryAgentEvent: false },
		);
	}

	private emitPendingPrompts(session: ActiveSession): void {
		this.emit({
			type: "pending_prompts",
			payload: {
				sessionId: session.sessionId,
				prompts: this.snapshotPendingPrompts(session),
			},
		});
	}

	private snapshotPendingPrompt(entry: PendingPrompt): SessionPendingPrompt {
		return {
			id: entry.id,
			prompt: entry.prompt,
			delivery: entry.delivery,
			attachmentCount:
				(entry.userImages?.length ?? 0) + (entry.userFiles?.length ?? 0),
		};
	}

	private snapshotPendingPrompts(
		session: ActiveSession,
	): SessionPendingPrompt[] {
		return session.pendingPrompts.map((entry) =>
			this.snapshotPendingPrompt(entry),
		);
	}

	private emitPendingPromptSubmitted(
		session: ActiveSession,
		entry: {
			id: string;
			prompt: string;
			delivery: "queue" | "steer";
			userImages?: string[];
			userFiles?: string[];
		},
	): void {
		this.emit({
			type: "pending_prompt_submitted",
			payload: {
				sessionId: session.sessionId,
				id: entry.id,
				prompt: entry.prompt,
				delivery: entry.delivery,
				attachmentCount:
					(entry.userImages?.length ?? 0) + (entry.userFiles?.length ?? 0),
			},
		});
	}

	// ── Spawn / sub-agents ──────────────────────────────────────────────

	private createSpawnTool(
		config: CoreSessionConfig,
		rootSessionId: string,
		toolExecutors?: Partial<ToolExecutors>,
	): Tool {
		const createSubAgentTools = () => {
			const tools: Tool[] = config.enableTools
				? createBuiltinTools({
						cwd: config.cwd,
						...ToolPresets[
							resolveToolPresetName({
								mode: config.mode,
							})
						],
						executors: toolExecutors,
					})
				: [];
			if (config.enableSpawnAgent) {
				tools.push(this.createSpawnTool(config, rootSessionId, toolExecutors));
			}
			return filterDisabledTools(tools);
		};

		return createSpawnAgentTool({
			configProvider: {
				getRuntimeConfig: () =>
					this.sessions
						.get(rootSessionId)
						?.runtime.delegatedAgentConfigProvider?.getRuntimeConfig() ?? {
						providerId: config.providerId,
						modelId: config.modelId,
						cwd: config.cwd,
						apiKey: config.apiKey,
						baseUrl: config.baseUrl,
						headers: config.headers,
						providerConfig: config.providerConfig,
						knownModels: config.knownModels,
						thinking: config.thinking,
						maxIterations: config.maxIterations,
						hooks: config.hooks,
						extensions: config.extensions,
						logger: config.logger,
						telemetry: config.telemetry,
					},
				getConnectionConfig: () =>
					this.sessions
						.get(rootSessionId)
						?.runtime.delegatedAgentConfigProvider?.getConnectionConfig() ?? {
						providerId: config.providerId,
						modelId: config.modelId,
						apiKey: config.apiKey,
						baseUrl: config.baseUrl,
						headers: config.headers,
						providerConfig: config.providerConfig,
						knownModels: config.knownModels,
						thinking: config.thinking,
					},
				updateConnectionDefaults: () => {},
			},
			createSubAgentTools,
			onSubAgentEvent: (event) =>
				this.onAgentEvent(rootSessionId, config, event),
			onSubAgentStart: (context) => {
				const teamRuntime =
					this.sessions.get(rootSessionId)?.runtime.teamRuntime;
				this.subAgentStarts.set(context.subAgentId, {
					startedAt: Date.now(),
					rootSessionId,
				});
				const agentIdentity = buildTelemetryAgentIdentity({
					agentId: context.subAgentId,
					conversationId: context.conversationId,
					parentAgentId: context.parentAgentId,
					teamId: teamRuntime?.getTeamId(),
					teamName: teamRuntime?.getTeamName(),
					createdByAgentId: context.parentAgentId,
				});
				if (agentIdentity) {
					captureAgentCreated(config.telemetry, {
						ulid: rootSessionId,
						modelId: config.modelId,
						provider: config.providerId,
						...agentIdentity,
					});
				}
				captureSubagentExecution(config.telemetry, {
					event: "started",
					ulid: rootSessionId,
					durationMs: 0,
					parentId: context.parentAgentId,
					agentId: context.subAgentId,
					...agentIdentity,
				});
				void this.invokeOptional("handleSubAgentStart", rootSessionId, context);
			},
			onSubAgentEnd: (context) => {
				const teamRuntime =
					this.sessions.get(rootSessionId)?.runtime.teamRuntime;
				const started = this.subAgentStarts.get(context.subAgentId);
				const durationMs = started ? Date.now() - started.startedAt : 0;
				const outputLines = context.result?.text
					? context.result.text.split("\n").length
					: 0;
				captureSubagentExecution(config.telemetry, {
					event: "ended",
					ulid: rootSessionId,
					durationMs,
					outputLines,
					errorMessage: context.error ? String(context.error) : undefined,
					agentId: context.subAgentId,
					parentId: context.parentAgentId,
					...buildTelemetryAgentIdentity({
						agentId: context.subAgentId,
						conversationId: context.conversationId,
						parentAgentId: context.parentAgentId,
						teamId: teamRuntime?.getTeamId(),
						teamName: teamRuntime?.getTeamName(),
						createdByAgentId: context.parentAgentId,
					}),
				});
				this.subAgentStarts.delete(context.subAgentId);
				void this.invokeOptional("handleSubAgentEnd", rootSessionId, context);
			},
		}) as Tool;
	}

	// ── Team run coordination ───────────────────────────────────────────

	private async handleTeamEvent(
		rootSessionId: string,
		event: TeamEvent,
	): Promise<void> {
		const session = this.sessions.get(rootSessionId);
		if (session) {
			trackTeamRunState(session, event);
			if (event.type === "agent_event") {
				const ctx: AgentEventContext = {
					sessionId: rootSessionId,
					config: session.config,
					liveSession: session,
					usageBySession: this.usageBySession,
					persistMessages: (sid, messages, systemPrompt) => {
						void this.invoke<void>(
							"persistSessionMessages",
							sid,
							messages,
							systemPrompt,
						);
					},
					emit: (e) => this.emit(e),
				};
				handleAgentEvent(ctx, event.event, {
					teamRole: "teammate",
					teamAgentId: event.agentId,
					isPrimaryAgentEvent: false,
				});
			}
			if (event.type === "teammate_spawned") {
				const agentIdentity = buildTelemetryAgentIdentity({
					agentId: event.teammate.runtimeAgentId ?? event.agentId,
					conversationId: event.teammate.conversationId,
					parentAgentId: event.teammate.parentAgentId,
					createdByAgentId: this.readAgentId(session.agent),
					teamId: session.runtime.teamRuntime?.getTeamId(),
					teamName: session.runtime.teamRuntime?.getTeamName(),
					teamRole: "teammate",
					teamAgentId: event.agentId,
				});
				if (agentIdentity) {
					captureAgentCreated(session.config.telemetry, {
						ulid: rootSessionId,
						modelId: event.teammate.modelId ?? session.config.modelId,
						provider: session.config.providerId,
						...agentIdentity,
					});
				}
			}
		}

		await dispatchTeamEventToBackend(
			rootSessionId,
			event,
			this.invokeOptional.bind(this),
		);

		if (session) {
			emitTeamProgress(session, rootSessionId, event, (e) => this.emit(e));
		}
	}

	// ── OAuth & auth ────────────────────────────────────────────────────

	private async runWithAuthRetry(
		session: ActiveSession,
		run: () => Promise<AgentResult>,
		baselineMessages: LlmsProviders.Message[],
	): Promise<AgentResult> {
		try {
			return await run();
		} catch (error) {
			if (!isLikelyAuthError(error, session.config.providerId)) {
				throw error;
			}
			await this.syncOAuthCredentials(session, { forceRefresh: true });
			session.agent.restore(baselineMessages);
			return run();
		}
	}

	private async syncOAuthCredentials(
		session: ActiveSession,
		options?: { forceRefresh?: boolean },
	): Promise<void> {
		let resolved: RuntimeOAuthResolution | null = null;
		try {
			resolved = await this.oauthTokenManager.resolveProviderApiKey({
				providerId: session.config.providerId,
				forceRefresh: options?.forceRefresh,
			});
		} catch (error) {
			if (error instanceof OAuthReauthRequiredError) {
				throw new Error(`${error.providerId} requires re-authentication.`);
			}
			throw error;
		}
		if (!resolved?.apiKey || session.config.apiKey === resolved.apiKey) return;
		session.config.apiKey = resolved.apiKey;
		this.updateAgentConnection(session, { apiKey: resolved.apiKey });
		session.runtime.delegatedAgentConfigProvider?.updateConnectionDefaults({
			apiKey: resolved.apiKey,
		});
		session.runtime.teamRuntime?.updateTeammateConnections({
			apiKey: resolved.apiKey,
		});
	}

	// ── Utility methods ─────────────────────────────────────────────────

	private getSessionOrThrow(sessionId: string): ActiveSession {
		const session = this.sessions.get(sessionId);
		if (!session) throw new Error(`session not found: ${sessionId}`);
		return session;
	}

	private resolveAbsoluteFilePaths(cwd: string, paths?: string[]): string[] {
		if (!paths || paths.length === 0) return [];
		const resolved = paths
			.map((p) => p.trim())
			.filter((p) => p.length > 0)
			.map((p) => (isAbsolute(p) ? p : resolve(cwd, p)));
		return Array.from(new Set(resolved));
	}

	private updateAgentConnection(
		session: ActiveSession,
		overrides: { apiKey?: string; modelId?: string },
	): void {
		session.agent.updateConnection(overrides);
	}

	private getSessionAgentTelemetryIdentity(session: ActiveSession) {
		return buildTelemetryAgentIdentity({
			agentId: this.readAgentId(session.agent),
			conversationId: this.readAgentConversationId(session.agent),
			teamId: session.runtime.teamRuntime?.getTeamId(),
			teamName: session.runtime.teamRuntime?.getTeamName(),
			teamRole: session.runtime.teamRuntime ? "lead" : undefined,
		});
	}

	private readAgentId(agent: SessionRuntime): string {
		return agent.getAgentId();
	}

	private readAgentConversationId(agent: SessionRuntime): string {
		return agent.getConversationId();
	}

	private emitStatus(sessionId: string, status: string): void {
		this.emit({
			type: "status",
			payload: { sessionId, status },
		});
	}

	private emit(event: CoreSessionEvent): void {
		this.events.emit(event);
	}

	private async listRows(limit: number): Promise<SessionRow[]> {
		return this.invoke<SessionRow[]>(
			"listSessions",
			Math.min(Math.max(1, Math.floor(limit)), MAX_SCAN_LIMIT),
		);
	}

	private async getRow(sessionId: string): Promise<SessionRow | undefined> {
		const target = sessionId.trim();
		if (!target) return undefined;
		const rows = await this.listRows(MAX_SCAN_LIMIT);
		return rows.find((row) => row.sessionId === target);
	}

	// ── Session service invocation ──────────────────────────────────────

	private async invoke<T>(method: string, ...args: unknown[]): Promise<T> {
		const callable = (
			this.sessionService as unknown as Record<string, unknown>
		)[method];
		if (typeof callable !== "function") {
			throw new Error(`session service method not available: ${method}`);
		}
		return Promise.resolve(
			(callable as (...params: unknown[]) => T | Promise<T>).apply(
				this.sessionService,
				args,
			),
		);
	}

	private async invokeOptional(
		method: string,
		...args: unknown[]
	): Promise<void> {
		const callable = (
			this.sessionService as unknown as Record<string, unknown>
		)[method];
		if (typeof callable !== "function") return;
		await Promise.resolve(
			(callable as (...params: unknown[]) => unknown).apply(
				this.sessionService,
				args,
			),
		);
	}

	private async invokeOptionalValue<T = unknown>(
		method: string,
		...args: unknown[]
	): Promise<T | undefined> {
		const callable = (
			this.sessionService as unknown as Record<string, unknown>
		)[method];
		if (typeof callable !== "function") return undefined;
		return await Promise.resolve(
			(callable as (...params: unknown[]) => T | Promise<T>).apply(
				this.sessionService,
				args,
			),
		);
	}
}
