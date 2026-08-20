import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
	buildConnectionUpdate,
	buildWorkspaceMetadata,
	type ClineCore,
	type ClineCoreStartConfig,
	createSessionCompactionState,
	createUserInstructionConfigService,
	getCoreBuiltinToolCatalog,
	isSkillsToolAvailable,
	projectSessionCompactionState,
	readGlobalSettings,
	type SessionCompactionState,
	type SessionPendingPrompt,
	type SessionRecord,
	SessionSource,
	splitCoreSessionConfig,
	trimMessagesBeforeUserRun,
} from "@cline/core";
import type { MessageWithMetadata } from "@cline/llms";
import { buildClineSystemPrompt, formatUserCommandBlock } from "@cline/shared";
import {
	deleteMaterializedAttachments,
	discardAllTrackedAttachments,
	materializeUserFiles,
	trackQueuedAttachments,
} from "./attachments";
import { emitChunk, nowMs, sendEvent } from "./context";
import { readSessionManifest, sharedSessionDataDir } from "./paths";
import { persistSessionMessages } from "./session-data/messages";
import type {
	ChatSessionCommandRequest,
	JsonRecord,
	LiveSession,
	PromptInQueue,
	SidecarContext,
} from "./types";

type SessionConnectionUpdate = Parameters<
	ClineCore["updateSessionConnection"]
>[1];

type WorkspaceMetadataLoader = (cwd: string) => Promise<string>;
type WorkspaceMetadataCacheEntry = {
	createdAt: number;
	promise: Promise<string>;
};
export const WORKSPACE_METADATA_PREWARM_TTL_MS = 60_000;
const workspaceMetadataPromises = new Map<
	string,
	WorkspaceMetadataCacheEntry
>();
const ACTIVE_WORKSPACE_SESSION_STATUSES = new Set([
	"starting",
	"pending",
	"running",
	"stopping",
]);
const WORKSPACE_RESTORE_SEND_ERROR =
	"Cannot send a prompt while the session workspace is being restored";
const WORKSPACE_RESTORE_BUSY_ERROR =
	"Wait for all turns in this workspace to finish before restoring it";

type WorkspacePathSource = {
	cwd?: unknown;
	workspaceRoot?: unknown;
	workspace_root?: unknown;
};

function readWorkspacePath(
	source: WorkspacePathSource | undefined,
): string | undefined {
	const cwd = typeof source?.cwd === "string" ? source.cwd.trim() : "";
	if (cwd) return cwd;
	const workspaceRoot =
		typeof source?.workspaceRoot === "string"
			? source.workspaceRoot.trim()
			: "";
	if (workspaceRoot) return workspaceRoot;
	const snakeCaseWorkspaceRoot =
		typeof source?.workspace_root === "string"
			? source.workspace_root.trim()
			: "";
	return snakeCaseWorkspaceRoot || undefined;
}

function workspacePathKey(
	source: WorkspacePathSource | undefined,
): string | undefined {
	const workspacePath = readWorkspacePath(source);
	return workspacePath ? resolve(workspacePath) : undefined;
}

/**
 * Built-in webview slash commands (chat-input-bar.tsx) keep their literal
 * token: the slash menu hides same-named user commands, so expansion must
 * not hijack them either.
 */
const BUILTIN_SLASH_COMMAND_NAMES = new Set(["fork", "team"]);

/**
 * Expand a leading `/skill` or `/workflow` token into its configured
 * instructions before dispatching the prompt. Skill commands pass through as
 * typed whenever the session registers the runtime's `skills` tool (its
 * description requires the model to invoke it on slash-command references),
 * so the instructions reach the model as a tool result instead of being
 * pasted into the user message — where the transcript would render them as
 * if the user had typed the whole skill body. Workflows, and skills in
 * configurations without the tool (e.g. yolo mode), keep textual expansion.
 * Returns the prompt unchanged when it is not a slash command, the token is
 * a built-in, no command matches, or command discovery fails.
 */
async function expandRuntimeSlashCommand(
	ctx: SidecarContext,
	workspacePath: string | undefined,
	prompt: string,
	mode?: unknown,
): Promise<string> {
	if (!prompt.startsWith("/") || prompt.length < 2) {
		return prompt;
	}
	const name = prompt.match(/^\/(\S+)/)?.[1]?.toLowerCase();
	if (!name || BUILTIN_SLASH_COMMAND_NAMES.has(name)) {
		return prompt;
	}
	const service = createUserInstructionConfigService({
		skills: { workspacePath },
		rules: { workspacePath },
		workflows: { workspacePath },
	});
	try {
		await service.start();
		return service.resolveRuntimeSlashCommand(prompt, {
			expandSkillCommands: !isSkillsToolAvailable({
				mode: mode === "plan" || mode === "yolo" ? mode : "act",
				disabledToolIds: new Set(readGlobalSettings().disabledTools ?? []),
			}),
		});
	} catch (error) {
		ctx.logger?.debug("Slash command expansion failed, sending raw prompt", {
			error,
		});
		return prompt;
	} finally {
		service.stop();
	}
}

type TeamPromptAvailability = {
	/** Session mode as stored in config; anything but plan/yolo counts as act. */
	mode?: unknown;
	disabledTools?: ReadonlySet<string>;
};

export function rewriteDesktopTeamPrompt(
	prompt: string,
	availability: TeamPromptAvailability = {},
): string {
	const match = /^\/team\b([\s\S]*)$/i.exec(prompt.trim());
	if (!match) return prompt;
	const task = match[1]?.trim();
	if (!task) {
		throw new Error(
			"Usage: /team <task description>. Starts a team of agents for the given task.",
		);
	}
	const disabledTools =
		availability.disabledTools ??
		new Set(readGlobalSettings().disabledTools ?? []);
	if (disabledTools.has("teams")) {
		throw new Error(
			"Agent teams are disabled. Enable the Teams tool in Customizations → Tools.",
		);
	}
	// The runtime resolves tool availability from the mode's preset, so a
	// preset without team tools must reject /team here rather than send the
	// model an instruction it cannot act on.
	const mode =
		availability.mode === "plan" || availability.mode === "yolo"
			? availability.mode
			: "act";
	const teamsAvailable = getCoreBuiltinToolCatalog({ mode }).some(
		(entry) => entry.id === "teams" && entry.defaultEnabled,
	);
	if (!teamsAvailable) {
		throw new Error(`Agent teams are not available in ${mode} mode.`);
	}
	return formatUserCommandBlock(
		`spawn a team of agents for the following task: ${task}`,
		"team",
	);
}

async function resolveDesktopRuntimePrompt(
	ctx: SidecarContext,
	workspacePath: string | undefined,
	prompt: string,
	mode?: unknown,
): Promise<string> {
	return rewriteDesktopTeamPrompt(
		await expandRuntimeSlashCommand(ctx, workspacePath, prompt, mode),
		{ mode },
	);
}

function hasActiveWorkspaceTurn(session: LiveSession): boolean {
	return (
		session.busy ||
		session.transitioningProvider === true ||
		ACTIVE_WORKSPACE_SESSION_STATUSES.has(session.status)
	);
}

async function withWorkspaceRestoreLock<T>(
	ctx: SidecarContext,
	workspacePath: string,
	work: () => Promise<T>,
): Promise<T> {
	const key = resolve(workspacePath);
	if (ctx.restoringWorkspacePaths.has(key)) {
		throw new Error(WORKSPACE_RESTORE_BUSY_ERROR);
	}
	for (const session of ctx.liveSessions.values()) {
		if (
			workspacePathKey(session.config) === key &&
			hasActiveWorkspaceTurn(session)
		) {
			throw new Error(WORKSPACE_RESTORE_BUSY_ERROR);
		}
	}

	ctx.restoringWorkspacePaths.add(key);
	try {
		return await work();
	} finally {
		ctx.restoringWorkspacePaths.delete(key);
	}
}

function getWorkspaceMetadataPromise(
	cwd: string,
	load: WorkspaceMetadataLoader,
	now: () => number,
): { key: string; promise: Promise<string> } {
	const key = resolve(cwd);
	const existing = workspaceMetadataPromises.get(key);
	const createdAt = now();
	if (
		existing &&
		createdAt - existing.createdAt <= WORKSPACE_METADATA_PREWARM_TTL_MS
	) {
		return { key, promise: existing.promise };
	}
	const promise = load(key);
	workspaceMetadataPromises.set(key, { createdAt, promise });
	void promise.catch(() => {
		if (workspaceMetadataPromises.get(key)?.promise === promise) {
			workspaceMetadataPromises.delete(key);
		}
	});
	return { key, promise };
}

export function prewarmWorkspaceMetadata(
	cwd: string,
	load: WorkspaceMetadataLoader = buildWorkspaceMetadata,
	now: () => number = Date.now,
): void {
	void getWorkspaceMetadataPromise(cwd, load, now).promise.catch(() => {});
}

export async function consumeWorkspaceMetadata(
	cwd: string,
	load: WorkspaceMetadataLoader = buildWorkspaceMetadata,
	now: () => number = Date.now,
): Promise<string> {
	const { key, promise } = getWorkspaceMetadataPromise(cwd, load, now);
	try {
		return await promise;
	} finally {
		if (workspaceMetadataPromises.get(key)?.promise === promise) {
			workspaceMetadataPromises.delete(key);
		}
	}
}

export function refreshWorkspaceMetadata(cwd: string): void {
	workspaceMetadataPromises.delete(resolve(cwd));
	prewarmWorkspaceMetadata(cwd);
}

// ---------------------------------------------------------------------------
// Session data helpers
// ---------------------------------------------------------------------------

function readPersistedChatMessages(
	sessionId: string,
): MessageWithMetadata[] | null {
	const path = join(
		sharedSessionDataDir(),
		sessionId,
		`${sessionId}.messages.json`,
	);
	if (!existsSync(path)) return null;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8").trim()) as
			| { messages?: MessageWithMetadata[] }
			| MessageWithMetadata[];
		if (Array.isArray(parsed)) return parsed;
		return Array.isArray(parsed.messages) ? parsed.messages : null;
	} catch {
		return null;
	}
}

function readSessionMetadataTitle(sessionId: string): string | undefined {
	const manifest = readSessionManifest(sessionId);
	const metadata =
		manifest?.metadata && typeof manifest.metadata === "object"
			? (manifest.metadata as JsonRecord)
			: undefined;
	const title = metadata?.title;
	return typeof title === "string" ? title.trim() || undefined : undefined;
}

function readSessionMetadata(sessionId: string): JsonRecord | undefined {
	const manifest = readSessionManifest(sessionId);
	return manifest?.metadata && typeof manifest.metadata === "object"
		? (manifest.metadata as JsonRecord)
		: undefined;
}

function derivePromptFromMessages(messages: unknown[]): string {
	for (const msg of messages) {
		if (!msg || typeof msg !== "object") continue;
		const m = msg as JsonRecord;
		if (m.role !== "user") continue;
		if (typeof m.content === "string") {
			const line = m.content.trim().split("\n")[0]?.trim();
			if (line) return line.slice(0, 200);
		}
	}
	return "";
}

// ---------------------------------------------------------------------------
// Live session factory
// ---------------------------------------------------------------------------

function createLiveSession(
	config: JsonRecord,
	overrides?: Partial<LiveSession>,
): LiveSession {
	return {
		config,
		messages: overrides?.messages ?? [],
		promptsInQueue: overrides?.promptsInQueue ?? [],
		busy: false,
		startedAt: nowMs(),
		status: overrides?.status ?? "idle",
		prompt: overrides?.prompt,
		title: overrides?.title,
		attachedViaHub: overrides?.attachedViaHub ?? false,
		queuedAttachmentFiles: overrides?.queuedAttachmentFiles,
		consumedAttachmentFiles: overrides?.consumedAttachmentFiles,
	};
}

function isoTimestampToMs(
	value: string | null | undefined,
): number | undefined {
	if (!value) {
		return undefined;
	}
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function readReasoningEffort(
	value: unknown,
): "low" | "medium" | "high" | "xhigh" | undefined {
	if (
		value === "low" ||
		value === "medium" ||
		value === "high" ||
		value === "xhigh"
	) {
		return value;
	}
	return undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return Math.trunc(value);
	}
	return undefined;
}

function buildCoreSessionConfig(config: JsonRecord): JsonRecord {
	const rawWorkspaceRoot = config.workspaceRoot ?? config.workspace_root;
	const workspaceRoot =
		typeof rawWorkspaceRoot === "string" ? rawWorkspaceRoot.trim() : "";
	const cwd =
		(typeof config.cwd === "string" ? config.cwd.trim() : "") || workspaceRoot;
	const thinking =
		typeof config.thinking === "boolean" ? config.thinking : undefined;
	const reasoningEffort =
		thinking === false
			? undefined
			: readReasoningEffort(config.reasoningEffort);
	const thinkingBudgetTokens =
		thinking === false
			? undefined
			: readPositiveInteger(
					config.thinkingBudgetTokens ?? config.thinking_budget_tokens,
				);
	return {
		sessionId: config.sessionId ?? config.session_id,
		providerId: config.provider ?? config.providerId ?? "",
		modelId: config.model ?? config.modelId ?? "",
		mode: resolveDesktopSessionMode(config),
		apiKey: config.apiKey ?? config.api_key ?? "",
		baseUrl: config.baseUrl,
		headers: config.headers,
		providerConfig: config.providerConfig,
		...(workspaceRoot ? { workspaceRoot } : {}),
		...(cwd ? { cwd } : {}),
		systemPrompt: config.systemPrompt ?? config.system_prompt ?? "",
		maxIterations: config.maxIterations ?? config.max_iterations,
		enableTools: config.enableTools ?? config.enable_tools ?? true,
		...(thinking !== undefined ? { thinking } : {}),
		...(reasoningEffort ? { reasoningEffort } : {}),
		...(thinkingBudgetTokens !== undefined ? { thinkingBudgetTokens } : {}),
		teamName: config.teamName ?? config.team_name,
		missionLogIntervalSteps:
			config.missionStepInterval ?? config.missionLogIntervalSteps,
		missionLogIntervalMs:
			config.missionTimeIntervalMs ?? config.missionLogIntervalMs,
		checkpoint: { enabled: true },
		sessions: config.sessions,
		initialMessages: config.initialMessages,
	};
}

/** Auto-approval is a tool policy, not a request to change the tool preset. */
export function resolveDesktopSessionMode(
	config: JsonRecord,
): "act" | "plan" | "yolo" {
	return config.mode === "plan"
		? "plan"
		: config.mode === "yolo"
			? "yolo"
			: "act";
}

export function buildSessionConnectionUpdate(
	config: JsonRecord,
): SessionConnectionUpdate {
	// Coerce the untrusted webview JSON (snake_case aliases, blank strings)
	// into typed fields; the thinking/reasoning transition rules live in the
	// shared @cline/core builder.
	const providerId = String(config.provider ?? config.providerId ?? "").trim();
	const modelId = String(config.model ?? config.modelId ?? "").trim();
	const rawApiKey =
		typeof config.apiKey === "string"
			? config.apiKey.trim()
			: typeof config.api_key === "string"
				? config.api_key.trim()
				: undefined;
	const baseUrl =
		typeof config.baseUrl === "string" ? config.baseUrl.trim() : undefined;
	const reasoningEffort = readReasoningEffort(config.reasoningEffort);
	const thinkingBudgetTokens = readPositiveInteger(
		config.thinkingBudgetTokens ?? config.thinking_budget_tokens,
	);
	return buildConnectionUpdate({
		...(providerId ? { providerId } : {}),
		...(modelId ? { modelId } : {}),
		...(rawApiKey ? { apiKey: rawApiKey } : {}),
		...(baseUrl ? { baseUrl } : {}),
		...(config.headers && typeof config.headers === "object"
			? { headers: config.headers as Record<string, string> }
			: {}),
		...(config.providerConfig && typeof config.providerConfig === "object"
			? {
					providerConfig:
						config.providerConfig as SessionConnectionUpdate["providerConfig"],
				}
			: {}),
		...(typeof config.thinking === "boolean"
			? { thinking: config.thinking }
			: {}),
		...(reasoningEffort ? { reasoningEffort } : {}),
		...(thinkingBudgetTokens !== undefined ? { thinkingBudgetTokens } : {}),
	});
}

export function shouldUpdateSessionConnection(
	currentConfig: JsonRecord,
	nextConfig: JsonRecord,
): boolean {
	return !isDeepStrictEqual(
		buildSessionConnectionUpdate(currentConfig),
		buildSessionConnectionUpdate(nextConfig),
	);
}

function readAliasedString(
	config: JsonRecord,
	primaryKey: string,
	aliasKey: string,
): string | undefined {
	for (const key of [primaryKey, aliasKey]) {
		if (!Object.hasOwn(config, key)) continue;
		const value = String(config[key] ?? "").trim();
		return value || undefined;
	}
	return undefined;
}

export function mergeSessionConfig(
	currentConfig: JsonRecord,
	updates: JsonRecord,
): JsonRecord {
	const providerId =
		readAliasedString(updates, "provider", "providerId") ??
		readAliasedString(currentConfig, "provider", "providerId");
	const modelId =
		readAliasedString(updates, "model", "modelId") ??
		readAliasedString(currentConfig, "model", "modelId");
	return {
		...currentConfig,
		...updates,
		...(providerId ? { provider: providerId, providerId } : {}),
		...(modelId ? { model: modelId, modelId } : {}),
	};
}

export function hasProviderChanged(
	currentConfig: JsonRecord,
	nextConfig: JsonRecord,
): boolean {
	const currentProviderId = readAliasedString(
		currentConfig,
		"provider",
		"providerId",
	);
	const nextProviderId = readAliasedString(
		nextConfig,
		"provider",
		"providerId",
	);
	return nextProviderId !== undefined && currentProviderId !== nextProviderId;
}

async function resolveSystemPrompt(config: JsonRecord): Promise<string> {
	const cwd = String(
		config.cwd ?? config.workspaceRoot ?? config.workspace_root ?? "",
	).trim();
	if (!cwd) {
		return String(config.systemPrompt ?? config.system_prompt ?? "").trim();
	}
	const providerId = String(config.provider ?? config.providerId ?? "").trim();
	const mode = resolveDesktopSessionMode(config);
	const metadata = await consumeWorkspaceMetadata(cwd);
	const inlineRules =
		typeof config.rules === "string" && config.rules.trim().length > 0
			? config.rules
			: undefined;
	return buildClineSystemPrompt({
		ide: "Terminal Shell",
		workspaceRoot: cwd,
		workspaceName: basename(cwd),
		metadata,
		rules: inlineRules,
		mode,
		providerId: providerId || undefined,
		overridePrompt:
			typeof config.systemPrompt === "string" &&
			config.systemPrompt.trim().length > 0
				? config.systemPrompt
				: typeof config.system_prompt === "string" &&
						config.system_prompt.trim().length > 0
					? config.system_prompt
					: undefined,
		platform: process.platform || "unknown",
	});
}

function resolveToolPolicies(
	config: JsonRecord,
): { "*": { autoApprove: boolean } } | undefined {
	return {
		"*": {
			autoApprove: config.autoApproveTools !== false,
		},
	};
}

function sendPromptsInQueueSnapshot(
	ctx: SidecarContext,
	sessionId: string,
): void {
	const session = ctx.liveSessions.get(sessionId);
	sendEvent(ctx, "prompts_in_queue_state", {
		sessionId,
		items:
			session?.promptsInQueue.map(({ id, prompt, steer, attachmentCount }) => ({
				id,
				prompt,
				steer,
				attachmentCount,
			})) ?? [],
	});
}

function mapPendingPrompt(item: SessionPendingPrompt): PromptInQueue {
	return {
		id: item.id,
		prompt: item.prompt,
		steer: item.delivery === "steer",
		attachmentCount: item.attachmentCount,
		userImages: item.userImages,
	};
}

function applyPendingPrompts(
	ctx: SidecarContext,
	sessionId: string,
	prompts: SessionPendingPrompt[],
): PromptInQueue[] {
	const mapped = prompts.map(mapPendingPrompt).filter((item) => item.id);
	const session = ctx.liveSessions.get(sessionId);
	if (session) {
		session.promptsInQueue = mapped;
	}
	sendPromptsInQueueSnapshot(ctx, sessionId);
	return mapped.map(({ id, prompt, steer, attachmentCount }) => ({
		id,
		prompt,
		steer,
		attachmentCount,
	}));
}

function getSessionManager(ctx: SidecarContext): ClineCore {
	if (!ctx.sessionManager) throw new Error("Session manager not initialized");
	return ctx.sessionManager;
}

// ---------------------------------------------------------------------------
// Chat session action handlers
// ---------------------------------------------------------------------------

async function handleStart(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	if (!request.config) throw new Error("config is required");
	const manager = getSessionManager(ctx);
	const systemPrompt = await resolveSystemPrompt(request.config);
	const requestedSessionId = String(
		request.config.sessionId ?? request.config.session_id ?? "",
	).trim();
	const initialMessages =
		Array.isArray(request.config.initialMessages) &&
		request.config.initialMessages.length > 0
			? request.config.initialMessages
			: requestedSessionId
				? (readPersistedChatMessages(requestedSessionId) ?? undefined)
				: undefined;
	const coreConfig: JsonRecord = {
		...buildCoreSessionConfig(request.config),
		systemPrompt,
		...(initialMessages ? { initialMessages } : {}),
	};
	// Note: do NOT pass `prompt` to manager.start() here. When a prompt is
	// provided to start(), the local runtime host runs the full agent turn
	// synchronously inside start(). We always start the session idle and let
	// the frontend call the separate "send" action to dispatch the prompt.
	// This avoids a double-execution bug where start() would run the turn AND
	// the subsequent manager.send() fire-and-forget would run it again.
	ctx.logger?.log("Starting desktop chat session", {
		providerId: String(coreConfig.providerId ?? ""),
		modelId: String(coreConfig.modelId ?? ""),
	});
	const startResult = await manager.start({
		...splitCoreSessionConfig(coreConfig as unknown as ClineCoreStartConfig),
		source: SessionSource.DESKTOP,
		interactive: true,
		...(initialMessages ? { initialMessages } : {}),
		toolPolicies: resolveToolPolicies(request.config),
	});
	const sessionId = startResult.sessionId;
	const workspaceRoot = startResult.manifest.workspace_root;
	const cwd = startResult.manifest.cwd;
	ctx.logger?.log("Desktop chat session started", { sessionId });
	const session = createLiveSession(
		{ ...request.config, cwd, workspaceRoot },
		{
			messages: initialMessages,
			prompt: initialMessages
				? derivePromptFromMessages(initialMessages)
				: undefined,
			title: requestedSessionId
				? readSessionMetadataTitle(requestedSessionId)
				: undefined,
			status: "idle",
		},
	);
	ctx.liveSessions.set(sessionId, session);
	return { sessionId, cwd, workspaceRoot };
}

async function handleAttach(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	const sessionId = request.sessionId?.trim();
	if (!sessionId) {
		throw new Error("sessionId is required");
	}

	const manager = getSessionManager(ctx);
	const session = await manager.get(sessionId);
	if (!session) {
		throw new Error(`Session ${sessionId} not found`);
	}

	const metadata =
		session.metadata && typeof session.metadata === "object"
			? (session.metadata as JsonRecord)
			: undefined;
	const existing = ctx.liveSessions.get(sessionId);
	if (ctx.hubClient) {
		await ctx.hubClient.command("session.attach", { sessionId }, sessionId);
	}
	const attachedConfig: JsonRecord = {
		...(existing?.config ?? {}),
		...(request.config ?? {}),
		sessionId,
		provider: session.provider || existing?.config.provider || "",
		model: session.model || existing?.config.model || "",
		cwd:
			session.cwd ||
			session.workspaceRoot ||
			String(request.config?.cwd ?? "").trim() ||
			String(existing?.config.cwd ?? "").trim(),
		workspaceRoot:
			session.workspaceRoot ||
			session.cwd ||
			String(request.config?.workspaceRoot ?? "").trim() ||
			String(existing?.config.workspaceRoot ?? "").trim(),
	};
	ctx.liveSessions.set(
		sessionId,
		createLiveSession(attachedConfig, {
			messages: existing?.messages ?? [],
			promptsInQueue: existing?.promptsInQueue ?? [],
			status: session.status,
			prompt:
				session.prompt ||
				(typeof metadata?.prompt === "string" ? metadata.prompt : undefined) ||
				existing?.prompt,
			title:
				(typeof metadata?.title === "string" ? metadata.title : undefined) ||
				existing?.title,
			endedAt: isoTimestampToMs(session.endedAt),
			attachedViaHub: true,
			// Preserve tracked attachment files so re-attach (called on every
			// webview hydrate) does not orphan materialized files still awaiting
			// cleanup.
			queuedAttachmentFiles: existing?.queuedAttachmentFiles,
			consumedAttachmentFiles: existing?.consumedAttachmentFiles,
		}),
	);

	return {
		sessionId,
		status: session.status,
		provider: session.provider,
		model: session.model,
		cwd: session.cwd,
		workspaceRoot: session.workspaceRoot,
		prompt: session.prompt,
		metadata,
	};
}

async function startRebuiltSession(
	manager: ClineCore,
	sessionId: string,
	config: JsonRecord,
	systemPrompt: string,
	messages: MessageWithMetadata[],
	compactionState: SessionCompactionState | undefined,
): Promise<void> {
	const projectedMessages = compactionState
		? projectSessionCompactionState(compactionState, messages)
		: undefined;
	const restarted = await manager.start({
		...splitCoreSessionConfig(
			buildCoreSessionConfig({
				...config,
				sessionId,
				systemPrompt,
			}) as unknown as ClineCoreStartConfig,
		),
		source: SessionSource.DESKTOP,
		interactive: true,
		initialMessages: messages,
		...(projectedMessages
			? {
					initialCompactionState: createSessionCompactionState({
						sourceMessages: messages,
						compactedMessages: projectedMessages,
						systemPrompt: compactionState?.system_prompt,
					}),
				}
			: {}),
		toolPolicies: resolveToolPolicies(config),
	});
	if (restarted.sessionId !== sessionId) {
		throw new Error(
			`Provider switch changed session id from ${sessionId} to ${restarted.sessionId}`,
		);
	}
}

async function rebuildSessionForProviderChange(
	ctx: SidecarContext,
	manager: ClineCore,
	sessionId: string,
	previousConfig: JsonRecord,
	nextConfig: JsonRecord,
): Promise<void> {
	const [messages, compactionState, previousSystemPrompt, nextSystemPrompt] =
		await Promise.all([
			manager.readMessages(sessionId),
			manager.readSessionCompactionState(sessionId).catch((error) => {
				ctx.logger?.log?.("Failed to read desktop session compaction state", {
					sessionId,
					error,
					severity: "warn",
				});
				return undefined;
			}),
			resolveSystemPrompt(previousConfig),
			resolveSystemPrompt(nextConfig),
		]);

	await manager.stop(sessionId);
	let replacementStarted = false;
	try {
		await startRebuiltSession(
			manager,
			sessionId,
			nextConfig,
			nextSystemPrompt,
			messages,
			compactionState,
		);
		replacementStarted = true;
		// Reusing a session id preserves its existing manifest. Treat refreshing
		// its connection label as part of the replacement transaction so a
		// persistence failure cannot leave runtime and cached state diverged.
		await manager.updateSessionConnection(
			sessionId,
			buildSessionConnectionUpdate(nextConfig),
		);
	} catch (replacementError) {
		try {
			if (replacementStarted) {
				await manager.stop(sessionId);
			}
			await startRebuiltSession(
				manager,
				sessionId,
				previousConfig,
				previousSystemPrompt,
				messages,
				compactionState,
			);
			await manager.updateSessionConnection(
				sessionId,
				buildSessionConnectionUpdate(previousConfig),
			);
		} catch (rollbackError) {
			throw new AggregateError(
				[replacementError, rollbackError],
				"Provider switch and rollback both failed",
			);
		}
		throw replacementError;
	}
}

async function handleSend(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	const sessionId = request.sessionId?.trim();
	if (!sessionId) throw new Error("sessionId is required");
	const prompt = request.prompt?.trim() ?? "";
	const hasAttachments =
		(request.attachments?.userImages?.length ?? 0) > 0 ||
		(request.attachments?.userFiles?.length ?? 0) > 0;
	if (!prompt && !hasAttachments) {
		throw new Error("prompt or attachment is required");
	}
	const manager = getSessionManager(ctx);
	const session = ctx.liveSessions.get(sessionId);
	const lockedWorkspaceKey = workspacePathKey(
		session?.config ?? request.config,
	);
	if (
		lockedWorkspaceKey &&
		ctx.restoringWorkspacePaths.has(lockedWorkspaceKey)
	) {
		throw new Error(WORKSPACE_RESTORE_SEND_ERROR);
	}
	if (session?.transitioningProvider) {
		throw new Error("A provider switch is already in progress");
	}
	// Dispatch the expanded or rewritten instructions, but keep the raw
	// `/command` token as the session's display prompt.
	const runtimePrompt = await resolveDesktopRuntimePrompt(
		ctx,
		readWorkspacePath(session?.config ?? request.config) ?? ctx.workspaceRoot,
		prompt,
		request.config?.mode ?? session?.config?.mode,
	);
	let delivery = request.delivery;
	if (!delivery && session?.busy) {
		delivery = "queue";
	}
	const nextConfig = request.config
		? mergeSessionConfig(session?.config ?? {}, request.config)
		: undefined;
	const providerChanged = Boolean(
		session &&
			request.config &&
			hasProviderChanged(session.config, request.config),
	);
	if (providerChanged && session?.busy) {
		throw new Error("Cannot switch providers while a turn is running");
	}
	const ownsBusyState = Boolean(
		session && delivery !== "queue" && delivery !== "steer",
	);
	if (session) {
		if (ownsBusyState) {
			session.prompt = prompt;
			session.busy = true;
			session.status = "running";
		}
		if (providerChanged) {
			session.transitioningProvider = true;
		}
	}
	try {
		if (request.config && nextConfig) {
			if (providerChanged && session) {
				await rebuildSessionForProviderChange(
					ctx,
					manager,
					sessionId,
					session.config,
					nextConfig,
				);
			} else if (
				!session ||
				session.attachedViaHub ||
				shouldUpdateSessionConnection(session.config, nextConfig)
			) {
				await manager.updateSessionConnection(
					sessionId,
					buildSessionConnectionUpdate(nextConfig),
				);
			}
			if (session) {
				session.config = nextConfig;
				if (providerChanged) {
					session.attachedViaHub = false;
				}
			}
		}

		const userFiles = materializeUserFiles(
			sessionId,
			request.attachments?.userFiles,
		);
		if (session?.attachedViaHub) {
			// Once ClineCore sends a turn, its HubRuntimeHost owns the session
			// subscription. Stop projecting the observer stream as well or every
			// assistant/tool update (including command chunks) is emitted twice.
			session.attachedViaHub = false;
		}
		if (delivery === "queue") {
			if (session) {
				session.prompt = prompt;
			}
			await manager.send({
				sessionId,
				prompt: runtimePrompt,
				delivery: "queue",
				userImages: request.attachments?.userImages,
				userFiles,
			});
			const prompts = await manager.pendingPrompts.list({ sessionId });
			trackQueuedAttachments(session, prompts, userFiles);
			return {
				sessionId,
				ok: true,
				queued: true,
				// Response snapshot only — deliberately not routed through
				// applyPendingPrompts. The list was taken at enqueue time and
				// can already be stale when this response is written (the
				// runtime may have drained the prompt meanwhile, e.g. the
				// coerced first prompt of a fresh session); overwriting the
				// event-maintained session.promptsInQueue and rebroadcasting
				// prompts_in_queue_state here would resurrect a phantom queue
				// entry for every connected webview.
				promptsInQueue: prompts
					.map(mapPendingPrompt)
					.filter((item) => item.id)
					.map(({ id, prompt, steer, attachmentCount }) => ({
						id,
						prompt,
						steer,
						attachmentCount,
					})),
			};
		}

		ctx.logger?.debug("Sending desktop chat prompt", {
			sessionId,
			promptLength: prompt.length,
			delivery,
		});
		let result: Awaited<ReturnType<ClineCore["send"]>>;
		try {
			result = await manager.send({
				sessionId,
				prompt: runtimePrompt,
				delivery,
				userImages: request.attachments?.userImages,
				userFiles,
			});
		} catch (error) {
			deleteMaterializedAttachments(sessionId, userFiles);
			throw error;
		}
		if (result === undefined) {
			// The runtime queued or steered the prompt instead of running it
			// (busy interactive session / steer delivery) — track the files so
			// they are deleted once the prompt is consumed or discarded.
			if (userFiles?.length) {
				trackQueuedAttachments(
					session,
					await manager.pendingPrompts.list({ sessionId }),
					userFiles,
				);
			}
		} else {
			deleteMaterializedAttachments(sessionId, userFiles);
		}
		ctx.logger?.log("Desktop chat prompt completed", {
			sessionId,
			finishReason: result?.finishReason,
			textLength: result?.text?.length ?? 0,
		});
		if (session && ownsBusyState) {
			session.status = "idle";
			if (result?.messages) session.messages = result.messages;
		}
		return {
			sessionId,
			ok: true,
			result: result
				? {
						text: result.text,
						finishReason: result.finishReason,
						messages: result.messages,
						usage: result.usage,
						iterations: result.iterations,
						toolCalls: result.toolCalls,
					}
				: undefined,
		};
	} catch (error) {
		ctx.logger?.error?.("Desktop chat prompt failed", { sessionId, error });
		if (session && ownsBusyState) {
			session.status = "error";
		}
		emitChunk(
			ctx,
			sessionId,
			"chat_core_log",
			JSON.stringify({
				level: "error",
				message: error instanceof Error ? error.message : String(error),
			}),
		);
		return {
			sessionId,
			ok: true,
			result: {
				finishReason: "error",
				text: error instanceof Error ? error.message : String(error),
			},
		};
	} finally {
		if (session) {
			if (ownsBusyState) {
				session.busy = false;
			}
			if (providerChanged) {
				session.transitioningProvider = false;
			}
		}
	}
}

async function handleStop(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	const sessionId = request.sessionId?.trim();
	if (!sessionId) throw new Error("sessionId is required");
	await getSessionManager(ctx).stop(sessionId);
	const session = ctx.liveSessions.get(sessionId);
	if (session) {
		session.busy = false;
		session.status = "stopped";
	}
	return { sessionId, ok: true };
}

async function handleAbort(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	const sessionId = request.sessionId?.trim();
	if (!sessionId) throw new Error("sessionId is required");
	await getSessionManager(ctx).abort(sessionId, "user_abort");
	const session = ctx.liveSessions.get(sessionId);
	if (session) {
		session.busy = false;
		session.status = "aborted";
	}
	return { sessionId, ok: true };
}

async function handleFork(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	const sourceSessionId = request.sessionId?.trim();
	if (!sourceSessionId) throw new Error("sessionId is required");
	const forkBeforeRunCount = request.forkBeforeRunCount;
	if (
		forkBeforeRunCount !== undefined &&
		(!Number.isInteger(forkBeforeRunCount) || forkBeforeRunCount < 1)
	) {
		throw new Error("forkBeforeRunCount must be a positive integer");
	}
	const manager = getSessionManager(ctx);
	const liveSourceSession = ctx.liveSessions.get(sourceSessionId);
	if (
		forkBeforeRunCount !== undefined &&
		liveSourceSession &&
		hasActiveWorkspaceTurn(liveSourceSession)
	) {
		throw new Error(WORKSPACE_RESTORE_BUSY_ERROR);
	}
	const sourceSession = await manager.get(sourceSessionId);
	if (
		forkBeforeRunCount !== undefined &&
		(sourceSession?.status === "running" || sourceSession?.status === "pending")
	) {
		throw new Error(WORKSPACE_RESTORE_BUSY_ERROR);
	}
	if (forkBeforeRunCount === undefined) {
		return handleForkUnlocked(
			ctx,
			request,
			sourceSessionId,
			forkBeforeRunCount,
			sourceSession,
		);
	}
	const restoreWorkspacePath =
		readWorkspacePath(sourceSession) ??
		readWorkspacePath(liveSourceSession?.config) ??
		readWorkspacePath(request.config);
	if (!restoreWorkspacePath) {
		throw new Error("cwd or workspaceRoot is required to edit a message");
	}
	return withWorkspaceRestoreLock(ctx, restoreWorkspacePath, () =>
		handleForkUnlocked(
			ctx,
			request,
			sourceSessionId,
			forkBeforeRunCount,
			sourceSession,
			restoreWorkspacePath,
		),
	);
}

async function handleForkUnlocked(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
	sourceSessionId: string,
	forkBeforeRunCount: number | undefined,
	sourceSession: SessionRecord | undefined,
	restoreWorkspacePath?: string,
): Promise<unknown> {
	const manager = getSessionManager(ctx);
	const sourceMessages =
		readPersistedChatMessages(sourceSessionId) ??
		ctx.liveSessions.get(sourceSessionId)?.messages;
	if (!sourceMessages?.length) {
		throw new Error(`No messages found for session ${sourceSessionId}`);
	}

	const sourceMetadata =
		(sourceSession?.metadata && typeof sourceSession.metadata === "object"
			? (sourceSession.metadata as JsonRecord)
			: undefined) ?? readSessionMetadata(sourceSessionId);
	const liveConfig = ctx.liveSessions.get(sourceSessionId)?.config;
	const forkConfig: JsonRecord = {
		...(liveConfig ?? {}),
		...(request.config ?? {}),
		sessionId: undefined,
		provider:
			sourceSession?.provider ||
			liveConfig?.provider ||
			request.config?.provider ||
			request.config?.providerId ||
			"",
		model:
			sourceSession?.model ||
			liveConfig?.model ||
			request.config?.model ||
			request.config?.modelId ||
			"",
		cwd:
			sourceSession?.cwd ||
			sourceSession?.workspaceRoot ||
			liveConfig?.cwd ||
			request.config?.cwd ||
			request.config?.workspaceRoot ||
			request.config?.workspace_root ||
			"",
		workspaceRoot:
			sourceSession?.workspaceRoot ||
			sourceSession?.cwd ||
			liveConfig?.workspaceRoot ||
			request.config?.workspaceRoot ||
			request.config?.workspace_root ||
			request.config?.cwd ||
			"",
	};
	const checkpointMetadata =
		sourceMetadata?.checkpoint !== undefined
			? { checkpoints: sourceMetadata.checkpoint }
			: {};
	let forkMessages =
		forkBeforeRunCount === undefined
			? sourceMessages
			: trimMessagesBeforeUserRun(sourceMessages, forkBeforeRunCount);
	const forkMetadata: JsonRecord = {
		...(sourceMetadata ?? {}),
		fork: {
			forkedFromSessionId: sourceSessionId,
			forkedAt: new Date().toISOString(),
			source: sourceSession?.source ?? "desktop",
			...(forkBeforeRunCount !== undefined
				? { beforeRunCount: forkBeforeRunCount }
				: {}),
			...checkpointMetadata,
		},
	};
	const systemPrompt = await resolveSystemPrompt(forkConfig);
	const startInput = {
		...splitCoreSessionConfig(
			buildCoreSessionConfig({
				...forkConfig,
				systemPrompt,
			}) as unknown as ClineCoreStartConfig,
		),
		source: SessionSource.DESKTOP,
		interactive: true,
		sessionMetadata: forkMetadata,
		toolPolicies: resolveToolPolicies(forkConfig),
	};
	let newSessionId: string;
	if (forkBeforeRunCount !== undefined) {
		const cwd =
			restoreWorkspacePath ||
			(typeof forkConfig.cwd === "string" && forkConfig.cwd.trim()) ||
			(typeof forkConfig.workspaceRoot === "string" &&
				forkConfig.workspaceRoot.trim()) ||
			"";
		if (!cwd) {
			throw new Error("cwd or workspaceRoot is required to edit a message");
		}
		const restored = await manager.restore({
			sessionId: sourceSessionId,
			checkpointRunCount: forkBeforeRunCount,
			cwd,
			restore: {
				messages: true,
				workspace: true,
				omitCheckpointMessageFromSession: true,
			},
			start: startInput,
		});
		if (!restored.sessionId) {
			throw new Error("Message edit restore did not return a new session");
		}
		newSessionId = restored.sessionId;
	} else {
		const started = await manager.start({
			...startInput,
			initialMessages: forkMessages,
		});
		newSessionId = started.sessionId;
	}
	try {
		const read = await manager.readMessages(newSessionId);
		if (forkBeforeRunCount !== undefined || read.length > 0) {
			forkMessages = read;
		}
	} catch {}
	discardAllTrackedAttachments(
		sourceSessionId,
		ctx.liveSessions.get(sourceSessionId),
	);
	ctx.liveSessions.delete(sourceSessionId);
	ctx.liveSessions.set(
		newSessionId,
		createLiveSession(forkConfig, {
			messages: forkMessages,
			prompt: derivePromptFromMessages(forkMessages),
			title: readSessionMetadataTitle(sourceSessionId),
			status: "idle",
		}),
	);
	sendPromptsInQueueSnapshot(ctx, sourceSessionId);
	sendPromptsInQueueSnapshot(ctx, newSessionId);
	return {
		sessionId: newSessionId,
		forkedFromSessionId: sourceSessionId,
	};
}

async function handleReset(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	const sessionId = request.sessionId?.trim();
	if (sessionId) {
		const session = ctx.liveSessions.get(sessionId);
		if (
			session?.busy ||
			session?.status === "starting" ||
			session?.status === "running" ||
			session?.status === "stopping"
		) {
			await getSessionManager(ctx).stop(sessionId);
		}
		discardAllTrackedAttachments(sessionId, session);
		ctx.liveSessions.delete(sessionId);
		sendPromptsInQueueSnapshot(ctx, sessionId);
	}
	return { sessionId: request.sessionId, ok: true };
}

async function handleRestoreCheckpoint(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	const sourceSessionId = request.sessionId?.trim();
	if (!sourceSessionId) throw new Error("sessionId is required");
	const runCount = request.checkpointRunCount;
	if (
		typeof runCount !== "number" ||
		!Number.isInteger(runCount) ||
		runCount < 1
	)
		throw new Error("checkpointRunCount must be a positive integer");
	const config = request.config;
	if (!config) throw new Error("config is required to restore a checkpoint");
	const cwd =
		(typeof config.cwd === "string" && config.cwd.trim()) ||
		(typeof config.workspaceRoot === "string" && config.workspaceRoot.trim()) ||
		"";
	if (!cwd) throw new Error("config.cwd or config.workspaceRoot is required");
	const manager = getSessionManager(ctx);
	return withWorkspaceRestoreLock(ctx, cwd, async () => {
		const restored = await manager.restore({
			sessionId: sourceSessionId,
			checkpointRunCount: runCount,
			cwd,
			restore: { messages: true, workspace: true },
			start: {
				...splitCoreSessionConfig(
					buildCoreSessionConfig({
						...config,
						systemPrompt: await resolveSystemPrompt(config),
					}) as unknown as ClineCoreStartConfig,
				),
				source: SessionSource.DESKTOP,
				interactive: true,
				toolPolicies: resolveToolPolicies(config),
			},
		});
		const sessionId = restored.sessionId;
		const restoredMessages = restored.messages;
		if (!sessionId || !restoredMessages) {
			throw new Error("Checkpoint restore did not return a new session");
		}
		discardAllTrackedAttachments(
			sourceSessionId,
			ctx.liveSessions.get(sourceSessionId),
		);
		ctx.liveSessions.delete(sourceSessionId);
		ctx.liveSessions.set(
			sessionId,
			createLiveSession(config, {
				messages: restoredMessages,
				prompt: derivePromptFromMessages(restoredMessages),
				title: readSessionMetadataTitle(sourceSessionId),
				status: "idle",
			}),
		);
		// A restore that reuses the source session id leaves the persisted
		// transcript describing the discarded turns, and read_session_messages
		// prefers that file over the live session. Write the trimmed history so
		// the transcript matches the workspace the restore just rolled back to.
		persistSessionMessages(sessionId, restoredMessages);
		sendPromptsInQueueSnapshot(ctx, sourceSessionId);
		sendPromptsInQueueSnapshot(ctx, sessionId);
		return {
			sessionId,
			restoredCheckpoint: restored.checkpoint,
		};
	});
}

async function handlePendingPrompts(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	const sessionId = request.sessionId?.trim();
	if (!sessionId) throw new Error("sessionId is required");
	const prompts = await getSessionManager(ctx).pendingPrompts.list({
		sessionId,
	});
	return {
		sessionId,
		promptsInQueue: applyPendingPrompts(ctx, sessionId, prompts),
	};
}

async function handleSteerPrompt(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	const sessionId = request.sessionId?.trim();
	const promptId = request.promptId?.trim();
	if (!sessionId || !promptId)
		throw new Error("sessionId and promptId are required");
	const manager = getSessionManager(ctx);
	const result = await manager.pendingPrompts.update({
		sessionId,
		promptId,
		delivery: "steer",
	});
	return {
		sessionId,
		updated: result.updated === true,
		promptsInQueue: applyPendingPrompts(ctx, sessionId, result.prompts),
	};
}

async function handleUpdatePendingPrompt(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	const sessionId = request.sessionId?.trim();
	const promptId = request.promptId?.trim();
	const prompt = request.prompt?.trim();
	if (!sessionId || !promptId) {
		throw new Error("sessionId and promptId are required");
	}
	if (!prompt) {
		throw new Error("prompt is required");
	}
	const manager = getSessionManager(ctx);
	const sessionConfig = ctx.liveSessions.get(sessionId)?.config;
	// Queued prompts are delivered by the runtime without another pass
	// through handleSend, so resolve slash commands here too.
	const runtimePrompt = await resolveDesktopRuntimePrompt(
		ctx,
		readWorkspacePath(sessionConfig) ?? ctx.workspaceRoot,
		prompt,
		sessionConfig?.mode,
	);
	const result = await manager.pendingPrompts.update({
		sessionId,
		promptId,
		prompt: runtimePrompt,
	});
	return {
		sessionId,
		updated: result.updated === true,
		prompt: result.prompt ? mapPendingPrompt(result.prompt) : undefined,
		promptsInQueue: applyPendingPrompts(ctx, sessionId, result.prompts),
	};
}

async function handleRemovePendingPrompt(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	const sessionId = request.sessionId?.trim();
	const promptId = request.promptId?.trim();
	if (!sessionId || !promptId) {
		throw new Error("sessionId and promptId are required");
	}
	const manager = getSessionManager(ctx);
	const result = await manager.pendingPrompts.delete({
		sessionId,
		promptId,
	});
	if (result.removed === true) {
		deleteMaterializedAttachments(sessionId, result.prompt?.userFiles);
		ctx.liveSessions.get(sessionId)?.queuedAttachmentFiles?.delete(promptId);
	}
	return {
		sessionId,
		removed: result.removed === true,
		prompt: result.prompt ? mapPendingPrompt(result.prompt) : undefined,
		promptsInQueue: applyPendingPrompts(ctx, sessionId, result.prompts),
	};
}

// ---------------------------------------------------------------------------
// Action dispatch
// ---------------------------------------------------------------------------

const ACTION_HANDLERS: Record<
	string,
	(ctx: SidecarContext, req: ChatSessionCommandRequest) => Promise<unknown>
> = {
	start: handleStart,
	attach: handleAttach,
	send: handleSend,
	stop: handleStop,
	abort: handleAbort,
	fork: handleFork,
	reset: handleReset,
	restore_checkpoint: handleRestoreCheckpoint,
	pending_prompts: handlePendingPrompts,
	steer_prompt: handleSteerPrompt,
	update_pending_prompt: handleUpdatePendingPrompt,
	remove_pending_prompt: handleRemovePendingPrompt,
};

export async function handleChatSessionCommand(
	ctx: SidecarContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	const handler = ACTION_HANDLERS[request.action];
	if (!handler) throw new Error("unsupported action");
	return handler(ctx, request);
}
