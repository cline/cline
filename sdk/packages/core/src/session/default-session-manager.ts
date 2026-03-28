import { existsSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
	Agent,
	type AgentConfig,
	type AgentEvent,
	type AgentResult,
	createSpawnAgentTool,
	type TeamEvent,
	type Tool,
	type ToolApprovalRequest,
	type ToolApprovalResult,
} from "@clinebot/agents";
import type * as LlmsProviders from "@clinebot/llms/providers";
import {
	createSessionId,
	type ITelemetryService,
	isLikelyAuthError,
	normalizeUserInput,
} from "@clinebot/shared";
import { setHomeDirIfUnset } from "@clinebot/shared/storage";
import { nanoid } from "nanoid";
import { enrichPromptWithMentions } from "../input";
import { DefaultRuntimeBuilder } from "../runtime/runtime-builder";
import type { RuntimeBuilder } from "../runtime/session-runtime";
import { ProviderSettingsManager } from "../storage/provider-settings-manager";
import {
	captureAgentCreated,
	captureAgentTeamCreated,
	captureConversationTurnEvent,
	captureModeSwitch,
	captureSubagentExecution,
	captureTaskCompleted,
} from "../telemetry/core-events";
import { resolveCoreDistinctId } from "../telemetry/distinct-id";
import { createBuiltinTools, type ToolExecutors, ToolPresets } from "../tools";
import { SessionSource, type SessionStatus } from "../types/common";
import type { CoreSessionConfig } from "../types/config";
import type { CoreSessionEvent } from "../types/events";
import type { SessionRecord } from "../types/sessions";
import type { FileSessionService } from "./file-session-service";
import type { RpcCoreSessionService } from "./rpc-session-service";
import {
	OAuthReauthRequiredError,
	type RuntimeOAuthResolution,
	RuntimeOAuthTokenManager,
} from "./runtime-oauth-token-manager";
import {
	type AgentEventContext,
	buildTelemetryAgentIdentity,
	extractAgentEventMetadata,
	handleAgentEvent,
} from "./session-agent-events";
import { nowIso } from "./session-artifacts";
import {
	buildEffectiveConfig,
	buildResolvedProviderConfig,
	resolveReasoningSettings,
	resolveWorkspacePath,
} from "./session-config-builder";
import type {
	SendSessionInput,
	SessionAccumulatedUsage,
	SessionManager,
	StartSessionInput,
	StartSessionResult,
} from "./session-manager";
import { SessionManifestSchema } from "./session-manifest";
import type {
	CoreSessionService,
	RootSessionArtifacts,
	SessionRow,
} from "./session-service";
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
} from "./session-team-coordination";
import {
	emitMentionTelemetry,
	emitSessionCreationTelemetry,
} from "./session-telemetry";
import {
	extractWorkspaceMetadataFromSystemPrompt,
	toSessionRecord,
	withLatestAssistantTurnMetadata,
} from "./utils/helpers";
import type { ActiveSession, PreparedTurnInput } from "./utils/types";
import {
	accumulateUsageTotals,
	createInitialAccumulatedUsage,
} from "./utils/usage";

type SessionBackend =
	| CoreSessionService
	| RpcCoreSessionService
	| FileSessionService;

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

export interface DefaultSessionManagerOptions {
	distinctId?: string;
	sessionService: SessionBackend;
	runtimeBuilder?: RuntimeBuilder;
	createAgent?: (config: AgentConfig) => Agent;
	defaultToolExecutors?: Partial<ToolExecutors>;
	toolPolicies?: AgentConfig["toolPolicies"];
	providerSettingsManager?: ProviderSettingsManager;
	oauthTokenManager?: RuntimeOAuthTokenManager;
	telemetry?: ITelemetryService;
	requestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult>;
}

export class DefaultSessionManager implements SessionManager {
	private readonly sessionService: SessionBackend;
	private readonly runtimeBuilder: RuntimeBuilder;
	private readonly createAgentInstance: (config: AgentConfig) => Agent;
	private readonly defaultToolExecutors?: Partial<ToolExecutors>;
	private readonly defaultToolPolicies?: AgentConfig["toolPolicies"];
	private readonly providerSettingsManager: ProviderSettingsManager;
	private readonly oauthTokenManager: RuntimeOAuthTokenManager;
	private readonly defaultTelemetry?: ITelemetryService;
	private readonly defaultRequestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult>;
	private readonly listeners = new Set<(event: CoreSessionEvent) => void>();
	private readonly sessions = new Map<string, ActiveSession>();
	private readonly usageBySession = new Map<string, SessionAccumulatedUsage>();
	private readonly subAgentStarts = new Map<
		string,
		{ startedAt: number; rootSessionId: string }
	>();

	constructor(options: DefaultSessionManagerOptions) {
		const homeDir = homedir();
		if (homeDir) setHomeDirIfUnset(homeDir);
		const distinctId = resolveCoreDistinctId(options.distinctId);
		this.sessionService = options.sessionService;
		this.runtimeBuilder = options.runtimeBuilder ?? new DefaultRuntimeBuilder();
		this.createAgentInstance =
			options.createAgent ?? ((config) => new Agent(config));
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
		this.defaultRequestToolApproval = options.requestToolApproval;
	}

	// ── Public API ──────────────────────────────────────────────────────

	async start(input: StartSessionInput): Promise<StartSessionResult> {
		const source = input.source ?? SessionSource.CLI;
		const startedAt = nowIso();
		const requestedSessionId = input.config.sessionId?.trim() ?? "";
		const sessionId = requestedSessionId || createSessionId();
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
		const transcriptPath = join(sessionDir, `${sessionId}.log`);
		const hookPath = join(sessionDir, `${sessionId}.hooks.jsonl`);
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
			provider: input.config.providerId,
			model: input.config.modelId,
			cwd: input.config.cwd,
			workspace_root: workspacePath,
			team_name: input.config.teamName,
			enable_tools: input.config.enableTools,
			enable_spawn: input.config.enableSpawnAgent,
			enable_teams: input.config.enableAgentTeams,
			prompt: input.prompt?.trim() || undefined,
			messages_path: messagesPath,
		});

		const { config: effectiveConfig, pluginSandboxShutdown } =
			await buildEffectiveConfig(
				input,
				hookPath,
				sessionId,
				this.defaultTelemetry,
				(e) => void this.handlePluginEvent(sessionId, e),
			);
		const providerConfig = buildResolvedProviderConfig(
			effectiveConfig,
			this.providerSettingsManager,
			resolveReasoningSettings,
		);
		const configWithProvider: CoreSessionConfig = {
			...effectiveConfig,
			providerConfig,
		};

		const runtime = this.runtimeBuilder.build({
			config: configWithProvider,
			hooks: effectiveConfig.hooks,
			extensions: effectiveConfig.extensions,
			logger: configWithProvider.logger,
			telemetry: configWithProvider.telemetry,
			onTeamEvent: (event: TeamEvent) => {
				void this.handleTeamEvent(sessionId, event);
				configWithProvider.onTeamEvent?.(event);
			},
			createSpawnTool: () =>
				this.createSpawnTool(configWithProvider, sessionId),
			onTeamRestored: input.onTeamRestored,
			userInstructionWatcher: input.userInstructionWatcher,
			defaultToolExecutors:
				input.defaultToolExecutors ?? this.defaultToolExecutors,
		});
		if (runtime.teamRuntime && !configWithProvider.teamName?.trim()) {
			configWithProvider.teamName = runtime.teamRuntime.getTeamName();
		}

		const tools = [...runtime.tools, ...(configWithProvider.extraTools ?? [])];

		const agent = this.createAgentInstance({
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
			maxConsecutiveMistakes: configWithProvider.maxConsecutiveMistakes,
			tools,
			hooks: effectiveConfig.hooks,
			extensions: effectiveConfig.extensions,
			hookErrorMode: configWithProvider.hookErrorMode,
			initialMessages: input.initialMessages,
			userFileContentLoader: loadUserFileContent,
			toolPolicies: input.toolPolicies ?? this.defaultToolPolicies,
			requestToolApproval:
				input.requestToolApproval ?? this.defaultRequestToolApproval,
			onConsecutiveMistakeLimitReached:
				configWithProvider.onConsecutiveMistakeLimitReached,
			completionGuard: runtime.completionGuard,
			logger: runtime.logger ?? configWithProvider.logger,
			onEvent: (event: AgentEvent) =>
				this.onAgentEvent(sessionId, configWithProvider, event),
		});
		const rootAgentIdentity = buildTelemetryAgentIdentity({
			agentId: this.readAgentId(agent),
			conversationId: this.readAgentConversationId(agent),
			teamId: runtime.teamRuntime?.getTeamId(),
			teamName: runtime.teamRuntime?.getTeamName(),
			teamRole: runtime.teamRuntime ? "lead" : undefined,
		});
		emitSessionCreationTelemetry(
			configWithProvider,
			sessionId,
			source,
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
				leadAgentId: this.readAgentId(agent),
				restoredFromPersistence: runtime.teamRestoredFromPersistence === true,
			});
		}

		const active: ActiveSession = {
			sessionId,
			config: configWithProvider,
			source,
			startedAt,
			pendingPrompt: manifest.prompt,
			runtime,
			agent,
			started: false,
			aborting: false,
			interactive: input.interactive === true,
			persistedMessages: input.initialMessages,
			activeTeamRunIds: new Set<string>(),
			pendingTeamRunUpdates: [],
			teamRunWaiters: [],
			pendingPrompts: [],
			drainingPendingPrompts: false,
			pluginSandboxShutdown,
		};
		this.sessions.set(sessionId, active);
		this.emitStatus(sessionId, "running");

		let result: AgentResult | undefined;
		try {
			if (input.prompt?.trim()) {
				result = await this.runTurn(active, {
					prompt: input.prompt,
					userImages: input.userImages,
					userFiles: input.userFiles,
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
			transcriptPath,
			hookPath,
			messagesPath,
			result,
		};
	}

	async send(input: SendSessionInput): Promise<AgentResult | undefined> {
		const session = this.getSessionOrThrow(input.sessionId);
		session.config.telemetry?.capture({
			event: "session.input_sent",
			properties: {
				sessionId: input.sessionId,
				promptLength: input.prompt.length,
				userImageCount: input.userImages?.length ?? 0,
				userFileCount: input.userFiles?.length ?? 0,
				delivery: input.delivery ?? "immediate",
			},
		});
		if (input.delivery === "queue" || input.delivery === "steer") {
			this.enqueuePendingPrompt(input.sessionId, {
				prompt: input.prompt,
				delivery: input.delivery,
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

	async getAccumulatedUsage(
		sessionId: string,
	): Promise<SessionAccumulatedUsage | undefined> {
		const usage = this.usageBySession.get(sessionId);
		return usage ? { ...usage } : undefined;
	}

	async abort(sessionId: string, reason?: unknown): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		session.config.telemetry?.capture({
			event: "session.aborted",
			properties: { sessionId },
		});
		session.aborting = true;
		(
			session.agent as Agent & {
				abort: (abortReason?: unknown) => void;
			}
		).abort(reason);
	}

	async stop(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		session.config.telemetry?.capture({
			event: "session.stopped",
			properties: { sessionId },
		});
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
		const row = await this.getRow(sessionId);
		return row ? toSessionRecord(row) : undefined;
	}

	async list(limit = 200): Promise<SessionRecord[]> {
		const rows = await this.listRows(limit);
		return rows.map(toSessionRecord);
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

	async readTranscript(sessionId: string, maxChars?: number): Promise<string> {
		const row = await this.getRow(sessionId);
		if (!row?.transcriptPath || !existsSync(row.transcriptPath)) return "";
		const raw = readFileSync(row.transcriptPath, "utf8");
		if (typeof maxChars === "number" && Number.isFinite(maxChars)) {
			return raw.slice(-Math.max(0, Math.floor(maxChars)));
		}
		return raw;
	}

	async readMessages(sessionId: string): Promise<LlmsProviders.Message[]> {
		const row = await this.getRow(sessionId);
		const messagesPath = row?.messagesPath?.trim();
		if (!messagesPath || !existsSync(messagesPath)) return [];
		try {
			const raw = readFileSync(messagesPath, "utf8").trim();
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

	async readHooks(sessionId: string, limit = 200): Promise<unknown[]> {
		const row = await this.getRow(sessionId);
		if (!row?.hookPath || !existsSync(row.hookPath)) return [];
		const lines = readFileSync(row.hookPath, "utf8")
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

	subscribe(listener: (event: CoreSessionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
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
			this.usageBySession.set(
				session.sessionId,
				accumulateUsageTotals(usageBaseline, result.usage),
			);
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
			startedAt: session.startedAt,
		})) as RootSessionArtifacts;
	}

	private async finalizeSingleRun(
		session: ActiveSession,
		finishReason: AgentResult["finishReason"],
	): Promise<void> {
		if (hasPendingTeamRunWork(session)) return;
		const isAborted = finishReason === "aborted" || session.aborting;
		await this.shutdownSession(session, {
			status: isAborted ? "cancelled" : "completed",
			exitCode: 0,
			shutdownReason: "session_complete",
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

		if (session.artifacts) {
			await this.updateStatus(session, input.status, input.exitCode);
			await session.agent.shutdown(input.shutdownReason);
		}
		await Promise.resolve(session.runtime.shutdown(input.shutdownReason));
		await session.pluginSandboxShutdown?.();
		this.sessions.delete(session.sessionId);
		this.emit({
			type: "ended",
			payload: {
				sessionId: session.sessionId,
				reason: input.endReason,
				ts: Date.now(),
			},
		});
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
		session.artifacts.manifest.status = status;
		session.artifacts.manifest.ended_at = result.endedAt ?? nowIso();
		session.artifacts.manifest.exit_code =
			typeof exitCode === "number" ? exitCode : null;
		await this.invoke<void>(
			"writeSessionManifest",
			session.artifacts.manifestPath,
			session.artifacts.manifest,
		);
		this.emitStatus(session.sessionId, status);
	}

	private async handlePluginEvent(
		rootSessionId: string,
		event: { name: string; payload?: unknown },
	): Promise<void> {
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
		if (!session) {
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
		queueMicrotask(() => {
			void this.drainPendingPrompts(sessionId);
		});
	}

	private async drainPendingPrompts(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session || session.drainingPendingPrompts) {
			return;
		}
		const canStartRun =
			typeof (session.agent as Agent & { canStartRun?: () => boolean })
				.canStartRun === "function"
				? (
						session.agent as Agent & {
							canStartRun: () => boolean;
						}
					).canStartRun()
				: true;
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
				prompts: session.pendingPrompts.map((entry) => ({
					id: entry.id,
					prompt: entry.prompt,
					delivery: entry.delivery,
					attachmentCount:
						(entry.userImages?.length ?? 0) + (entry.userFiles?.length ?? 0),
				})),
			},
		});
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
	): Tool {
		const createSubAgentTools = () => {
			const tools: Tool[] = config.enableTools
				? createBuiltinTools({
						cwd: config.cwd,
						...(config.mode === "plan"
							? ToolPresets.readonly
							: ToolPresets.development),
						executors: this.defaultToolExecutors,
					})
				: [];
			if (config.enableSpawnAgent) {
				tools.push(this.createSpawnTool(config, rootSessionId));
			}
			return tools;
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
						clineWorkspaceMetadata:
							config.providerId === "cline"
								? extractWorkspaceMetadataFromSystemPrompt(config.systemPrompt)
								: undefined,
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
				throw new Error(
					`OAuth session for "${error.providerId}" requires re-authentication. Run "clite auth ${error.providerId}" and retry.`,
				);
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
		const agentWithConnection = session.agent as Agent & {
			updateConnection?: (overrides: {
				apiKey?: string;
				modelId?: string;
			}) => void;
		};
		agentWithConnection.updateConnection?.(overrides);
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

	private readAgentId(agent: Agent): string | undefined {
		return (agent as Agent & { getAgentId?: () => string }).getAgentId?.();
	}

	private readAgentConversationId(agent: Agent): string | undefined {
		return (
			agent as Agent & { getConversationId?: () => string }
		).getConversationId?.();
	}

	private emitStatus(sessionId: string, status: string): void {
		this.emit({
			type: "status",
			payload: { sessionId, status },
		});
	}

	private emit(event: CoreSessionEvent): void {
		for (const listener of this.listeners) listener(event);
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
