import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type * as LlmsProviders from "@clinebot/llms";
import {
	type AgentConfig,
	type AgentEvent,
	type AgentResult,
	createSessionId,
	type ITelemetryService,
	isLikelyAuthError,
	normalizeUserInput,
} from "@clinebot/shared";
import { setHomeDirIfUnset } from "@clinebot/shared/storage";
import { createContextCompactionPrepareTurn } from "../../extensions/context/compaction";
import type { ToolExecutors } from "../../extensions/tools";
import { DefaultToolNames } from "../../extensions/tools";
import type { TeamEvent } from "../../extensions/tools/team";
import type { HookEventPayload } from "../../hooks";
import { buildTelemetryAgentIdentity } from "../../services/agent-events";
import { resolveWorkspacePath } from "../../services/config";
import { prepareLocalRuntimeBootstrap } from "../../services/local-runtime-bootstrap";
import { nowIso } from "../../services/session-artifacts";
import {
	toSessionRecord,
	withLatestAssistantTurnMetadata,
} from "../../services/session-data";
import {
	emitMentionTelemetry,
	emitSessionCreationTelemetry,
} from "../../services/session-telemetry";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";
import {
	captureAgentCreated,
	captureAgentTeamCreated,
	captureConversationTurnEvent,
	captureModeSwitch,
	captureTaskCompleted,
} from "../../services/telemetry/core-events";
import { resolveCoreDistinctId } from "../../services/telemetry/distinct-id";
import {
	accumulateUsageTotals,
	createInitialAccumulatedUsage,
	summarizeUsageFromMessages,
} from "../../services/usage";
import { enrichPromptWithMentions } from "../../services/workspace";
import {
	type SessionManifest,
	SessionManifestSchema,
} from "../../session/models/session-manifest";
import type { SessionRow } from "../../session/models/session-row";
import type { RootSessionArtifacts } from "../../session/services/session-service";
import { createCoreSessionSnapshot } from "../../session/session-snapshot";
import { SessionVersioningService } from "../../session/session-versioning-service";
import {
	buildTeamRunContinuationPrompt,
	formatModePrompt,
	hasPendingTeamRunWork,
	notifyTeamRunWaiters,
	shouldAutoContinueTeamRuns,
	waitForTeamRunUpdates,
} from "../../session/team";
import { SessionSource, type SessionStatus } from "../../types/common";
import type { CoreSessionConfig } from "../../types/config";
import type { CoreSessionEvent } from "../../types/events";
import type { ActiveSession, PreparedTurnInput } from "../../types/session";
import type { SessionRecord } from "../../types/sessions";
import type { RuntimeCapabilities } from "../capabilities";
import { normalizeRuntimeCapabilities } from "../capabilities";
import { DefaultRuntimeBuilder } from "../orchestration/runtime-builder";
import {
	OAuthReauthRequiredError,
	type RuntimeOAuthResolution,
	RuntimeOAuthTokenManager,
} from "../orchestration/runtime-oauth-token-manager";
import type { RuntimeBuilder } from "../orchestration/session-runtime";
import { SessionRuntime } from "../orchestration/session-runtime-orchestrator";
import { PendingPromptsController } from "../turn-queue/pending-prompt-service";
import { manifestToSessionRecord } from "./history";
import { AgentEventBridge } from "./local/agent-event-bridge";
import {
	type SessionBackend,
	toActiveSessionRecord,
} from "./local/session-record";
import {
	invokeBackend,
	invokeBackendOptional,
	invokeBackendOptionalValue,
} from "./local/session-service-invoker";
import {
	createSessionSpawnTool,
	type SubAgentStartTracker,
} from "./local/spawn-tool";
import { loadUserFileContent } from "./local/user-files";
import type {
	PendingPromptsServiceApi,
	RestoreSessionInput,
	RestoreSessionResult,
	RuntimeHost,
	RuntimeHostSubscribeOptions,
	SendSessionInput,
	SessionAccumulatedUsage,
	StartSessionInput,
	StartSessionResult,
} from "./runtime-host";
import {
	cloneAccumulatedUsage,
	RuntimeHostEventBus,
	readPersistedMessagesFile,
	replaySubagentHookEvent,
} from "./runtime-host-support";

const MAX_SCAN_LIMIT = 5000;

export interface LocalRuntimeHostOptions {
	distinctId?: string;
	sessionService: SessionBackend;
	runtimeBuilder?: RuntimeBuilder;
	createAgent?: (config: AgentConfig) => SessionRuntime;
	capabilities?: RuntimeCapabilities;
	toolPolicies?: AgentConfig["toolPolicies"];
	providerSettingsManager?: ProviderSettingsManager;
	oauthTokenManager?: RuntimeOAuthTokenManager;
	telemetry?: ITelemetryService;
	/**
	 * Default custom `fetch` implementation threaded into every
	 * `ProviderConfig.fetch` built during local session bootstrap. Used by
	 * the AI gateway providers when issuing HTTP requests.
	 */
	fetch?: typeof fetch;
}

export class LocalRuntimeHost implements RuntimeHost {
	public readonly runtimeAddress = undefined;
	public readonly pendingPrompts: PendingPromptsServiceApi;
	private readonly sessionService: SessionBackend;
	private readonly runtimeBuilder: RuntimeBuilder;
	private readonly createAgentInstance: (config: AgentConfig) => SessionRuntime;
	private readonly toolExecutors?: Partial<ToolExecutors>;
	private readonly defaultCapabilities?: RuntimeCapabilities;
	private readonly defaultToolPolicies?: AgentConfig["toolPolicies"];
	private readonly providerSettingsManager: ProviderSettingsManager;
	private readonly oauthTokenManager: RuntimeOAuthTokenManager;
	private readonly defaultTelemetry?: ITelemetryService;
	private readonly defaultFetch?: typeof fetch;
	private readonly events = new RuntimeHostEventBus();
	private readonly sessions = new Map<string, ActiveSession>();
	private readonly usageBySession = new Map<string, SessionAccumulatedUsage>();
	private readonly subAgentStarts: SubAgentStartTracker = new Map();
	private readonly pendingPromptsController: PendingPromptsController;
	private readonly eventBridge: AgentEventBridge;
	private readonly sessionVersioning = new SessionVersioningService();

	constructor(options: LocalRuntimeHostOptions) {
		const homeDir = homedir();
		if (homeDir) setHomeDirIfUnset(homeDir);
		const distinctId = resolveCoreDistinctId(options.distinctId);
		this.sessionService = options.sessionService;
		this.runtimeBuilder = options.runtimeBuilder ?? new DefaultRuntimeBuilder();
		this.createAgentInstance =
			options.createAgent ?? ((config) => new SessionRuntime(config));
		this.defaultCapabilities = normalizeRuntimeCapabilities(
			options.capabilities,
		);
		this.toolExecutors = this.defaultCapabilities?.toolExecutors;
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

		this.pendingPromptsController = new PendingPromptsController({
			getSession: (sid) => this.sessions.get(sid),
			emit: (event) => this.emit(event),
			send: (input) => this.runTurn(input),
		});
		this.pendingPrompts = {
			list: async (input) =>
				this.pendingPromptsController.list(input.sessionId),
			update: async (input) => this.pendingPromptsController.update(input),
			delete: async (input) => this.pendingPromptsController.delete(input),
		};
		this.eventBridge = new AgentEventBridge({
			getSession: (sid) => this.sessions.get(sid),
			usageBySession: this.usageBySession,
			emit: (event) => this.emit(event),
			persistMessages: (sid, messages, systemPrompt) => {
				void this.invoke<void>(
					"persistSessionMessages",
					sid,
					messages,
					systemPrompt,
				);
			},
			enqueuePendingPrompt: (sid, entry) =>
				this.pendingPromptsController.enqueue(sid, entry),
			invokeBackendOptional: (method, ...args) =>
				this.invokeOptional(method, ...args),
		});
	}

	// ── Public API ──────────────────────────────────────────────────────

	async startSession(input: StartSessionInput): Promise<StartSessionResult> {
		const source = input.source ?? SessionSource.CLI;
		const startedAt = nowIso();
		const requestedSessionId = input.config.sessionId?.trim() ?? "";
		const sessionId = requestedSessionId || createSessionId();
		const startInput: StartSessionInput = input;
		const initialMessages = startInput.initialMessages ?? [];
		this.usageBySession.set(
			sessionId,
			initialMessages.length > 0
				? summarizeUsageFromMessages(initialMessages)
				: createInitialAccumulatedUsage(),
		);

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

		let manifest = SessionManifestSchema.parse({
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
		let resumedArtifacts: RootSessionArtifacts | undefined;
		const isReadOnlyResumeStart =
			requestedSessionId.length > 0 &&
			initialMessages.length > 0 &&
			!startInput.prompt?.trim();
		if (isReadOnlyResumeStart) {
			const existingManifest = await this.invokeOptionalValue<SessionManifest>(
				"readSessionManifest",
				sessionId,
			);
			if (existingManifest) {
				manifest = existingManifest;
				resumedArtifacts = {
					manifestPath,
					messagesPath: existingManifest.messages_path || messagesPath,
					manifest: existingManifest,
				};
			}
		}

		const capabilities = normalizeRuntimeCapabilities(
			this.defaultCapabilities,
			input.capabilities,
		);
		const sessionToolExecutors =
			capabilities?.toolExecutors ?? this.toolExecutors;
		const inputLocalConfig = input.localRuntime as
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
			defaultCapabilities: capabilities,
			defaultToolPolicies: this.defaultToolPolicies,
			defaultFetch: this.defaultFetch,
			onPluginEvent: (event) => {
				if (event.name === "plugin_log") {
					this.eventBridge.handlePluginLog(
						sessionId,
						event.payload,
						pluginEventFallbackLogger,
					);
					return;
				}
				void this.eventBridge.handlePluginEvent(
					sessionId,
					event,
					pluginEventFallbackAutomation,
				);
			},
			onTeamEvent: (event: TeamEvent) => {
				void this.eventBridge.handleTeamEvent(sessionId, event);
				bootstrap.config.onTeamEvent?.(event);
			},
			createSpawnTool: () =>
				createSessionSpawnTool(
					{
						getSession: (sid) => this.sessions.get(sid),
						subAgentStarts: this.subAgentStarts,
						onAgentEvent: (rootSessionId, config, event) =>
							this.eventBridge.dispatchAgentEvent(rootSessionId, config, event),
						invokeBackendOptional: (method, ...args) =>
							this.invokeOptional(method, ...args),
					},
					bootstrap.config,
					sessionId,
					sessionToolExecutors,
				),
			readSessionMetadata: async () =>
				(await this.getSession(sessionId))?.metadata as
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
		const extensions = runtime.extensions ?? bootstrap.extensions;

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
			extensions,
			hookErrorMode: configWithProvider.hookErrorMode,
			initialMessages: bootstrap.effectiveInput.initialMessages,
			userFileContentLoader: loadUserFileContent,
			toolPolicies: bootstrap.toolPolicies,
			requestToolApproval: bootstrap.requestToolApproval,
			onConsecutiveMistakeLimitReached:
				configWithProvider.onConsecutiveMistakeLimitReached,
			completionPolicy: runtime.completionPolicy,
			consumePendingUserMessage: () =>
				this.pendingPromptsController.consumeSteer(sessionId),
			logger: runtime.logger ?? configWithProvider.logger,
			extensionContext: configWithProvider.extensionContext,
			onEvent: (event: AgentEvent) =>
				this.eventBridge.dispatchAgentEvent(
					sessionId,
					configWithProvider,
					event,
				),
		} as AgentConfig;
		agentConfig.hooks = {
			...agentConfig.hooks,
			onEvent: async (event) => {
				await bootstrap.hooks?.onEvent?.(event);
				if (event.type !== "assistant-message") return;
				const liveSession = this.sessions.get(sessionId);
				if (!liveSession) return;
				const messages = liveSession.agent.getMessages();
				try {
					await this.invoke<void>(
						"persistSessionMessages",
						sessionId,
						messages,
						configWithProvider.systemPrompt,
					);
				} catch (error) {
					configWithProvider.logger?.error?.(
						"Failed to persist session messages after assistant response",
						{ sessionId, error },
					);
				}
			},
		};
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
			...(resumedArtifacts ? { artifacts: resumedArtifacts } : {}),
			source,
			startedAt: resumedArtifacts?.manifest.started_at ?? startedAt,
			updatedAt:
				resumedArtifacts?.manifest.ended_at ??
				resumedArtifacts?.manifest.started_at ??
				startedAt,
			pendingPrompt: manifest.prompt,
			runtime,
			agent,
			started: false,
			status: resumedArtifacts?.manifest.status ?? "running",
			aborting: false,
			interactive: input.interactive === true,
			persistedMessages: initialMessages,
			activeTeamRunIds: new Set<string>(),
			pendingTeamRunUpdates: [],
			teamRunWaiters: [],
			pendingPrompts: [],
			drainingPendingPrompts: false,
			pluginSandboxShutdown: bootstrap.pluginSandboxShutdown,
			submitAndExitObserved: false,
		};
		this.sessions.set(sessionId, active);
		this.emitStatus(sessionId, "running");
		if (initialMessages.length > 0 && !resumedArtifacts) {
			await this.ensureSessionPersisted(active);
			await this.invoke<void>(
				"persistSessionMessages",
				active.sessionId,
				initialMessages,
				active.config.systemPrompt,
			);
			if (!startInput.prompt?.trim()) {
				await this.updateStatus(active, "completed", 0);
			}
		}

		let result: AgentResult | undefined;
		try {
			if (startInput.prompt?.trim()) {
				result = await this.executeTurn(active, {
					prompt: startInput.prompt,
					userImages: startInput.userImages,
					userFiles: startInput.userFiles,
				});
				if (!active.interactive) {
					await this.finalizeSingleRun(active, result.finishReason);
				} else {
					await this.completeInteractiveTurn(active, result.finishReason);
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

	async restoreSession(
		input: RestoreSessionInput,
	): Promise<RestoreSessionResult> {
		return this.sessionVersioning.restoreCheckpoint({
			...input,
			getSession: (sessionId) => this.getSession(sessionId),
			readMessages: (sessionId) => this.readSessionMessages(sessionId),
			buildStartInput: (context, startInput) => {
				const sessionMetadata = context.restoredCheckpointMetadata
					? {
							...(startInput.sessionMetadata ?? {}),
							checkpoint: context.restoredCheckpointMetadata,
						}
					: startInput.sessionMetadata;
				return {
					...startInput,
					...(sessionMetadata ? { sessionMetadata } : {}),
					initialMessages: context.initialMessages,
				};
			},
			startSession: (startInput) => this.startSession(startInput),
			getStartedSessionId: (startResult) => startResult.sessionId,
			readRestoredSession: (sessionId) => this.getSession(sessionId),
		});
	}

	async runTurn(input: SendSessionInput): Promise<AgentResult | undefined> {
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
			this.pendingPromptsController.enqueue(input.sessionId, {
				prompt: input.prompt,
				delivery,
				userImages: input.userImages,
				userFiles: input.userFiles,
			});
			return undefined;
		}
		try {
			const result = await this.executeTurn(session, {
				prompt: input.prompt,
				userImages: input.userImages,
				userFiles: input.userFiles,
			});
			if (!session.interactive) {
				await this.finalizeSingleRun(session, result.finishReason);
			} else {
				await this.completeInteractiveTurn(session, result.finishReason);
			}
			queueMicrotask(() => {
				void this.pendingPromptsController.drain(input.sessionId);
			});
			return result;
		} catch (error) {
			await this.failSession(session);
			throw error;
		}
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
		this.pendingPromptsController.clearAborted(session);
		session.agent.abort(reason);
	}

	async stopSession(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		session.config.telemetry?.capture({
			event: "session.stopped",
			properties: { sessionId },
		});
		if (session.interactive && session.status !== "running") {
			await this.releaseSessionRuntime(session, "session_stop");
			return;
		}
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
				session.interactive && session.status !== "running"
					? this.releaseSessionRuntime(session, reason)
					: this.shutdownSession(session, {
							status: "cancelled",
							exitCode: 0,
							shutdownReason: reason,
							endReason: "disposed",
						}),
			),
		);
		this.usageBySession.clear();
	}

	async getSession(sessionId: string): Promise<SessionRecord | undefined> {
		const active = this.sessions.get(sessionId);
		if (active) {
			return toActiveSessionRecord(active);
		}
		const target = sessionId.trim();
		if (!target) return undefined;
		const row = await this.getRow(target);
		if (row) return toSessionRecord(row);
		const manifest = await this.readManifest(target);
		return manifest ? manifestToSessionRecord(manifest) : undefined;
	}

	async listSessions(limit = 200): Promise<SessionRecord[]> {
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

	async deleteSession(sessionId: string): Promise<boolean> {
		if (this.sessions.has(sessionId)) {
			await this.stopSession(sessionId);
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

	async updateSession(
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

	async readSessionMessages(
		sessionId: string,
	): Promise<LlmsProviders.Message[]> {
		const target = sessionId.trim();
		if (!target) return [];
		const row = await this.getRow(target);
		if (row?.messagesPath) {
			return readPersistedMessagesFile(row.messagesPath);
		}
		const manifest = await this.readManifest(target);
		return readPersistedMessagesFile(manifest?.messages_path);
	}

	async dispatchHookEvent(payload: HookEventPayload): Promise<void> {
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
		session.agent.updateConnection({ modelId });
	}

	// Retained for unit tests that reach in via Reflect.
	handlePluginEvent(
		rootSessionId: string,
		event: { name: string; payload?: unknown },
		fallbackAutomation?: NonNullable<
			CoreSessionConfig["extensionContext"]
		>["automation"],
	): Promise<void> {
		return this.eventBridge.handlePluginEvent(
			rootSessionId,
			event,
			fallbackAutomation,
		);
	}

	// ── Turn execution ──────────────────────────────────────────────────

	private async executeTurn(
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
		await this.markTurnRunning(session);

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

	private async completeInteractiveTurn(
		session: ActiveSession,
		finishReason: AgentResult["finishReason"],
	): Promise<void> {
		if (hasPendingTeamRunWork(session)) return;
		const isAborted = finishReason === "aborted" || session.aborting;
		const isError = finishReason === "error";
		await this.updateStatus(
			session,
			isAborted ? "cancelled" : isError ? "failed" : "completed",
			isError ? 1 : 0,
		);
		this.emit({
			type: "ended",
			payload: {
				sessionId: session.sessionId,
				reason: finishReason,
				ts: Date.now(),
			},
		});
		session.aborting = false;
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
			this.observeTaskCompletionTool(session, result);
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

	/**
	 * Anchor `task.completed` telemetry to the assistant's explicit
	 * completion declaration. We emit at most once per session, the moment
	 * a successful `submit_and_exit` tool call is observed in the run
	 * result. This is the SDK analog of original Cline's
	 * `attempt_completion`-driven emission and works for both interactive
	 * and non-interactive sessions.
	 *
	 * `shutdownSession(...)` retains a fallback emission for completed
	 * sessions that finish without an explicit completion-tool observation
	 * (e.g., non-interactive runs not using the yolo preset). This helper
	 * sets `submitAndExitObserved` so the shutdown fallback can suppress a
	 * duplicate emission for the same logical completion.
	 */
	private observeTaskCompletionTool(
		session: ActiveSession,
		result: AgentResult,
	): void {
		if (session.submitAndExitObserved) return;
		const completedWithSubmitAndExit = result.toolCalls.some(
			(call) =>
				call.name === DefaultToolNames.SUBMIT_AND_EXIT &&
				call.error === undefined,
		);
		if (!completedWithSubmitAndExit) return;
		session.submitAndExitObserved = true;
		captureTaskCompleted(session.config.telemetry, {
			ulid: session.sessionId,
			provider: session.config.providerId,
			modelId: session.config.modelId,
			mode: session.config.mode,
			durationMs: Date.now() - Date.parse(session.startedAt),
			source: "submit_and_exit",
			...this.getSessionAgentTelemetryIdentity(session),
		});
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

	private async markTurnRunning(session: ActiveSession): Promise<void> {
		if (session.status === "running") return;
		await this.updateStatus(session, "running", null);
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
		session.sessionMetadata = metadata;
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
		// Fallback `task.completed` emission for completed sessions that
		// did not observe an explicit `submit_and_exit` tool call. The
		// observer in `executeAgentTurn(...)` already emitted the event in
		// that case, so we suppress here to avoid double-counting.
		if (input.status === "completed" && !session.submitAndExitObserved) {
			captureTaskCompleted(session.config.telemetry, {
				ulid: session.sessionId,
				provider: session.config.providerId,
				modelId: session.config.modelId,
				mode: session.config.mode,
				durationMs: Date.now() - Date.parse(session.startedAt),
				source: "shutdown",
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

	private async releaseSessionRuntime(
		session: ActiveSession,
		reason: string,
	): Promise<void> {
		const cleanupErrors: unknown[] = [];
		const recordCleanupError = (stage: string, error: unknown) => {
			cleanupErrors.push(error);
			session.config.logger?.log("Session runtime cleanup failed", {
				sessionId: session.sessionId,
				stage,
				error,
				severity: "warn",
			});
		};

		try {
			await session.agent.shutdown(reason);
		} catch (error) {
			recordCleanupError("agent_shutdown", error);
		}
		try {
			await Promise.resolve(session.runtime.shutdown(reason));
		} catch (error) {
			recordCleanupError("runtime_shutdown", error);
		}
		try {
			await session.pluginSandboxShutdown?.();
		} catch (error) {
			recordCleanupError("plugin_sandbox_shutdown", error);
		}
		this.sessions.delete(session.sessionId);
		if (cleanupErrors.length > 0) {
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
		if (status === "running") {
			delete latestManifest.ended_at;
			latestManifest.exit_code = null;
		} else {
			latestManifest.ended_at = result.endedAt ?? nowIso();
			latestManifest.exit_code = typeof exitCode === "number" ? exitCode : null;
		}
		session.artifacts.manifest = latestManifest;
		session.status = status;
		session.updatedAt = result.endedAt ?? nowIso();
		session.endedAt = status === "running" ? null : latestManifest.ended_at;
		session.exitCode = latestManifest.exit_code;
		await this.invoke<void>(
			"writeSessionManifest",
			session.artifacts.manifestPath,
			latestManifest,
		);
		this.emitStatus(session.sessionId, status);
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
		session.agent.updateConnection({ apiKey: resolved.apiKey });
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

	private getSessionAgentTelemetryIdentity(session: ActiveSession) {
		return buildTelemetryAgentIdentity({
			agentId: session.agent.getAgentId(),
			conversationId: session.agent.getConversationId(),
			teamId: session.runtime.teamRuntime?.getTeamId(),
			teamName: session.runtime.teamRuntime?.getTeamName(),
			teamRole: session.runtime.teamRuntime ? "lead" : undefined,
		});
	}

	private emitStatus(sessionId: string, status: string): void {
		void this.emitSessionSnapshot(sessionId);
		this.emit({
			type: "status",
			payload: { sessionId, status },
		});
	}

	private async emitSessionSnapshot(sessionId: string): Promise<void> {
		const session = await this.getSession(sessionId);
		if (!session) return;
		this.emit({
			type: "session_snapshot",
			payload: {
				sessionId,
				snapshot: createCoreSessionSnapshot({
					session,
					messages: await this.readSessionMessages(sessionId),
					usage: this.usageBySession.get(sessionId),
				}),
			},
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

	private async readManifest(
		sessionId: string,
	): Promise<SessionManifest | undefined> {
		const target = sessionId.trim();
		if (!target) return undefined;
		return await this.invokeOptionalValue<SessionManifest>(
			"readSessionManifest",
			target,
		);
	}

	// ── Session service invocation ──────────────────────────────────────

	private invoke<T>(method: string, ...args: unknown[]): Promise<T> {
		return invokeBackend<T>(this.sessionService, method, ...args);
	}

	private invokeOptional(method: string, ...args: unknown[]): Promise<void> {
		return invokeBackendOptional(this.sessionService, method, ...args);
	}

	private invokeOptionalValue<T = unknown>(
		method: string,
		...args: unknown[]
	): Promise<T | undefined> {
		return invokeBackendOptionalValue<T>(this.sessionService, method, ...args);
	}
}
