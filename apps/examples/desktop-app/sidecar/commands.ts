import { execFile, spawn } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type {
	ClineAccountActionRequest,
	CoreSettingsSnapshot,
	ProviderCapability,
	ProviderClient,
	ProviderConfig,
	ProviderProtocol,
	SaveProviderSettingsActionRequest,
} from "@cline/core";
import {
	addLocalProvider,
	ClineAccountService,
	captureAuthRefreshSoftFailure,
	createConfiguredStreamingTranscriptionSession,
	createUserInstructionConfigService,
	ensureCustomProvidersLoaded,
	executeClineAccountAction,
	fetchClineRecommendedModels,
	getCoreBuiltinToolCatalog,
	getLocalProviderModels,
	listHookConfigFiles,
	listLocalProviders,
	normalizeOAuthProvider,
	ProviderSettingsManager,
	parseMcpServerRegistration,
	probeMcpServerConnection,
	RuntimeOAuthTokenManager,
	readGlobalSettings,
	resolveLocalClineAuthToken,
	resolveMcpServerRegistration,
	resolveSessionBackend,
	resolveAgentConfigSearchPaths as resolveSharedAgentConfigSearchPaths,
	SqliteSessionStore,
	saveLocalProviderSettings,
	saveVoiceInputSettings,
	setAutoUpdateEnabledGlobally,
	setMcpServerDisabled,
	setModelToolEnabledGlobally,
	setTelemetryOptOutGlobally,
	transcribeConfiguredVoiceInput,
	updateLocalProvider,
	updateMcpSettingsFileSync,
} from "@cline/core";
import { resolveAudioTranscriptionRoute } from "@cline/llms";
import {
	CLINE_DEFAULT_MODEL_ID,
	getClineEnvironmentConfig,
	isCanonicalBase64,
	ONE_TIME_SCHEDULE_CRON_PATTERN,
	ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY,
	readHubScheduleMode,
} from "@cline/shared";
import { readFileSyncStrippingUtf8Bom } from "@cline/shared/node";
import packageJson from "../package.json";
import { CLINE_ACCOUNT_NOT_AUTHENTICATED_RESULT } from "../webview/lib/cline-account-state";
import { MAX_RECORDED_AUDIO_BYTES } from "../webview/lib/voice-input-limits";
import {
	connectorChannelsPayload,
	startConnectorChannel,
	stopConnectorChannel,
} from "./connectors";
import {
	broadcastEvent,
	ensureSharedHubClient,
	resolveSidecarAskQuestion,
	sendEventToClient,
} from "./context";
import {
	identifyDesktopFeatureFlagsAccount,
	refreshDesktopFeatureFlags,
} from "./feature-flags";
import {
	installMarketplaceEntryForDesktopCommand,
	listMarketplaceInstalledEntries,
	uninstallLocalPrimitive,
	uninstallMarketplaceEntryForDesktopCommand,
} from "./marketplace";
import {
	ensureMcpSettingsFile,
	readMcpServersResponse,
	shouldProbeMcpServerAfterUpsert,
} from "./mcp";
import {
	cancelMcpOAuthAuthorizationForReason,
	McpOAuthAuthorizationCancelledError,
	runCancellableMcpOAuthAuthorization,
	shouldRestoreEnabledStateAfterOAuthCancellation,
} from "./mcp-oauth";
import {
	cancelProviderOAuthLogin,
	runCancellableProviderOAuthLogin,
} from "./oauth-login";
import {
	findArtifactUnderDir,
	readSessionManifest,
	resolveMcpSettingsPath,
	rootSessionIdFrom,
	sessionLogPath,
	sharedSessionDataDir,
} from "./paths";
import { listSessionAgents } from "./session-data/agents";
import { readSessionHooks } from "./session-data/artifacts";
import { normalizeSessionTitle } from "./session-data/common";
import { discoverChatSessions } from "./session-data/discovery";
import { readSessionMessages } from "./session-data/messages";
import { searchWorkspaceFiles } from "./session-data/search";
import type {
	ChatSessionCommandRequest,
	JsonRecord,
	SidecarContext,
	SidecarWebSocketClient,
} from "./types";
import { pickWorkspaceDirectory } from "./workspace-picker";

// All child processes in this module run asynchronously: the sidecar is a
// single event loop shared by every UI command and streaming chat session, so
// a synchronous exec (git, folder picker, editor discovery) freezes the whole
// app until the child exits.
const execFileAsync = promisify(execFile);
type DesktopDebugLogLevel = "debug" | "info" | "error";

function sanitizeDiagnosticUrl(value: string | undefined): string | undefined {
	if (!value) return undefined;
	try {
		const url = new URL(value);
		url.username = "";
		url.password = "";
		url.search = "";
		url.hash = "";
		return url.toString();
	} catch {
		return "[invalid URL]";
	}
}

function sanitizeDiagnosticFailure(
	error: unknown,
	providerConfig: ProviderConfig | undefined,
): string {
	let message = error instanceof Error ? error.message : String(error);
	const sanitizedBaseUrl = sanitizeDiagnosticUrl(providerConfig?.baseUrl);
	if (providerConfig?.baseUrl && sanitizedBaseUrl) {
		message = message.replaceAll(providerConfig.baseUrl, sanitizedBaseUrl);
	}
	const secrets = [
		providerConfig?.apiKey,
		providerConfig?.accessToken,
		...Object.values(providerConfig?.headers ?? {}),
	];
	for (const secret of secrets) {
		const value = secret?.trim();
		if (value) {
			message = message.replaceAll(value, "[redacted]");
		}
	}
	return message;
}

function emitDesktopDebugLog(
	ctx: SidecarContext,
	level: DesktopDebugLogLevel,
	message: string,
	metadata?: Record<string, unknown>,
): void {
	if (level === "error") {
		ctx.logger?.error?.(message, metadata);
	} else if (level === "info") {
		ctx.logger?.log(message, metadata);
	} else {
		ctx.logger?.debug(message, metadata);
	}
	broadcastEvent(ctx, "desktop_debug_log", {
		scope: "voice-input",
		level,
		message,
		timestamp: new Date().toISOString(),
		metadata,
	});
}

// Strict allowlist: the opener hands the URL to the OS protocol handler, so
// anything broader (file:, custom app schemes) would let webview content
// launch arbitrary local handlers.
const OPENABLE_URL_PROTOCOLS = new Set(["https:", "http:", "mailto:", "tel:"]);

function openUrlInDefaultBrowser(url: string): Promise<void> {
	const platform = process.platform;
	// On Windows the URL must not pass through cmd.exe: `cmd /c start <url>`
	// re-parses metacharacters (&, ^, |) that are valid inside http(s) URLs,
	// turning a crafted URL into command execution. rundll32 hands the URL
	// straight to the protocol handler with no shell parsing.
	const spawned =
		platform === "darwin"
			? spawn("open", [url], { stdio: "ignore", detached: true })
			: platform === "win32"
				? spawn("rundll32", ["url.dll,FileProtocolHandler", url], {
						stdio: "ignore",
						detached: true,
					})
				: spawn("xdg-open", [url], {
						stdio: "ignore",
						detached: true,
					});
	// A missing opener binary emits an async "error" event; without a listener
	// it becomes an uncaught exception that kills the sidecar. Launchers hand
	// off to the browser and exit quickly, so a fast non-zero exit means the
	// handoff failed (xdg-open exits 3 when no handler is available; rundll32
	// exits 0 even on failure, so Windows stays best-effort). If the launcher
	// is still running after the grace window, assume the handoff worked
	// rather than blocking on a launcher that lingers.
	return new Promise((resolve, reject) => {
		const graceTimer = setTimeout(resolve, 2_000);
		spawned.once("spawn", () => {
			spawned.unref();
		});
		spawned.once("error", (error) => {
			clearTimeout(graceTimer);
			reject(new Error(`could not open browser: ${error.message}`));
		});
		spawned.once("exit", (code) => {
			clearTimeout(graceTimer);
			if (code === 0 || code === null) {
				resolve();
			} else {
				reject(new Error(`browser opener exited with code ${code}`));
			}
		});
	});
}

function readProviderSettingsUpdate(
	args: Record<string, unknown> | undefined,
): Partial<Omit<SaveProviderSettingsActionRequest, "action" | "providerId">> {
	return args?.settings && typeof args.settings === "object"
		? (args.settings as Partial<
				Omit<SaveProviderSettingsActionRequest, "action" | "providerId">
			>)
		: {};
}

/**
 * Transport type + URL a server record actually points at, tolerating both
 * the nested `transport` shape and legacy flat fields (mirrors
 * readMcpServersResponse).
 */
function mcpTransportIdentity(name: string, record: JsonRecord): string {
	try {
		const resolved = parseMcpServerRegistration(name, record).transport;
		return resolved.type === "stdio"
			? "stdio\u0000"
			: `${resolved.type}\u0000${resolved.url}`;
	} catch {
		// Preserve a best-effort identity for malformed entries so the editor can
		// still repair them without requiring the entire settings file to parse.
	}
	const transport =
		record.transport && typeof record.transport === "object"
			? (record.transport as JsonRecord)
			: undefined;
	const url =
		typeof transport?.url === "string"
			? transport.url
			: typeof record.url === "string"
				? record.url
				: "";
	// Core's config-loader defaults a URL-based legacy record with no explicit
	// type to SSE and maps the legacy "http" alias to streamableHttp; mirror
	// both so an unchanged endpoint keeps the same identity.
	const rawType = transport?.type ?? record.transportType ?? record.type;
	const type = String(rawType ?? (url ? "sse" : "stdio")).trim();
	const normalizedType = type === "http" ? "streamableHttp" : type;
	return `${normalizedType}\u0000${url}`;
}

function removePathIfExists(
	path: string,
	options?: { recursive?: boolean },
): boolean {
	if (!path || !existsSync(path)) {
		return false;
	}
	rmSync(path, {
		force: true,
		recursive: options?.recursive === true,
	});
	return true;
}

// Cline access tokens expire between app launches, so account requests must
// resolve through the refresh-aware OAuth manager instead of reading the
// persisted token directly. A single shared instance keeps concurrent account
// requests single-flight; the refresh token is single-use, so parallel
// refreshes would invalidate each other.
let clineOAuthTokenManager: RuntimeOAuthTokenManager | undefined;

function syncFeatureFlagsAccountFromResult(
	ctx: SidecarContext,
	operation: string,
	result: unknown,
): void {
	if (operation === "fetchMe") {
		const user = result as { id?: string; email?: string } | undefined;
		if (user?.id) {
			void identifyDesktopFeatureFlagsAccount(
				{ id: user.id, email: user.email },
				{ logger: ctx.logger, telemetry: ctx.telemetry },
			);
		}
		return;
	}
}

function syncFeatureFlagsAccountFromSettings(
	ctx: SidecarContext,
	manager: ProviderSettingsManager,
): void {
	void identifyDesktopFeatureFlagsAccount(
		{ id: manager.getProviderSettings("cline")?.auth?.accountId },
		{ logger: ctx.logger, telemetry: ctx.telemetry },
	);
}

async function resolveFreshClineAuthToken(
	ctx: SidecarContext,
	manager: ProviderSettingsManager,
): Promise<string | undefined> {
	let refreshError: Error | undefined;
	try {
		clineOAuthTokenManager ??= new RuntimeOAuthTokenManager();
		const resolution = await clineOAuthTokenManager.resolveProviderApiKey({
			providerId: "cline",
		});
		if (resolution?.apiKey) {
			return resolution.apiKey;
		}
	} catch (error) {
		// Fall back to the persisted token; when one exists the account request
		// surfaces the auth failure to the caller.
		refreshError = error instanceof Error ? error : new Error(String(error));
	}
	const persisted = resolveLocalClineAuthToken(
		manager.getProviderSettings("cline"),
	);
	// Never-signed-in resolves to undefined without a refresh attempt and is
	// silent. A refresh failure with no persisted fallback means credentials
	// existed but yielded nothing — that is the signal a real auth regression
	// would show up as, so report exactly one event for it.
	if (!persisted && refreshError) {
		ctx.logger?.error?.("Cline auth token refresh failed with no fallback", {
			error: refreshError,
		});
		captureAuthRefreshSoftFailure(ctx.telemetry, "cline", {
			errorName: refreshError.name,
			errorCode: "desktop_refresh_failed_no_fallback_token",
		});
	}
	return persisted;
}

function mergePersistedSessionRecord(
	store: SqliteSessionStore,
	sessionId: string,
	record: JsonRecord,
): JsonRecord {
	const persisted = store.get(sessionId) as unknown as JsonRecord | undefined;
	const metadata =
		record.metadata && typeof record.metadata === "object"
			? (record.metadata as JsonRecord)
			: undefined;
	return {
		...(persisted ?? {}),
		...record,
		sessionId,
		provider: record.provider ?? persisted?.provider ?? "",
		model: record.model ?? persisted?.model ?? "",
		cwd: record.cwd ?? persisted?.cwd ?? "",
		workspaceRoot:
			record.workspaceRoot ?? persisted?.workspaceRoot ?? persisted?.cwd ?? "",
		prompt: record.prompt ?? persisted?.prompt ?? metadata?.prompt,
		parentSessionId:
			record.parentSessionId ??
			persisted?.parentSessionId ??
			metadata?.parentSessionId,
		parentAgentId:
			record.parentAgentId ??
			persisted?.parentAgentId ??
			metadata?.parentAgentId,
		agentId: record.agentId ?? persisted?.agentId ?? metadata?.agentId,
		conversationId:
			record.conversationId ??
			persisted?.conversationId ??
			metadata?.conversationId,
		isSubagent: record.isSubagent ?? persisted?.isSubagent ?? false,
		startedAt: record.startedAt ?? persisted?.startedAt ?? record.createdAt,
		updatedAt: record.updatedAt ?? persisted?.updatedAt,
		metadata: {
			...((persisted?.metadata && typeof persisted.metadata === "object"
				? persisted.metadata
				: {}) as JsonRecord),
			...(metadata ?? {}),
		},
	};
}

async function getSessionFromSidecarManager(
	ctx: SidecarContext,
	sessionId: string,
): Promise<JsonRecord | undefined> {
	const store = new SqliteSessionStore();
	if (ctx.sessionManager) {
		const session = await ctx.sessionManager.get(sessionId);
		if (session) {
			return mergePersistedSessionRecord(
				store,
				sessionId,
				session as unknown as JsonRecord,
			);
		}
	}

	if (ctx.hubClient) {
		try {
			const reply = await ctx.hubClient.command(
				"session.get",
				undefined,
				sessionId,
			);
			const session = reply.payload?.session;
			if (session && typeof session === "object") {
				return mergePersistedSessionRecord(
					store,
					sessionId,
					session as JsonRecord,
				);
			}
		} catch {
			// Fall through to the local SQLite index.
		}
	}

	const persisted = store.get(sessionId) as unknown as JsonRecord | undefined;
	return persisted
		? mergePersistedSessionRecord(store, sessionId, persisted)
		: undefined;
}

async function listSessionsFromSidecarManager(
	ctx: SidecarContext,
	limit: number,
): Promise<unknown> {
	const max = Math.max(1, Math.floor(limit));
	if (ctx.sessionManager) {
		return await ctx.sessionManager.list(max, { hydrate: false });
	}

	const byId = new Map<string, JsonRecord>();
	const store = new SqliteSessionStore();

	if (ctx.hubClient) {
		try {
			const reply = await ctx.hubClient.command("session.list", { limit: max });
			const sessions = Array.isArray(reply.payload?.sessions)
				? reply.payload.sessions
				: [];
			for (const item of sessions) {
				if (!item || typeof item !== "object") continue;
				const record = item as JsonRecord;
				const sessionId = String(record.sessionId ?? "").trim();
				if (sessionId)
					byId.set(
						sessionId,
						mergePersistedSessionRecord(store, sessionId, record),
					);
			}
		} catch {
			// Fall through to the local SQLite index.
		}
	}

	if (byId.size === 0) {
		for (const session of store.list(max)) {
			byId.set(session.sessionId, session as unknown as JsonRecord);
		}
	}

	for (const [sessionId, session] of ctx.liveSessions.entries()) {
		const existing = byId.get(sessionId);
		byId.set(sessionId, {
			...(existing ?? {}),
			sessionId,
			status: session.status,
			provider: session.config.provider ?? existing?.provider ?? "",
			model: session.config.model ?? existing?.model ?? "",
			cwd: session.config.cwd ?? existing?.cwd ?? "",
			workspaceRoot:
				session.config.workspaceRoot ??
				existing?.workspaceRoot ??
				existing?.cwd ??
				"",
			prompt: session.prompt ?? existing?.prompt,
			startedAt:
				existing?.startedAt ?? new Date(session.startedAt).toISOString(),
			endedAt:
				session.endedAt !== undefined
					? new Date(session.endedAt).toISOString()
					: existing?.endedAt,
			metadata: {
				...((existing?.metadata && typeof existing.metadata === "object"
					? existing.metadata
					: {}) as JsonRecord),
				...(session.title ? { title: session.title } : {}),
			},
		});
	}

	return Array.from(byId.values())
		.sort((left, right) => {
			const leftTime = Date.parse(
				String(left.updatedAt ?? left.startedAt ?? ""),
			);
			const rightTime = Date.parse(
				String(right.updatedAt ?? right.startedAt ?? ""),
			);
			return (
				(Number.isNaN(rightTime) ? 0 : rightTime) -
				(Number.isNaN(leftTime) ? 0 : leftTime)
			);
		})
		.slice(0, max);
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

async function listGitBranches(
	ctx: SidecarContext,
	cwd?: string,
): Promise<{ current?: string; branches?: string[] }> {
	const targetCwd = cwd?.trim() || ctx.workspaceRoot;
	const [currentResult, branchesResult] = await Promise.all([
		execFileAsync("git", ["branch", "--show-current"], {
			cwd: targetCwd,
			encoding: "utf8",
		}).catch(() => undefined),
		execFileAsync(
			"git",
			["for-each-ref", "--format=%(refname:short)", "refs/heads"],
			{
				cwd: targetCwd,
				encoding: "utf8",
			},
		).catch(() => undefined),
	]);
	const current = currentResult?.stdout.trim() ?? "";
	const branches = (branchesResult?.stdout ?? "")
		.split("\n")
		.map((v) => v.trim())
		.filter(Boolean);
	return { current: current || undefined, branches };
}

// ---------------------------------------------------------------------------
// Routine schedule helpers (in-process via shared hub server)
// ---------------------------------------------------------------------------

function toPositiveInt(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	const rounded = Math.trunc(value);
	return rounded > 0 ? rounded : undefined;
}

function routineScheduleTiming(
	args?: Record<string, unknown>,
): { cronPattern: string; metadata?: Record<string, number> } | undefined {
	if (args?.schedule_type === "once") {
		const runAt =
			typeof args.run_at === "number" ? args.run_at : Number(args?.run_at);
		return Number.isFinite(runAt)
			? {
					cronPattern: ONE_TIME_SCHEDULE_CRON_PATTERN,
					metadata: { [ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY]: runAt },
				}
			: undefined;
	}
	const cronPattern = asTrimmedString(args?.cron_pattern);
	return cronPattern ? { cronPattern } : undefined;
}

function asTrimmedString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function asTrimmedStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const values = value
		.map((item) => asTrimmedString(item))
		.filter((item): item is string => item !== undefined);
	return values.length > 0 ? values : undefined;
}

async function handleRoutineScheduleCommand(
	ctx: SidecarContext,
	command: string,
	args?: Record<string, unknown>,
): Promise<unknown> {
	const hubClient = await ensureSharedHubClient(ctx);
	const clientCommand = async (
		hubCommand: string,
		payload?: Record<string, unknown>,
	) => {
		const reply = await hubClient.command(hubCommand as never, payload);
		if (!reply.ok) {
			throw new Error(
				reply.error?.message ?? `hub command failed: ${hubCommand}`,
			);
		}
		return (reply.payload ?? {}) as Record<string, unknown>;
	};
	if (command === "list_routine_schedules") {
		const [schedules, activeExecutions, upcomingRuns, lastExecutions] =
			await Promise.all([
				clientCommand("schedule.list", {
					limit: toPositiveInt(args?.limit) ?? 200,
				}),
				clientCommand("schedule.active"),
				clientCommand("schedule.upcoming", { limit: 30 }),
				clientCommand("schedule.list_executions", { limit: 50 }),
			]);
		const scheduleRecords = (schedules.schedules ?? []) as JsonRecord[];
		const executionRecords = (lastExecutions.executions ?? []) as JsonRecord[];
		// The bulk query returns the newest executions across ALL schedules,
		// so a few chatty schedules can evict everyone else's latest run.
		// Backfill the latest execution for schedules that have run
		// (lastRunAt set) but fell out of that window.
		const covered = new Set<string>();
		for (const execution of executionRecords) {
			if (typeof execution.scheduleId === "string") {
				covered.add(execution.scheduleId);
			}
		}
		const missing = scheduleRecords.filter(
			(schedule) =>
				typeof schedule.scheduleId === "string" &&
				schedule.lastRunAt != null &&
				!covered.has(schedule.scheduleId),
		);
		const concurrency = 8;
		for (let index = 0; index < missing.length; index += concurrency) {
			const chunk = missing.slice(index, index + concurrency);
			const replies = await Promise.all(
				chunk.map((schedule) =>
					clientCommand("schedule.list_executions", {
						scheduleId: schedule.scheduleId,
						limit: 1,
					}).catch(() => undefined),
				),
			);
			for (const reply of replies) {
				const executions = (reply?.executions ?? []) as JsonRecord[];
				if (executions[0]) {
					executionRecords.push(executions[0]);
				}
			}
		}
		return {
			schedules: scheduleRecords,
			activeExecutions: activeExecutions.executions ?? [],
			upcomingRuns: upcomingRuns.runs ?? [],
			lastExecutions: executionRecords,
		};
	}
	if (command === "create_routine_schedule") {
		const name = asTrimmedString(args?.name);
		const timing = routineScheduleTiming(args);
		const prompt = asTrimmedString(args?.prompt);
		const workspaceRoot = asTrimmedString(args?.workspace_root);
		if (!name || !timing || !prompt || !workspaceRoot) {
			throw new Error(
				"createSchedule requires name, timing, prompt, and workspace_root",
			);
		}
		const created = await clientCommand("schedule.create", {
			name,
			...timing,
			prompt,
			modelSelection: {
				providerId: asTrimmedString(args?.provider) ?? "cline",
				modelId: asTrimmedString(args?.model) ?? CLINE_DEFAULT_MODEL_ID,
			},
			mode: readHubScheduleMode(args, "yolo"),
			workspaceRoot,
			cwd: asTrimmedString(args?.cwd),
			systemPrompt: asTrimmedString(args?.system_prompt),
			maxIterations: toPositiveInt(args?.max_iterations),
			timeoutSeconds: toPositiveInt(args?.timeout_seconds),
			maxParallel: toPositiveInt(args?.max_parallel) ?? 1,
			enabled: args?.enabled !== false,
			tags: asTrimmedStringArray(args?.tags),
		});
		return { schedule: created.schedule ?? null };
	}
	const scheduleId = asTrimmedString(args?.schedule_id);
	if (!scheduleId) throw new Error(`${command} requires schedule_id`);
	if (command === "update_routine_schedule") {
		const mode = readHubScheduleMode(args);
		const name = asTrimmedString(args?.name);
		const timing = routineScheduleTiming(args);
		const prompt = asTrimmedString(args?.prompt);
		const workspaceRoot = asTrimmedString(args?.workspace_root);
		if (!name || !timing || !prompt || !workspaceRoot) {
			throw new Error(
				"updateSchedule requires schedule_id, name, timing, prompt, and workspace_root",
			);
		}
		const reply = await clientCommand("schedule.update", {
			scheduleId,
			name,
			...timing,
			prompt,
			modelSelection: {
				providerId: asTrimmedString(args?.provider) ?? "cline",
				modelId: asTrimmedString(args?.model) ?? CLINE_DEFAULT_MODEL_ID,
			},
			...(mode === undefined ? {} : { mode }),
			workspaceRoot,
			cwd: asTrimmedString(args?.cwd) ?? null,
			systemPrompt:
				args?.system_prompt === null
					? null
					: asTrimmedString(args?.system_prompt),
			maxIterations:
				args?.max_iterations === null
					? null
					: toPositiveInt(args?.max_iterations),
			timeoutSeconds:
				args?.timeout_seconds === null
					? null
					: toPositiveInt(args?.timeout_seconds),
			maxParallel: toPositiveInt(args?.max_parallel) ?? 1,
			enabled: args?.enabled !== false,
			tags: asTrimmedStringArray(args?.tags) ?? [],
		});
		return { schedule: reply.schedule ?? null };
	}
	if (command === "pause_routine_schedule") {
		const reply = await clientCommand("schedule.disable", { scheduleId });
		return { schedule: reply.schedule ?? null };
	}
	if (command === "resume_routine_schedule") {
		const reply = await clientCommand("schedule.enable", { scheduleId });
		return { schedule: reply.schedule ?? null };
	}
	if (command === "trigger_routine_schedule") {
		// wait: false queues the run and returns immediately; the default
		// path blocks until the whole agent run finishes, which outlives the
		// webview's request timeout.
		const reply = await clientCommand("schedule.trigger", {
			scheduleId,
			wait: false,
		});
		return { execution: reply.execution ?? null };
	}
	if (command === "delete_routine_schedule") {
		const reply = await clientCommand("schedule.delete", { scheduleId });
		return { deleted: reply.deleted === true };
	}
	throw new Error(`unsupported routine schedule command: ${command}`);
}

// ---------------------------------------------------------------------------
// Agenda task queue helpers (in-process via shared hub server)
// ---------------------------------------------------------------------------

const AGENDA_TASK_COMMANDS = new Set([
	"task.create",
	"task.list",
	"task.get",
	"task.update",
	"task.approve",
	"task.cancel",
	"task.run",
	"task.automation.get",
	"task.automation.set",
]);

const AGENDA_TASK_EXECUTION_COMMANDS = new Set([
	"task.create",
	"task.approve",
	"task.cancel",
	"task.run",
	"task.automation.set",
]);

async function handleAgendaTaskCommand(
	ctx: SidecarContext,
	command: string,
	args?: Record<string, unknown>,
): Promise<unknown> {
	const hubClient = await ensureSharedHubClient(ctx);
	const reply = await hubClient.command(command as never, args);
	if (!reply.ok) {
		throw new Error(reply.error?.message ?? `hub command failed: ${command}`);
	}
	return reply.payload ?? {};
}

// ---------------------------------------------------------------------------
// User instruction config listing through the core config service.
// ---------------------------------------------------------------------------

function resolveAgentConfigSearchPaths(workspaceRoot?: string): string[] {
	return resolveSharedAgentConfigSearchPaths(workspaceRoot);
}

async function listHubSettings(
	ctx: SidecarContext,
): Promise<CoreSettingsSnapshot> {
	const hubClient = await ensureSharedHubClient(ctx);
	const reply = await hubClient.command("settings.list", {
		workspaceRoot: ctx.workspaceRoot,
		cwd: ctx.workspaceRoot,
	});
	if (!reply.ok) {
		throw new Error(
			reply.error?.message ?? "hub command failed: settings.list",
		);
	}
	return reply.payload?.snapshot as CoreSettingsSnapshot;
}

async function toggleHubSetting(
	ctx: SidecarContext,
	input: {
		type: "plugins" | "tools";
		path?: string;
		name?: string;
		enabled?: boolean;
	},
): Promise<CoreSettingsSnapshot> {
	const hubClient = await ensureSharedHubClient(ctx);
	const reply = await hubClient.command("settings.toggle", {
		...input,
		workspaceRoot: ctx.workspaceRoot,
		cwd: ctx.workspaceRoot,
	});
	if (!reply.ok) {
		throw new Error(
			reply.error?.message ?? "hub command failed: settings.toggle",
		);
	}
	return reply.payload?.snapshot as CoreSettingsSnapshot;
}

async function listUserInstructionConfigs(
	ctx: SidecarContext,
	settingsSnapshot?: CoreSettingsSnapshot,
): Promise<JsonRecord> {
	const workspaceRoot = ctx.workspaceRoot;
	const hubSettings = settingsSnapshot ?? (await listHubSettings(ctx));
	const warnings: string[] = [];
	const userInstructionService = createUserInstructionConfigService({
		skills: { workspacePath: workspaceRoot },
		rules: { workspacePath: workspaceRoot },
		workflows: { workspacePath: workspaceRoot },
	});

	const loadUserInstructionSnapshot = (
		type: "rule" | "skill" | "workflow",
	): unknown[] => {
		const items: unknown[] = [];
		for (const record of userInstructionService.listRecords(type)) {
			const item = record.item as unknown as JsonRecord;
			if (item.disabled === true) continue;
			items.push({
				id: record.id,
				name: item.name ?? record.id,
				description: item.description,
				instructions: item.instructions,
				path: record.filePath,
			});
		}
		return items;
	};

	const loadAgents = (): unknown[] => {
		const agentsById = new Map<string, { name: string; path: string }>();
		const directories = resolveAgentConfigSearchPaths(workspaceRoot).filter(
			(d) => existsSync(d),
		);
		for (const directory of directories) {
			try {
				for (const entry of readdirSync(directory, { withFileTypes: true })) {
					if (!entry.isFile()) continue;
					const ext = extname(entry.name).toLowerCase();
					if (ext !== ".yml" && ext !== ".yaml") continue;
					const filePath = join(directory, entry.name);
					const raw = readFileSyncStrippingUtf8Bom(filePath);
					const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
					const fm = fmMatch?.[1] ?? "";
					const nameMatch = fm.match(/^\s*name:\s*(.+?)\s*$/m);
					const parsedName = nameMatch?.[1]?.replace(/^["']|["']$/g, "").trim();
					const name =
						parsedName && parsedName.length > 0
							? parsedName
							: basename(entry.name, ext);
					const id = name.toLowerCase();
					if (!agentsById.has(id)) {
						agentsById.set(id, { name, path: filePath });
					}
				}
			} catch {
				// best-effort
			}
		}
		return [...agentsById.values()].sort((a, b) =>
			a.name.localeCompare(b.name),
		);
	};

	const loadHooks = (): unknown[] => {
		try {
			return listHookConfigFiles(workspaceRoot);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			warnings.push(`hooks: ${message}`);
			return [];
		}
	};

	try {
		await userInstructionService.start();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		warnings.push(`user instructions: ${message}`);
	}
	let rules: unknown[];
	let workflows: unknown[];
	let skills: unknown[];
	let runtimeCommands: ReturnType<
		typeof userInstructionService.listRuntimeCommands
	>;
	try {
		rules = loadUserInstructionSnapshot("rule");
		workflows = loadUserInstructionSnapshot("workflow");
		skills = loadUserInstructionSnapshot("skill");
		runtimeCommands = userInstructionService.listRuntimeCommands();
	} finally {
		userInstructionService.stop();
	}

	const disabledTools = new Set(readGlobalSettings().disabledTools ?? []);
	// Pin spawn/teams availability so this listing matches the hub's
	// (apps/cline-hub/src/server/user-instructions.ts) even if the preset
	// defaults change.
	const builtinToolCatalog = getCoreBuiltinToolCatalog({
		enableSpawnAgent: true,
		enableAgentTeams: true,
		disabledToolIds: disabledTools,
	});

	return {
		workspaceRoot,
		rules,
		workflows,
		skills,
		runtimeCommands,
		agents: loadAgents(),
		plugins: hubSettings.plugins.map((plugin) => ({
			name: plugin.name,
			path: plugin.path,
			enabled: plugin.enabled !== false,
			contributions: plugin.contributions,
		})),
		tools: [
			...builtinToolCatalog.map((tool) => ({
				id: tool.id,
				name: tool.id,
				description: tool.description,
				enabled:
					tool.defaultEnabled &&
					!tool.headlessToolNames.some((name) => disabledTools.has(name)),
				source: "builtin",
				headlessToolNames: tool.headlessToolNames,
			})),
			...hubSettings.tools.map((tool) => ({
				id: tool.id,
				name: tool.name,
				description: tool.description,
				enabled: tool.enabled !== false,
				source: tool.source,
				path: tool.path,
				pluginName: tool.pluginName,
			})),
		],
		hooks: loadHooks(),
		mcp: readMcpServersResponse(),
		warnings,
	};
}

// ---------------------------------------------------------------------------
// Native OS commands
// ---------------------------------------------------------------------------

function openFileInEditor(filePath: string): void {
	const platform = process.platform;
	const cmd =
		platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
	const cmdArgs =
		platform === "win32" ? ["/c", "start", "", filePath] : [filePath];
	const child = spawn(cmd, cmdArgs, { stdio: "ignore", detached: true });
	// An unhandled child error event would crash the sidecar process.
	child.once("error", () => {});
	child.unref();
}

// The macOS app shell launches the sidecar with a minimal GUI PATH
// (/usr/bin:/bin:...), so editor CLIs installed under /usr/local/bin or
// /opt/homebrew/bin are often not resolvable. `macApps` lets `open -a`
// find the app bundle regardless of PATH.
interface CodeEditorDefinition {
	id: string;
	label: string;
	cli: string;
	macApps: string[];
}

// Order doubles as the auto-open preference when no editor is requested.
const CODE_EDITOR_CATALOG: readonly CodeEditorDefinition[] = [
	{
		id: "vscode",
		label: "VS Code",
		cli: "code",
		macApps: ["Visual Studio Code"],
	},
	{ id: "cursor", label: "Cursor", cli: "cursor", macApps: ["Cursor"] },
	{ id: "windsurf", label: "Windsurf", cli: "windsurf", macApps: ["Windsurf"] },
	{ id: "zed", label: "Zed", cli: "zed", macApps: ["Zed"] },
	{
		id: "vscode-insiders",
		label: "VS Code Insiders",
		cli: "code-insiders",
		macApps: ["Visual Studio Code - Insiders"],
	},
	{
		id: "sublime",
		label: "Sublime Text",
		cli: "subl",
		macApps: ["Sublime Text"],
	},
	{
		id: "intellijidea",
		label: "IntelliJ IDEA",
		cli: "idea",
		macApps: ["IntelliJ IDEA", "IntelliJ IDEA CE"],
	},
	{ id: "xcode", label: "Xcode", cli: "xed", macApps: ["Xcode"] },
];

async function findExecutableOnPath(name: string): Promise<string | null> {
	try {
		const locator = process.platform === "win32" ? "where" : "which";
		const { stdout } = await execFileAsync(locator, [name], {
			encoding: "utf8",
		});
		return stdout.split("\n")[0]?.trim() || null;
	} catch {
		return null;
	}
}

// cmd.exe re-parses metacharacters inside arguments even when quoted (the
// reason Node refuses to spawn .cmd files without a shell), so strings that
// could smuggle a second command must never reach it.
const WINDOWS_CMD_UNSAFE_PATTERN = /[&|^<>%!"\r\n]/;

function isMacAppInstalled(app: string): boolean {
	return (
		existsSync(`/Applications/${app}.app`) ||
		existsSync(join(homedir(), "Applications", `${app}.app`))
	);
}

// Installed editors change rarely; cache briefly so composer UI refreshes do
// not re-run a batch of `which` lookups on every open.
const EDITOR_CATALOG_CACHE_TTL_MS = 60_000;
let editorCatalogCache: {
	fetchedAt: number;
	editors: Array<{ id: string; label: string }>;
} | null = null;

/** Editors the current machine can actually launch, in catalog order. */
async function listAvailableCodeEditors(): Promise<
	Array<{ id: string; label: string }>
> {
	const now = Date.now();
	if (
		editorCatalogCache &&
		now - editorCatalogCache.fetchedAt < EDITOR_CATALOG_CACHE_TTL_MS
	) {
		return editorCatalogCache.editors;
	}
	const availability = await Promise.all(
		CODE_EDITOR_CATALOG.map(
			async (editor) =>
				(await findExecutableOnPath(editor.cli)) !== null ||
				(process.platform === "darwin" &&
					editor.macApps.some(isMacAppInstalled)),
		),
	);
	const editors = CODE_EDITOR_CATALOG.filter(
		(_, index) => availability[index],
	).map(({ id, label }) => ({ id, label }));
	editorCatalogCache = { fetchedAt: now, editors };
	return editors;
}

/** Launches `executable filePath` detached; false if the CLI is unusable. */
function launchEditorCli(executable: string, filePath: string): boolean {
	// Windows `where` resolves editor CLIs to .cmd/.bat shims, which
	// spawn() cannot launch directly — route those through cmd.exe.
	const isWindowsShim =
		process.platform === "win32" && /\.(cmd|bat)$/i.test(executable);
	if (isWindowsShim && WINDOWS_CMD_UNSAFE_PATTERN.test(executable)) {
		return false;
	}
	const child = isWindowsShim
		? spawn("cmd", ["/c", executable, filePath], {
				stdio: "ignore",
				detached: true,
			})
		: spawn(executable, [filePath], {
				stdio: "ignore",
				detached: true,
			});
	// Spawn failures surface as async error events; without a listener
	// they crash the sidecar. Fall back to the OS default opener so the
	// click still opens the file.
	child.once("error", () => {
		openFileInEditor(filePath);
	});
	child.unref();
	return true;
}

async function launchMacApp(app: string, filePath: string): Promise<boolean> {
	try {
		await execFileAsync("open", ["-a", app, filePath]);
		return true;
	} catch {
		return false;
	}
}

/** Returns the launcher that handled the file, for logging/UI feedback. */
async function openFileInCodeEditor(
	filePath: string,
	editorId?: string,
): Promise<string> {
	if (
		process.platform === "win32" &&
		WINDOWS_CMD_UNSAFE_PATTERN.test(filePath)
	) {
		throw new Error(
			"File path contains characters that cannot be passed safely to the Windows shell",
		);
	}
	if (editorId && editorId !== "default") {
		const editor = CODE_EDITOR_CATALOG.find((entry) => entry.id === editorId);
		if (!editor) {
			throw new Error(`Unknown editor: ${editorId}`);
		}
		const executable = await findExecutableOnPath(editor.cli);
		if (executable && launchEditorCli(executable, filePath)) {
			return editor.label;
		}
		if (process.platform === "darwin") {
			for (const app of editor.macApps) {
				if (await launchMacApp(app, filePath)) {
					return editor.label;
				}
			}
		}
		throw new Error(`${editor.label} is not available on this machine`);
	}
	if (!editorId) {
		for (const editor of CODE_EDITOR_CATALOG) {
			const executable = await findExecutableOnPath(editor.cli);
			if (executable && launchEditorCli(executable, filePath)) {
				return editor.cli;
			}
		}
		if (process.platform === "darwin") {
			for (const editor of CODE_EDITOR_CATALOG) {
				for (const candidate of editor.macApps) {
					if (await launchMacApp(candidate, filePath)) {
						return candidate;
					}
				}
			}
		}
	}
	openFileInEditor(filePath);
	return "system default";
}

// ---------------------------------------------------------------------------
// Main command router
// ---------------------------------------------------------------------------

export async function handleCommand(
	ctx: SidecarContext,
	command: string,
	args?: Record<string, unknown>,
	options?: { connection?: SidecarWebSocketClient },
): Promise<unknown> {
	// ── Chat session commands ──────────────────────────────────────────
	if (command === "chat_session_command") {
		const { handleChatSessionCommand } = await import("./chat-session");
		return await handleChatSessionCommand(
			ctx,
			(args?.request as ChatSessionCommandRequest | undefined) ??
				(args as ChatSessionCommandRequest),
		);
	}
	if (command === "proceed_while_running") {
		const sessionId = String(args?.sessionId ?? "").trim();
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		const toolCallId = asTrimmedString(args?.toolCallId);
		const hubClient = await ensureSharedHubClient(
			ctx,
			ctx.sessionManager?.runtimeAddress,
		);
		const reply = await hubClient.command(
			"run.proceed_while_running",
			{ sessionId, ...(toolCallId ? { toolCallId } : {}) },
			sessionId,
		);
		if (!reply.ok) {
			throw new Error(
				reply.error?.message ?? "Could not proceed while command is running.",
			);
		}
		return {
			detachedCount:
				typeof reply.payload?.detachedCount === "number"
					? reply.payload.detachedCount
					: 0,
		};
	}

	// ── Session data reading ──────────────────────────────────────────
	if (command === "read_session_messages") {
		return await readSessionMessages(
			ctx,
			String(args?.sessionId ?? ""),
			typeof args?.maxMessages === "number" ? args.maxMessages : 800,
		);
	}
	if (command === "read_session_hooks") {
		return await readSessionHooks(
			String(args?.sessionId ?? ""),
			typeof args?.limit === "number" ? args.limit : 300,
		);
	}
	if (command === "list_session_agents") {
		return listSessionAgents(
			String(args?.sessionId ?? ""),
			typeof args?.limit === "number" ? args.limit : 200,
		);
	}

	// ── Process context ───────────────────────────────────────────────
	if (command === "get_process_context") {
		const hubUrl =
			ctx.hubClient?.getUrl() ??
			ctx.sessionManager?.runtimeAddress?.trim() ??
			null;
		const runningSessionCount = Array.from(ctx.liveSessions.values()).filter(
			(session) => session.busy || session.status === "running",
		).length;
		return {
			workspaceRoot: ctx.workspaceRoot,
			cwd: ctx.workspaceRoot,
			homeDir: homedir(),
			platform: process.platform,
			appVersion: packageJson.version,
			runningSessionCount,
			hub: {
				status: ctx.hubClient?.isConnected() ? "connected" : "disconnected",
				url: hubUrl,
				error: ctx.hubClient?.getConnectionError()?.message ?? null,
			},
		};
	}
	if (command === "get_chat_ws_endpoint") {
		return "";
	}

	// ── Tool approvals (in-memory) ────────────────────────────────────
	if (command === "poll_tool_approvals") {
		const sessionId = String(args?.sessionId ?? "").trim();
		const connection = options?.connection;
		if (!connection?.data?.canApproveTools) {
			throw new Error("tool approvals require a trusted desktop connection");
		}
		return Array.from(ctx.pendingApprovals.values())
			.filter((a) => a.owner === connection && a.item.sessionId === sessionId)
			.map((a) => a.item);
	}
	if (command === "respond_tool_approval") {
		const sessionId = String(args?.sessionId ?? "").trim();
		const requestId = String(args?.requestId ?? "").trim();
		if (!sessionId || !requestId) {
			throw new Error("sessionId and requestId are required");
		}
		const connection = options?.connection;
		if (!connection?.data?.canApproveTools) {
			throw new Error("tool approvals require a trusted desktop connection");
		}
		const pending = ctx.pendingApprovals.get(requestId);
		if (!pending || pending.owner !== connection) {
			throw new Error("tool approval does not belong to this connection");
		}
		if (pending.item.sessionId !== sessionId) {
			throw new Error("tool approval does not belong to this session");
		}
		pending.resolve({
			approved: Boolean(args?.approved),
			...(typeof args?.reason === "string" && args.reason.trim().length > 0
				? { reason: args.reason.trim() }
				: {}),
		});
		ctx.pendingApprovals.delete(requestId);
		const remaining = Array.from(ctx.pendingApprovals.values())
			.filter((a) => a.owner === connection && a.item.sessionId === sessionId)
			.map((a) => a.item);
		sendEventToClient(ctx, connection, "tool_approval_state", {
			sessionId,
			items: remaining,
		});
		return true;
	}
	if (command === "poll_ask_questions") {
		const sessionId = String(args?.sessionId ?? "").trim();
		return Array.from(ctx.pendingQuestions.values())
			.filter((question) => question.item.sessionId === sessionId)
			.map((question) => question.item);
	}
	if (command === "respond_ask_question") {
		const requestId = String(args?.requestId ?? "").trim();
		if (!requestId) {
			throw new Error("requestId is required");
		}
		const answer = String(args?.answer ?? "").trim();
		const resolved = resolveSidecarAskQuestion(ctx, requestId, answer);
		if (!resolved) {
			throw new Error(`unknown ask question request: ${requestId}`);
		}
		broadcastEvent(ctx, "ask_question_answered", { requestId });
		return true;
	}

	// ── Session discovery ─────────────────────────────────────────────
	if (command === "list_chat_sessions") {
		return discoverChatSessions(
			ctx,
			typeof args?.limit === "number" ? args.limit : 300,
		);
	}
	if (command === "list_cli_sessions") {
		return await listSessionsFromSidecarManager(
			ctx,
			typeof args?.limit === "number" ? args.limit : 300,
		);
	}
	if (command === "list_discovered_sessions") {
		return await listSessionsFromSidecarManager(
			ctx,
			typeof args?.limit === "number" ? args.limit : 300,
		);
	}
	if (command === "get_discovered_session") {
		const sessionId = String(args?.sessionId ?? args?.session_id ?? "").trim();
		if (!sessionId) throw new Error("session id is required");
		return (await getSessionFromSidecarManager(ctx, sessionId)) ?? null;
	}
	if (command === "update_chat_session_title") {
		const sessionId = String(args?.sessionId ?? "").trim();
		if (!sessionId) throw new Error("session id is required");
		const title = normalizeSessionTitle(String(args?.title ?? ""));
		const backend = await resolveSessionBackend({ backendMode: "local" });
		const result = await backend.updateSession({ sessionId, title });
		if (!result.updated) throw new Error(`Session ${sessionId} not found`);
		const liveSession = ctx.liveSessions.get(sessionId);
		if (liveSession) liveSession.title = title;
		return true;
	}
	if (command === "update_chat_session_metadata") {
		const sessionId = String(args?.sessionId ?? args?.session_id ?? "").trim();
		if (!sessionId) throw new Error("session id is required");
		const patch = args?.metadata;
		if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
			throw new Error("metadata patch is required");
		}
		// updateSession replaces metadata wholesale in both the session row and
		// the manifest, so merge over what each already holds. A null value
		// removes the key, which is how callers clear a flag.
		const store = new SqliteSessionStore();
		const asRecord = (value: unknown): JsonRecord =>
			value && typeof value === "object" && !Array.isArray(value)
				? (value as JsonRecord)
				: {};
		const existing = store.get(sessionId);
		const merged: JsonRecord = {
			...asRecord(readSessionManifest(sessionId)?.metadata),
			...asRecord(existing?.metadata),
		};
		for (const [key, value] of Object.entries(patch as JsonRecord)) {
			if (value === null) delete merged[key];
			else merged[key] = value;
		}
		const backend = await resolveSessionBackend({ backendMode: "local" });
		const result = await backend.updateSession({ sessionId, metadata: merged });
		if (!result.updated) throw new Error(`Session ${sessionId} not found`);
		// Annotating a session is not session activity. updateSession stamps
		// updated_at, which clients sort and label rows by, so a pin would
		// otherwise make an old session look like it just ran.
		if (existing?.updatedAt) {
			store.run("UPDATE sessions SET updated_at = ? WHERE session_id = ?", [
				existing.updatedAt,
				sessionId,
			]);
		}
		return merged;
	}
	if (command === "delete_chat_session" || command === "delete_cli_session") {
		const sessionId = String(args?.sessionId ?? args?.session_id ?? "").trim();
		if (!sessionId) throw new Error("session id is required");
		ctx.logger?.log("Deleting desktop chat session", { command, sessionId });
		const store = new SqliteSessionStore();
		const row = store.get(sessionId);
		const manifest = readSessionManifest(sessionId);
		let deleted = false;
		let deleteError: Error | null = null;
		try {
			if (ctx.sessionManager) {
				deleted = await ctx.sessionManager.delete(sessionId);
			} else {
				const backend = await resolveSessionBackend({ backendMode: "local" });
				const deleteSession = (
					backend as {
						deleteSession: (
							sessionId: string,
							cascade?: boolean,
						) => Promise<boolean | { deleted: boolean }>;
					}
				).deleteSession.bind(backend);
				const deleteResult = await deleteSession(sessionId, true);
				deleted =
					typeof deleteResult === "boolean"
						? deleteResult
						: deleteResult.deleted;
			}
		} catch (error) {
			deleteError = error instanceof Error ? error : new Error(String(error));
		}
		if (store.delete(sessionId, true)) {
			deleted = true;
		}
		ctx.liveSessions.delete(sessionId);
		const directoryCandidates = new Set<string>([
			join(sharedSessionDataDir(), sessionId),
		]);
		for (const path of [
			row?.messagesPath,
			typeof manifest?.messages_path === "string"
				? manifest.messages_path
				: null,
		]) {
			if (typeof path === "string" && path.trim().length > 0) {
				directoryCandidates.add(dirname(path));
			}
		}
		for (const path of [sessionLogPath(sessionId)]) {
			if (removePathIfExists(path, { recursive: true })) {
				deleted = true;
			}
		}
		for (const dir of directoryCandidates) {
			if (removePathIfExists(dir, { recursive: true })) {
				deleted = true;
			}
		}
		for (const path of [
			row?.messagesPath,
			typeof manifest?.messages_path === "string"
				? manifest.messages_path
				: null,
			join(sharedSessionDataDir(), sessionId, `${sessionId}.json`),
		].filter((v): v is string => typeof v === "string" && v.length > 0)) {
			if (removePathIfExists(path)) {
				deleted = true;
			}
		}
		for (const suffix of ["messages.json"]) {
			const fileName = `${sessionId}.${suffix}`;
			const found = findArtifactUnderDir(
				join(sharedSessionDataDir(), rootSessionIdFrom(sessionId)),
				fileName,
				4,
			);
			if (found && removePathIfExists(found)) {
				deleted = true;
			}
		}
		if (!deleted && deleteError) {
			ctx.logger?.error?.("Failed to delete desktop chat session", {
				sessionId,
				error: deleteError,
			});
			throw deleteError;
		}
		ctx.logger?.log("Desktop chat session delete completed", {
			sessionId,
			deleted,
		});
		if (deleted) {
			broadcastEvent(ctx, "session_deleted", {
				sessionId,
				command,
				deleted: true,
			});
		}
		return deleted;
	}

	// ── Workspace file search ─────────────────────────────────────────
	if (command === "search_workspace_files") {
		return await searchWorkspaceFiles(ctx, args);
	}

	// ── External links ─────────────────────────────────────────────────
	if (command === "open_external_url") {
		const rawUrl = String(args?.url ?? "").trim();
		let parsed: URL;
		try {
			parsed = new URL(rawUrl);
		} catch {
			throw new Error(`invalid url: ${rawUrl}`);
		}
		if (!OPENABLE_URL_PROTOCOLS.has(parsed.protocol)) {
			throw new Error(
				"only http(s), mailto and tel urls can be opened externally",
			);
		}
		await openUrlInDefaultBrowser(parsed.toString());
		return { opened: true };
	}

	// ── Cline account ──────────────────────────────────────────────────
	if (command === "cline_account") {
		const operation = String(args?.operation ?? "").trim();
		if (!operation) throw new Error("operation is required");
		const manager = new ProviderSettingsManager();
		// Signed out is an expected state, not a command failure: resolve the
		// token up front and return a typed result the webview can act on
		// instead of letting the account service throw a generic error that
		// would be captured as error telemetry and shown raw to the user.
		const authToken = await resolveFreshClineAuthToken(ctx, manager);
		if (!authToken) {
			// Backstop for credentials that go away without a settings write —
			// an expired or server-revoked token. Explicit sign-out is handled
			// at its source in `save_provider_settings`; this catches the rest
			// so a stale account never keeps serving its rollout cohort.
			void identifyDesktopFeatureFlagsAccount(
				{},
				{ logger: ctx.logger, telemetry: ctx.telemetry },
			);
			return CLINE_ACCOUNT_NOT_AUTHENTICATED_RESULT;
		}
		const settings = manager.getProviderSettings("cline");
		const accountService = new ClineAccountService({
			apiBaseUrl:
				settings?.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl,
			getAuthToken: async () => authToken,
		});
		const result = await executeClineAccountAction(
			args as ClineAccountActionRequest,
			accountService,
		);
		syncFeatureFlagsAccountFromResult(ctx, operation, result);
		return result;
	}

	// ── Provider management ────────────────────────────────────────────
	if (command === "list_provider_catalog") {
		const manager = new ProviderSettingsManager();
		await ensureCustomProvidersLoaded(manager);
		return await listLocalProviders(manager, { isClinePassEnabled: true });
	}
	if (command === "list_provider_models") {
		const manager = new ProviderSettingsManager();
		return await getLocalProviderModels(
			String(args?.provider ?? ""),
			manager.getProviderConfig(String(args?.provider ?? "").trim()),
		);
	}
	if (command === "list_cline_recommended_models") {
		// Tiered picker data (recommended / free / clinePass) with
		// display-ready names; falls back to a bundled list offline.
		return await fetchClineRecommendedModels();
	}
	if (command === "create_streaming_transcription_session") {
		const manager = new ProviderSettingsManager();
		const selection = manager.getVoiceInputSettings();
		const providerConfig = selection
			? manager.getProviderConfig(selection.providerId, {
					includeKnownModels: false,
				})
			: undefined;
		const route = providerConfig
			? resolveAudioTranscriptionRoute(providerConfig)
			: undefined;
		const diagnostics = {
			providerId: selection?.providerId,
			modelId: selection?.modelId,
			transport: route?.transport,
			endpoint: sanitizeDiagnosticUrl(route?.endpoint),
		};
		emitDesktopDebugLog(
			ctx,
			"debug",
			"Creating streaming transcription session",
			diagnostics,
		);
		const startedAt = Date.now();
		try {
			const session = await createConfiguredStreamingTranscriptionSession(
				manager,
				{ expiresAfterSeconds: 300 },
			);
			emitDesktopDebugLog(
				ctx,
				"debug",
				"Streaming transcription session created",
				{
					...diagnostics,
					durationMs: Date.now() - startedAt,
					expiresAt: session.expiresAt,
				},
			);
			return session;
		} catch (error) {
			const failure = sanitizeDiagnosticFailure(error, providerConfig);
			emitDesktopDebugLog(
				ctx,
				"error",
				"Streaming transcription session setup failed",
				{
					...diagnostics,
					durationMs: Date.now() - startedAt,
					failure,
				},
			);
			throw new Error(failure, { cause: error });
		}
	}
	if (command === "transcribe_audio") {
		const audioBase64 = String(args?.audioBase64 ?? "");
		const mediaType = String(args?.mediaType ?? "").trim() || undefined;
		if (!isCanonicalBase64(audioBase64)) {
			throw new Error("recorded audio must be canonical base64");
		}
		const decodedBytes =
			Math.floor((audioBase64.length * 3) / 4) -
			(audioBase64.endsWith("==") ? 2 : audioBase64.endsWith("=") ? 1 : 0);
		if (decodedBytes > MAX_RECORDED_AUDIO_BYTES) {
			throw new Error(
				`recorded audio exceeds the ${MAX_RECORDED_AUDIO_BYTES} byte limit`,
			);
		}
		const manager = new ProviderSettingsManager();
		const selection = manager.getVoiceInputSettings();
		const providerConfig = selection
			? manager.getProviderConfig(selection.providerId, {
					includeKnownModels: false,
				})
			: undefined;
		const route = providerConfig
			? resolveAudioTranscriptionRoute(providerConfig)
			: undefined;
		const diagnostics = {
			providerId: selection?.providerId,
			modelId: selection?.modelId,
			transport: route?.transport,
			endpoint: sanitizeDiagnosticUrl(route?.endpoint),
			mediaType,
			audioBytes: decodedBytes,
		};
		emitDesktopDebugLog(
			ctx,
			"debug",
			"Starting audio transcription",
			diagnostics,
		);
		const startedAt = Date.now();
		try {
			const result = await transcribeConfiguredVoiceInput(manager, {
				audio: Buffer.from(audioBase64, "base64"),
				mediaType,
			});
			emitDesktopDebugLog(ctx, "debug", "Audio transcription completed", {
				...diagnostics,
				durationMs: Date.now() - startedAt,
				transcriptCharacters: result.text.length,
				language: result.language,
			});
			return result;
		} catch (error) {
			const failure = sanitizeDiagnosticFailure(error, providerConfig);
			emitDesktopDebugLog(ctx, "error", "Audio transcription failed", {
				...diagnostics,
				durationMs: Date.now() - startedAt,
				failure,
			});
			throw new Error(failure, { cause: error });
		}
	}
	if (command === "save_voice_input_settings") {
		const providerId = String(args?.provider ?? "").trim();
		const modelId = String(args?.model ?? "").trim();
		if (Boolean(providerId) !== Boolean(modelId)) {
			throw new Error(
				"voice input provider and model must both be set or both be cleared",
			);
		}
		const manager = new ProviderSettingsManager();
		const result = await saveVoiceInputSettings(
			manager,
			providerId && modelId ? { providerId, modelId } : undefined,
		);
		emitDesktopDebugLog(ctx, "info", "Voice input settings saved", {
			providerId: result.voiceInput?.providerId,
			modelId: result.voiceInput?.modelId,
			configured: Boolean(result.voiceInput),
		});
		return result;
	}
	if (command === "save_provider_settings") {
		const manager = new ProviderSettingsManager();
		const saved = saveLocalProviderSettings(manager, {
			...readProviderSettingsUpdate(args),
			providerId: String(args?.provider ?? ""),
			enabled: typeof args?.enabled === "boolean" ? args.enabled : undefined,
			apiKey: typeof args?.api_key === "string" ? args.api_key : undefined,
			baseUrl: typeof args?.base_url === "string" ? args.base_url : undefined,
		});
		// Sign-out is a `save_provider_settings` that blanks the cline auth block
		// (see signOut in webview settings/account-view.tsx), so this is the
		// authoritative signal — it fires the moment credentials are cleared
		// rather than waiting for the next account fetch.
		if (saved.providerId === "cline" || saved.providerId === "cline-pass") {
			syncFeatureFlagsAccountFromSettings(ctx, manager);
		}
		return saved;
	}
	if (command === "add_provider") {
		const manager = new ProviderSettingsManager();
		await ensureCustomProvidersLoaded(manager);
		return await addLocalProvider(manager, {
			providerId: String(args?.provider_id ?? ""),
			name: String(args?.name ?? ""),
			baseUrl: String(args?.base_url ?? ""),
			apiKey: typeof args?.api_key === "string" ? args.api_key : undefined,
			headers:
				args?.headers && typeof args.headers === "object"
					? (args.headers as Record<string, string>)
					: undefined,
			timeoutMs:
				typeof args?.timeout_ms === "number" ? args.timeout_ms : undefined,
			models: Array.isArray(args?.models)
				? (args.models as string[])
				: undefined,
			defaultModelId:
				typeof args?.default_model_id === "string"
					? args.default_model_id
					: undefined,
			modelsSourceUrl:
				typeof args?.models_source_url === "string"
					? args.models_source_url
					: undefined,
			protocol:
				typeof args?.protocol === "string"
					? (args.protocol as ProviderProtocol)
					: undefined,
			client:
				typeof args?.client === "string"
					? (args.client as ProviderClient)
					: undefined,
			capabilities: Array.isArray(args?.capabilities)
				? (args.capabilities as ProviderCapability[])
				: undefined,
		});
	}
	if (command === "update_provider_models") {
		const providerId = String(args?.provider ?? "").trim();
		const manager = new ProviderSettingsManager();
		await ensureCustomProvidersLoaded(manager);
		return await updateLocalProvider(manager, {
			providerId,
			models: Array.isArray(args?.models)
				? (args.models as string[])
				: undefined,
		});
	}
	if (command === "run_provider_oauth_login") {
		const providerId = normalizeOAuthProvider(String(args?.provider ?? ""));
		const manager = new ProviderSettingsManager();
		return await runCancellableProviderOAuthLogin(
			manager,
			providerId,
			(url) => {
				// The OAuth helper's openUrl callback is fire-and-forget; surface
				// opener failures in the log instead of an unhandled rejection.
				openUrlInDefaultBrowser(url).catch((error) => {
					console.warn(
						`[sidecar] ${error instanceof Error ? error.message : error}`,
					);
				});
			},
			{ owner: options?.connection },
		);
	}
	if (command === "cancel_provider_oauth_login") {
		const providerId = normalizeOAuthProvider(String(args?.provider ?? ""));
		return {
			provider: providerId,
			cancelled: cancelProviderOAuthLogin(providerId),
		};
	}

	// ── Global settings ────────────────────────────────────────────────
	if (command === "get_global_settings") {
		return readGlobalSettings();
	}
	if (command === "set_telemetry_opt_out") {
		if (typeof args?.telemetry_opt_out !== "boolean") {
			throw new Error("telemetry_opt_out must be a boolean");
		}
		setTelemetryOptOutGlobally(args.telemetry_opt_out);
		return readGlobalSettings();
	}
	if (command === "set_auto_update_enabled") {
		if (typeof args?.auto_update_enabled !== "boolean") {
			throw new Error("auto_update_enabled must be a boolean");
		}
		setAutoUpdateEnabledGlobally(args.auto_update_enabled);
		return readGlobalSettings();
	}
	if (command === "set_web_search_enabled") {
		if (typeof args?.web_search_enabled !== "boolean") {
			throw new Error("web_search_enabled must be a boolean");
		}
		setModelToolEnabledGlobally("web_search", args.web_search_enabled);
		return readGlobalSettings();
	}

	// ── Feature flags ──────────────────────────────────────────────────
	// Flags are evaluated here, not in the webview: the sidecar already has
	// the PostHog key inlined at build time and evaluates against the same
	// distinct ID it reports telemetry with. The client just reads the
	// resolved values.
	if (command === "get_feature_flags") {
		return await refreshDesktopFeatureFlags({
			logger: ctx.logger,
			telemetry: ctx.telemetry,
		});
	}

	// ── Connector channels ─────────────────────────────────────────────
	if (command === "list_connector_channels") {
		return connectorChannelsPayload();
	}
	if (command === "start_connector_channel") {
		return await startConnectorChannel(ctx.workspaceRoot, args);
	}
	if (command === "stop_connector_channel") {
		return await stopConnectorChannel(ctx.workspaceRoot, args);
	}

	// ── MCP server management ─────────────────────────────────────────
	if (command === "list_mcp_servers") {
		return readMcpServersResponse();
	}
	if (command === "authorize_mcp_server_oauth") {
		const name = String(args?.name ?? "").trim();
		if (!name) throw new Error("server name is required");
		const settingsPath = resolveMcpSettingsPath();
		const registration = resolveMcpServerRegistration(name, {
			filePath: settingsPath,
		});
		if (!registration) {
			throw new Error(`unknown MCP server: ${name}`);
		}
		const wasDisabled = registration.disabled === true;
		setMcpServerDisabled({ filePath: settingsPath, name, disabled: true });
		try {
			await runCancellableMcpOAuthAuthorization(
				{
					serverName: name,
					filePath: settingsPath,
					openUrl: openUrlInDefaultBrowser,
				},
				options?.connection,
			);
		} catch (error) {
			if (!(error instanceof McpOAuthAuthorizationCancelledError)) {
				throw error;
			}
			if (
				shouldRestoreEnabledStateAfterOAuthCancellation(
					wasDisabled,
					error.reason,
				)
			) {
				setMcpServerDisabled({
					filePath: settingsPath,
					name,
					disabled: false,
				});
			}
			return readMcpServersResponse();
		}
		setMcpServerDisabled({ filePath: settingsPath, name, disabled: false });
		return readMcpServersResponse();
	}
	if (command === "cancel_mcp_server_oauth") {
		const name = String(args?.name ?? "").trim();
		if (!name) throw new Error("server name is required");
		cancelMcpOAuthAuthorizationForReason(name, "user");
		return readMcpServersResponse();
	}
	if (command === "set_mcp_server_disabled") {
		const name = String(args?.name ?? "").trim();
		const disabled = Boolean(args?.disabled);
		const path = ensureMcpSettingsFile();
		if (disabled) {
			cancelMcpOAuthAuthorizationForReason(name, "server-disabled");
			setMcpServerDisabled({ filePath: path, name, disabled: true });
			return readMcpServersResponse();
		}
		const registration = resolveMcpServerRegistration(name, { filePath: path });
		if (!registration) {
			throw new Error(`unknown MCP server: ${name}`);
		}
		if (registration.transport.type !== "stdio") {
			setMcpServerDisabled({ filePath: path, name, disabled: true });
			const probe = await probeMcpServerConnection({
				serverName: name,
				filePath: path,
			});
			if (!probe.connected) {
				return readMcpServersResponse();
			}
		}
		setMcpServerDisabled({ filePath: path, name, disabled: false });
		return readMcpServersResponse();
	}
	if (command === "upsert_mcp_server") {
		const input =
			args?.input && typeof args.input === "object"
				? (args.input as JsonRecord)
				: (args as JsonRecord);
		const name = String(input.name ?? "").trim();
		if (!name) throw new Error("server name is required");
		const previousName = String(
			input.previousName ?? input.previous_name ?? "",
		).trim();
		const transportType = String(
			input.transportType ?? input.transport_type ?? "",
		).trim();
		const requestedDisabled = Boolean(input.disabled);
		const isRemote = transportType !== "stdio";
		const next: JsonRecord =
			transportType === "stdio"
				? {
						transport: {
							type: "stdio",
							command: input.command,
							args: input.args,
							cwd: input.cwd,
							env: input.env,
						},
						disabled: requestedDisabled,
						metadata: input.metadata,
					}
				: {
						transport: {
							type: transportType,
							url: input.url,
							headers: input.headers,
						},
						disabled: requestedDisabled,
						metadata: input.metadata,
					};
		const path = ensureMcpSettingsFile();
		const { shouldProbeAfterSave } = updateMcpSettingsFileSync(
			path,
			(settings) => {
				const servers = ((settings.mcpServers as JsonRecord | undefined) ??
					{}) as JsonRecord;
				// Preserve machine-managed fields the editor dialog doesn't expose:
				// oauth tokens for remote servers and plugin-ownership metadata.
				const existingName =
					previousName && servers[previousName] ? previousName : name;
				const existing = servers[existingName];
				let existingTransportIdentity: string | undefined;
				let existingWasEnabled = false;
				if (existing && typeof existing === "object") {
					const record = existing as JsonRecord;
					existingTransportIdentity = mcpTransportIdentity(
						existingName,
						record,
					);
					existingWasEnabled = record.disabled !== true;
				}
				const nextTransportIdentity = mcpTransportIdentity(name, next);
				const transportIdentityUnchanged =
					existingTransportIdentity === nextTransportIdentity;
				const shouldProbe = shouldProbeMcpServerAfterUpsert({
					isRemote,
					requestedDisabled,
					existingWasEnabled,
					transportIdentityUnchanged,
				});
				const upserted: JsonRecord = {
					...next,
					disabled: requestedDisabled || shouldProbe,
				};
				if (existing && typeof existing === "object") {
					const record = existing as JsonRecord;
					if (
						upserted.metadata === undefined &&
						record.metadata !== undefined
					) {
						upserted.metadata = record.metadata;
					}
					// OAuth tokens were issued for a specific endpoint; carrying them
					// onto an edited transport or URL would send the old server's
					// credentials to a different endpoint.
					if (record.oauth !== undefined && transportIdentityUnchanged) {
						upserted.oauth = record.oauth;
					}
					if (record.oauthClient !== undefined && transportIdentityUnchanged) {
						upserted.oauthClient = record.oauthClient;
					}
				}
				if (previousName && previousName !== name) {
					delete servers[previousName];
				}
				servers[name] = upserted;
				settings.mcpServers = servers;
				return { shouldProbeAfterSave: shouldProbe };
			},
		);
		if (shouldProbeAfterSave) {
			const probe = await probeMcpServerConnection({
				serverName: name,
				filePath: path,
			});
			if (probe.connected) {
				setMcpServerDisabled({ filePath: path, name, disabled: false });
			}
		}
		return readMcpServersResponse();
	}
	if (command === "delete_mcp_server") {
		const path = ensureMcpSettingsFile();
		updateMcpSettingsFileSync(path, (settings) => {
			const servers = ((settings.mcpServers as JsonRecord | undefined) ??
				{}) as JsonRecord;
			delete servers[String(args?.name ?? "")];
			settings.mcpServers = servers;
		});
		return readMcpServersResponse();
	}
	if (command === "ensure_mcp_settings_file") {
		return ensureMcpSettingsFile();
	}

	// ── Git operations ─────────────────────────────────────────────────
	if (command === "get_git_branch") {
		const cwd =
			typeof args?.cwd === "string" && args.cwd.trim()
				? args.cwd.trim()
				: ctx.workspaceRoot;
		const branches = await listGitBranches(ctx, cwd);
		const { prewarmWorkspaceMetadata } = await import("./chat-session");
		prewarmWorkspaceMetadata(cwd);
		return { branch: branches.current };
	}
	if (command === "list_git_branches") {
		return await listGitBranches(
			ctx,
			typeof args?.cwd === "string" ? args.cwd : undefined,
		);
	}
	if (command === "checkout_git_branch") {
		const cwd = typeof args?.cwd === "string" ? args.cwd : undefined;
		const branch = String(args?.branch ?? "").trim();
		if (!branch) throw new Error("branch is required");
		const targetCwd = cwd?.trim() || ctx.workspaceRoot;
		await execFileAsync("git", ["checkout", branch], {
			cwd: targetCwd,
			encoding: "utf8",
		});
		const { refreshWorkspaceMetadata } = await import("./chat-session");
		refreshWorkspaceMetadata(targetCwd);
		return { branch };
	}

	// ── Routine schedules ─────────────────────────────────────────────
	if (
		command === "list_routine_schedules" ||
		command === "create_routine_schedule" ||
		command === "update_routine_schedule" ||
		command === "pause_routine_schedule" ||
		command === "resume_routine_schedule" ||
		command === "trigger_routine_schedule" ||
		command === "delete_routine_schedule"
	) {
		return await handleRoutineScheduleCommand(ctx, command, args);
	}

	// ── Agenda task queue ─────────────────────────────────────────────
	if (AGENDA_TASK_COMMANDS.has(command)) {
		if (
			AGENDA_TASK_EXECUTION_COMMANDS.has(command) &&
			!options?.connection?.data?.canApproveTools
		) {
			throw new Error("task execution requires a trusted desktop connection");
		}
		return await handleAgendaTaskCommand(ctx, command, args);
	}

	// ── User instruction configs ──────────────────────────────────────
	if (command === "list_user_instruction_configs") {
		return await listUserInstructionConfigs(ctx);
	}
	if (command === "list_marketplace_installed_entries") {
		return listMarketplaceInstalledEntries(
			args,
			await listUserInstructionConfigs(ctx),
		);
	}
	if (command === "install_marketplace_entry") {
		const result = await installMarketplaceEntryForDesktopCommand(args);
		return result;
	}
	if (command === "uninstall_marketplace_entry") {
		const result = await uninstallMarketplaceEntryForDesktopCommand(args);
		return result;
	}
	if (command === "uninstall_local_primitive") {
		const result = await uninstallLocalPrimitive(args, {
			workspaceRoot: ctx.workspaceRoot,
		});
		return result;
	}
	if (command === "toggle_disabled_plugin_tool") {
		const toolName = String(args?.name ?? "").trim();
		if (!toolName) {
			throw new Error("tool name is required");
		}
		const snapshot = await toggleHubSetting(ctx, {
			type: "tools",
			name: toolName,
		});
		return await listUserInstructionConfigs(ctx, snapshot);
	}
	if (command === "set_tool_disabled") {
		const rawNames = Array.isArray(args?.names) ? args.names : [args?.name];
		const toolNames = rawNames
			.map((name) => String(name ?? "").trim())
			.filter(Boolean);
		if (toolNames.length === 0) {
			throw new Error("tool name is required");
		}
		let snapshot: CoreSettingsSnapshot | undefined;
		for (const name of toolNames) {
			snapshot = await toggleHubSetting(ctx, {
				type: "tools",
				name,
				enabled: args?.disabled !== true,
			});
		}
		return await listUserInstructionConfigs(ctx, snapshot);
	}
	if (command === "set_plugin_disabled") {
		const pluginPath = String(args?.path ?? "").trim();
		if (!pluginPath) {
			throw new Error("plugin path is required");
		}
		const snapshot = await toggleHubSetting(ctx, {
			type: "plugins",
			path: pluginPath,
			enabled: args?.disabled !== true,
		});
		return await listUserInstructionConfigs(ctx, snapshot);
	}

	// ── Native OS commands ────────────────────────────────────────────
	if (command === "validate_workspace_directory") {
		const workspacePath = String(args?.path ?? "").trim();
		if (!workspacePath) return { valid: false };
		// Support typed/pasted paths like "~/projects/app" from the manual
		// path-entry fallback; return the resolved path so the caller adopts it.
		const resolved =
			workspacePath === "~"
				? homedir()
				: workspacePath.startsWith("~/") || workspacePath.startsWith("~\\")
					? join(homedir(), workspacePath.slice(2))
					: workspacePath;
		try {
			return { valid: statSync(resolved).isDirectory(), path: resolved };
		} catch {
			return { valid: false, path: resolved };
		}
	}
	if (command === "pick_workspace_directory") {
		return await pickWorkspaceDirectory();
	}
	if (command === "open_mcp_settings_file") {
		const path = ensureMcpSettingsFile();
		openFileInEditor(path);
		return path;
	}
	if (command === "list_available_editors") {
		return await listAvailableCodeEditors();
	}
	if (command === "open_file_in_editor") {
		const rawPath = String(args?.path ?? "").trim();
		if (!rawPath) throw new Error("path is required");
		const baseDir =
			typeof args?.cwd === "string" && args.cwd.trim()
				? args.cwd.trim()
				: ctx.workspaceRoot;
		const filePath = isAbsolute(rawPath) ? rawPath : join(baseDir, rawPath);
		if (!existsSync(filePath)) {
			throw new Error(`File not found: ${filePath}`);
		}
		const requestedEditor =
			typeof args?.editor === "string" && args.editor.trim()
				? args.editor.trim()
				: undefined;
		const editor = await openFileInCodeEditor(filePath, requestedEditor);
		return { path: filePath, editor };
	}

	throw new Error(`unsupported desktop command: ${command}`);
}
