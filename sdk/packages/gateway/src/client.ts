/**
 * Loopback Gateway client (Gateway RFC, Phase 3).
 *
 * Speaks the versioned NDJSON protocol: hello-first handshake with the
 * per-instance secret from the discovery record, promise-correlated
 * requests, pushed events (durable-cursor replay), and server-initiated
 * requests (approvals) that the caller answers explicitly.
 *
 * There is no implicit fallback (ADR 0003): when the Gateway cannot be
 * reached this client fails with `gateway_unreachable` — it never spins
 * up a private runtime.
 */

import { connect } from "node:net";
import type { Duplex } from "node:stream";
import type {
	BotRecord,
	RunRecord,
	SessionKind,
	SessionRecord,
	TurnOverrides,
} from "@cline/bot";
import type { VoiceInputSelection } from "@cline/shared";
import type {
	BotId,
	BotToolConfiguration,
	EffectiveToolPreview,
	GatewayError,
	GatewayEvent,
	GatewayHelloResult,
	GatewayRequest,
	GatewayResponse,
	GatewayServerRequest,
	RunAccepted,
	RunId,
	ScheduleId,
	SessionId,
	ToolDescriptor,
	ToolProfile,
} from "@cline/shared/gateway";
import {
	createGatewayError,
	createIdempotencyKey,
	GATEWAY_HELLO_METHOD,
	GATEWAY_PROTOCOL_VERSION,
	GatewayEventSchema,
	GatewayServerRequestSchema,
	IDEMPOTENCY_KEY_PARAM,
	RunAcceptedSchema,
} from "@cline/shared/gateway";
import { WebSocket } from "ws";
import type {
	GatewayClineAccountQuery,
	GatewayClineAccountQueryResult,
	GatewayClineAccountSwitchResult,
} from "./cline-account";
import type { ConnectorRecord } from "./connectors/store";
import { isLoopbackHost } from "./remote";
import { createGatewayWebSocketStream } from "./websocket-stream";

export {
	ONE_TIME_SCHEDULE_CRON_PATTERN,
	ONE_TIME_SCHEDULE_RUN_AT_METADATA_KEY,
} from "@cline/shared/automation";
export type {
	ClineAccountNotAuthenticatedResult,
	GatewayClineAccountBalance,
	GatewayClineAccountOrganization,
	GatewayClineAccountQuery,
	GatewayClineAccountQueryResult,
	GatewayClineAccountSwitchResult,
	GatewayClineAccountUser,
	GatewayClineOrganizationBalance,
	GatewayClineOrganizationUsageTransaction,
	GatewayClinePaymentTransaction,
	GatewayClineUsageTransaction,
} from "./cline-account";
export {
	CLINE_ACCOUNT_NOT_AUTHENTICATED_CODE,
	CLINE_ACCOUNT_NOT_AUTHENTICATED_RESULT,
} from "./cline-account";
export type {
	AddGatewayProviderInput,
	ProviderCredentialPresence,
	ProviderSettingsPatch,
	PublicProviderSettings,
	UpdateGatewayProviderModelsInput,
} from "./provider-settings";
export {
	gatewayProviderSettingsPath,
	listSavedProviderSummaries,
	readSavedProviderSelection,
} from "./provider-settings";

import type { DiscoveryRecord } from "./discovery";
import type {
	GatewayGlobalSettings,
	GatewayGlobalSettingsPatch,
} from "./global-settings";
import type {
	GatewayManagedExtensionsResponse,
	GatewayMarketplaceActionResult,
	GatewayMarketplaceCatalog,
	GatewayMcpServerInput,
	GatewayMcpServersResponse,
	MarketplacePrimitiveType,
} from "./managed-extensions";

export {
	MCP_OAUTH_UNAVAILABLE_MESSAGE,
	MCP_REDACTED_VALUE,
} from "./managed-extensions";

import type {
	AddGatewayProviderInput,
	ProviderSettingsPatch,
	PublicProviderSettings,
	UpdateGatewayProviderModelsInput,
} from "./provider-settings";
import type {
	QueuedRunPromotionResult,
	QueuedRunUpdateResult,
	ScheduleCreateParams,
	ScheduleDeleteResult,
	ScheduleTriggerResult,
	ScheduleUpdateParams,
	SessionDeleteResult,
	SessionForkResult,
	SessionSnapshot,
	SessionUpdateParams,
} from "./runtime";
import type { ScheduleJobRecord, ScheduleRecord } from "./schedules/store";
import type {
	ToolConfigurationScope,
	VersionedToolConfiguration,
} from "./tools/store";
import type {
	VoiceSettingsResult,
	VoiceStreamingSession,
	VoiceTranscriptionInput,
	VoiceTranscriptionResult,
} from "./voice";

export class GatewayRequestError extends Error {
	readonly gatewayError: GatewayError;

	constructor(gatewayError: GatewayError) {
		super(`${gatewayError.code}: ${gatewayError.message}`);
		this.name = "GatewayRequestError";
		this.gatewayError = gatewayError;
	}
}

export interface GatewayClientOptions {
	host: string;
	port: number;
	/** Per-instance secret from the discovery record. */
	auth: string;
	clientName?: string;
	clientVersion?: string;
	/** Resume a previously assigned client identity. */
	clientId?: string;
	connectTimeoutMs?: number;
	/** Deadline for an acknowledged Gateway control request. */
	requestTimeoutMs?: number;
}

export interface GatewayRemoteClientOptions {
	/** ws:// is accepted only for loopback unless this development escape hatch is true. */
	url: string;
	auth: string;
	clientName?: string;
	clientVersion?: string;
	clientId?: string;
	connectTimeoutMs?: number;
	/** Deadline for an acknowledged Gateway control request. */
	requestTimeoutMs?: number;
	allowInsecure?: boolean;
	/** Node TLS validation remains enabled unless explicitly disabled for development. */
	rejectUnauthorized?: boolean;
}

export type GatewayEventListener = (event: GatewayEvent) => void;
export type GatewayServerRequestHandler = (
	request: GatewayServerRequest,
) => Promise<unknown> | unknown;

// Re-exported so `@cline/gateway/client` consumers never reach into the
// Gateway's internals for the types the typed surface returns, nor for
// discovery/path resolution (the supported client-side surface).
export type {
	QueuedRunPromotionResult,
	QueuedRunUpdateResult,
	ScheduleCreateParams,
	ScheduleDeleteResult,
	ScheduleTriggerResult,
	ScheduleUpdateParams,
	SessionDeleteResult,
	SessionForkResult,
	SessionSnapshot,
	SessionUpdateParams,
} from "./runtime";
export type { RunAttemptRecord, StoredMessage } from "./stores";
export type { BotRecord, RunRecord, SessionKind, SessionRecord, TurnOverrides };
export type { ConnectorRecord } from "./connectors/store";
export type { DiscoveryRecord } from "./discovery";
export type {
	GatewayGlobalSettings,
	GatewayGlobalSettingsPatch,
} from "./global-settings";
export type {
	GatewayManagedExtensionsResponse,
	GatewayManagedPluginView,
	GatewayManagedSkillView,
	GatewayMarketplaceActionResult,
	GatewayMarketplaceCatalog,
	GatewayMcpServerInput,
	GatewayMcpServersResponse,
	GatewayMcpServerView,
	GatewayMcpTransportType,
	MarketplacePrimitiveType,
} from "./managed-extensions";
export type {
	ScheduleJobRecord,
	ScheduleMode,
	ScheduleModelSelection,
	ScheduleRecord,
} from "./schedules/store";
export type {
	ToolConfigurationScope,
	VersionedToolConfiguration,
} from "./tools/store";
export type {
	VoiceSettingsResult,
	VoiceStreamingSession,
	VoiceTranscriptionInput,
	VoiceTranscriptionResult,
} from "./voice";
export type {
	BotToolConfiguration,
	EffectiveToolPreview,
	ToolDescriptor,
	ToolProfile,
};
export { DiscoveryRecordSchema, readDiscoveryRecord } from "./discovery";
export type { GatewayPaths, GatewayPathsOptions } from "./paths";
export {
	DEFAULT_GATEWAY_NAMESPACE,
	defaultGatewayDataRoot,
	GATEWAY_DATA_ROOT_ENV,
	GATEWAY_NAMESPACE_ENV,
	resolveGatewayNamespace,
	resolveGatewayPaths,
} from "./paths";

/** `gateway.status` result (additive fields must not break clients). */
export interface GatewayStatusSummary {
	state: "serving" | "draining";
	executionMode: string;
	sandboxed: boolean;
	gatewayId: string;
	instanceId: string;
	pid: number;
	startedAt: number;
	protocolVersion: number;
	defaultBotId?: BotId;
	catalogGeneration: number;
	namespace: string;
	dataDir: string;
	/** Worker isolation health (Phase 4): driver/isolation/development. */
	execution?: {
		isolation: string;
		development: boolean;
		[extra: string]: unknown;
	};
	/** Plugin catalog summary (Phase 4): counts only, never entries. */
	plugins?: {
		generation: number;
		plugins: number;
		heldGenerations: readonly number[];
		pinnedByRuns: number;
		lastReloadOk: boolean;
	};
	tools?: { generation: number; registered: number; available: number };
	/** Live connector worker health (Phase 6, read-only diagnostics). */
	connectorHealth?: {
		running: readonly {
			connectorId: string;
			workerId: string;
			restarts: number;
			state: string;
		}[];
	};
	counts: {
		bots: number;
		sessions: number;
		queuedRuns: number;
		runningRuns: number;
		clients: number;
		pendingOutbox: number;
		lastEventSequence: number;
		pendingServerRequests: number;
		connectors?: number;
		schedules?: number;
	};
	port: number;
	connections: number;
	[extra: string]: unknown;
}

export interface StartRunInput {
	botId: BotId;
	prompt: string;
	sessionId?: SessionId;
	workspaceRoot?: string;
	newSession?: boolean;
	overrides?: TurnOverrides;
	idempotencyKey?: string;
}

export interface ApprovalResolution {
	approved: boolean;
	reason?: string;
}

/** `statistics.summary` result (bounded reads over daily aggregates). */
export interface StatisticsSummary {
	from: string;
	to: string;
	totals: {
		tokens: number;
		inputTokens: number;
		outputTokens: number;
		messages: number;
		modelCalls: number;
		estimatedCost: number;
	};
	agents: number;
	topics: number;
	activeModels: readonly { modelId: string; providerId: string }[];
	peakDailyTokens: number;
	longestTaskMs: number;
	[extra: string]: unknown;
}

interface PendingRequest {
	resolve(value: unknown): void;
	reject(error: Error): void;
	timeoutId: ReturnType<typeof setTimeout>;
}

export const DEFAULT_GATEWAY_REQUEST_TIMEOUT_MS = 30_000;
const VOICE_GATEWAY_REQUEST_TIMEOUT_MS = 125_000;

function resolveRequestTimeoutMs(value: number | undefined): number {
	const timeout = value ?? DEFAULT_GATEWAY_REQUEST_TIMEOUT_MS;
	if (!Number.isFinite(timeout) || timeout <= 0) {
		throw new Error("Gateway requestTimeoutMs must be a positive number");
	}
	return timeout;
}

export class GatewayClient {
	readonly hello: GatewayHelloResult;

	private readonly socket: Duplex;
	private readonly requestTimeoutMs: number;
	private readonly pending = new Map<string, PendingRequest>();
	private readonly eventListeners = new Set<GatewayEventListener>();
	private readonly closeListeners = new Set<() => void>();
	private serverRequestHandler: GatewayServerRequestHandler | undefined;
	private buffer = "";
	private nextRequestId = 0;
	private closed = false;
	private closeNotified = false;

	private constructor(
		socket: Duplex,
		hello: GatewayHelloResult,
		requestTimeoutMs: number,
	) {
		this.socket = socket;
		this.hello = hello;
		this.requestTimeoutMs = requestTimeoutMs;
	}

	/** Connect and complete the mandatory `gateway.hello` handshake. */
	static async connect(options: GatewayClientOptions): Promise<GatewayClient> {
		const socket = await connectSocket(options);
		const transport = new TransportShim(socket);
		try {
			const helloResult = await transport.request(
				GATEWAY_HELLO_METHOD,
				{
					protocolVersions: [GATEWAY_PROTOCOL_VERSION],
					client: {
						name: options.clientName ?? "gateway-client",
						version: options.clientVersion ?? "0.0.0",
						...(options.clientId ? { clientId: options.clientId } : {}),
					},
					auth: options.auth,
				},
				options.connectTimeoutMs ?? 5_000,
			);
			const client = new GatewayClient(
				socket,
				helloResult as GatewayHelloResult,
				resolveRequestTimeoutMs(options.requestTimeoutMs),
			);
			transport.handover(client);
			return client;
		} catch (error) {
			socket.destroy();
			throw error;
		}
	}

	/** Connect using a discovery record (endpoint + secret). */
	static async connectToDiscovery(
		record: DiscoveryRecord,
		options: Partial<GatewayClientOptions> = {},
	): Promise<GatewayClient> {
		return GatewayClient.connect({
			host: record.host,
			port: record.port,
			auth: record.auth,
			...options,
		});
	}

	/** Connect to an explicitly configured remote ws(s):// Gateway endpoint. */
	static async connectRemote(
		options: GatewayRemoteClientOptions,
	): Promise<GatewayClient> {
		const url = validateRemoteUrl(options.url, options.allowInsecure ?? false);
		const socket = await connectWebSocket(url, options);
		const transport = new TransportShim(socket);
		try {
			const helloResult = await transport.request(
				GATEWAY_HELLO_METHOD,
				{
					protocolVersions: [GATEWAY_PROTOCOL_VERSION],
					client: {
						name: options.clientName ?? "gateway-remote-client",
						version: options.clientVersion ?? "0.0.0",
						...(options.clientId ? { clientId: options.clientId } : {}),
					},
					auth: options.auth,
				},
				options.connectTimeoutMs ?? 5_000,
			);
			const client = new GatewayClient(
				socket,
				helloResult as GatewayHelloResult,
				resolveRequestTimeoutMs(options.requestTimeoutMs),
			);
			transport.handover(client);
			return client;
		} catch (error) {
			socket.destroy();
			throw error;
		}
	}

	/** Issue a request; mutating methods should go through `mutate`. */
	request(
		method: string,
		params?: Record<string, unknown>,
		requestTimeoutMs = this.requestTimeoutMs,
	): Promise<unknown> {
		if (this.closed) {
			return Promise.reject(
				new GatewayRequestError(
					createGatewayError("gateway_unreachable", "Connection is closed"),
				),
			);
		}
		this.nextRequestId += 1;
		const id = `req_${this.nextRequestId}`;
		const request: GatewayRequest = {
			version: GATEWAY_PROTOCOL_VERSION,
			id,
			method,
			...(params ? { params } : {}),
		};
		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				const pending = this.pending.get(id);
				if (!pending) return;
				this.pending.delete(id);
				const failure = new GatewayRequestError(
					createGatewayError(
						"gateway_unreachable",
						`Timed out waiting for Gateway method ${method}`,
						{ retryable: true },
					),
				);
				pending.reject(failure);
				// A silent control channel is not a healthy connection. Closing it
				// rejects every other waiter and lets supervised clients reconnect
				// instead of remaining half-connected indefinitely.
				this.handleDisconnect();
				this.socket.destroy();
			}, requestTimeoutMs);
			this.pending.set(id, { resolve, reject, timeoutId });
			try {
				this.socket.write(`${JSON.stringify(request)}\n`);
			} catch (error) {
				clearTimeout(timeoutId);
				this.pending.delete(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	/** Issue a mutating request, generating an idempotency key if absent. */
	mutate(
		method: string,
		params: Record<string, unknown> = {},
		requestTimeoutMs?: number,
	): Promise<unknown> {
		const withKey = {
			...params,
			[IDEMPOTENCY_KEY_PARAM]:
				params[IDEMPOTENCY_KEY_PARAM] ?? createIdempotencyKey(),
		};
		return this.request(method, withKey, requestTimeoutMs);
	}

	subscribe(params: {
		sessionId?: string;
		runId?: string;
		cursor?: string;
	}): Promise<unknown> {
		return this.request("run.subscribe", { ...params });
	}

	// ---------------------------------------------------------------------
	// Typed command surface (the supported application entrypoint)
	// ---------------------------------------------------------------------

	getStatus(): Promise<GatewayStatusSummary> {
		return this.request("gateway.status", {}) as Promise<GatewayStatusSummary>;
	}

	listBots(): Promise<{ bots: readonly BotRecord[] }> {
		return this.request("bot.list", {}) as Promise<{
			bots: readonly BotRecord[];
		}>;
	}

	getBotSystemPrompt(input: { botId: BotId }): Promise<{
		content: string | null;
		bundledContent: string | null;
		profileRulesContent: string | null;
		profileId: string | null;
		revision: number;
	}> {
		return this.request("bot.systemPrompt.get", input) as never;
	}

	putBotSystemPrompt(input: {
		botId: BotId;
		content: string;
		expectedRevision?: number;
	}): Promise<{
		content: string | null;
		bundledContent: string | null;
		profileRulesContent: string | null;
		profileId: string | null;
		revision: number;
	}> {
		return this.mutate("bot.systemPrompt.put", input) as never;
	}

	listProviderCatalog(): Promise<
		import("@cline/shared").ProviderCatalogResponse
	> {
		return this.request("provider.catalog.list", {}) as never;
	}

	listProviderModels(
		providerId: string,
	): Promise<import("@cline/shared").ProviderModelsResponse> {
		return this.request("provider.models.list", { providerId }) as never;
	}

	getProviderSettings(providerId: string): Promise<PublicProviderSettings> {
		return this.request("provider.settings.get", { providerId }) as never;
	}

	patchProviderSettings(
		providerId: string,
		patch: ProviderSettingsPatch,
	): Promise<PublicProviderSettings> {
		return this.mutate("provider.settings.patch", {
			providerId,
			...patch,
		}) as never;
	}

	addProvider(input: AddGatewayProviderInput): Promise<{
		providerId: string;
		modelsCount: number;
		settingsPath: string;
	}> {
		return this.mutate("provider.add", { ...input }) as never;
	}

	updateProviderModels(input: UpdateGatewayProviderModelsInput): Promise<{
		providerId: string;
		modelsCount: number;
	}> {
		return this.mutate("provider.models.put", { ...input }) as never;
	}

	loginProviderOAuth(
		providerId: "cline",
	): Promise<{ provider: "cline"; configured: true }> {
		// Device authorization intentionally waits for the user in a browser.
		return this.mutate(
			"provider.oauth.login",
			{ providerId },
			6 * 60 * 1_000,
		) as never;
	}

	cancelProviderOAuth(
		providerId: "cline",
	): Promise<{ provider: "cline"; cancelled: boolean }> {
		return this.mutate("provider.oauth.cancel", { providerId }) as never;
	}

	queryClineAccount<T extends GatewayClineAccountQuery>(
		input: T,
	): Promise<GatewayClineAccountQueryResult<T>> {
		return this.request("account.cline.query", { ...input }) as never;
	}

	switchClineAccount(
		organizationId?: string | null,
	): Promise<GatewayClineAccountSwitchResult> {
		return this.mutate("account.cline.switch", {
			operation: "switchAccount",
			organizationId,
		}) as never;
	}

	getGlobalSettings(): Promise<GatewayGlobalSettings> {
		return this.request("settings.global.get", {}) as never;
	}

	patchGlobalSettings(
		patch: GatewayGlobalSettingsPatch,
	): Promise<GatewayGlobalSettings> {
		return this.mutate("settings.global.patch", { ...patch }) as never;
	}

	setVoiceInput(
		selection: VoiceInputSelection | undefined,
	): Promise<VoiceSettingsResult> {
		return this.mutate("voice.settings.put", {
			selection: selection ?? null,
		}) as Promise<VoiceSettingsResult>;
	}

	createStreamingTranscriptionSession(): Promise<VoiceStreamingSession> {
		return this.request(
			"voice.transcription.createSession",
			{},
			VOICE_GATEWAY_REQUEST_TIMEOUT_MS,
		) as Promise<VoiceStreamingSession>;
	}

	transcribeAudio(
		input: VoiceTranscriptionInput,
	): Promise<VoiceTranscriptionResult> {
		return this.request(
			"voice.transcription.transcribe",
			{ ...input },
			VOICE_GATEWAY_REQUEST_TIMEOUT_MS,
		) as Promise<VoiceTranscriptionResult>;
	}

	listMarketplaceInstalled(): Promise<{ installedKeys: readonly string[] }> {
		return this.request("marketplace.installed.list", {}) as never;
	}

	getMarketplaceCatalog(): Promise<GatewayMarketplaceCatalog> {
		return this.request("marketplace.catalog.get", {}) as never;
	}

	installMarketplace(input: {
		type: MarketplacePrimitiveType;
		id: string;
	}): Promise<GatewayMarketplaceActionResult> {
		return this.mutate(
			"marketplace.install",
			{ ...input },
			5 * 60 * 1_000,
		) as never;
	}

	uninstallMarketplace(input: {
		type: MarketplacePrimitiveType;
		id: string;
	}): Promise<GatewayMarketplaceActionResult> {
		return this.mutate("marketplace.uninstall", { ...input }) as never;
	}

	listMcpServers(): Promise<GatewayMcpServersResponse> {
		return this.request("mcp.servers.list", {}) as never;
	}

	putMcpServer(
		input: GatewayMcpServerInput,
	): Promise<GatewayMcpServersResponse> {
		return this.mutate("mcp.servers.put", { ...input }) as never;
	}

	deleteMcpServer(name: string): Promise<GatewayMcpServersResponse> {
		return this.mutate("mcp.servers.delete", { name }) as never;
	}

	setMcpServerDisabled(
		name: string,
		disabled: boolean,
	): Promise<GatewayMcpServersResponse> {
		return this.mutate("mcp.servers.setDisabled", { name, disabled }) as never;
	}

	listManagedExtensions(): Promise<GatewayManagedExtensionsResponse> {
		return this.request("plugins.managed.list", {}) as never;
	}

	setPluginDisabled(
		path: string,
		disabled: boolean,
	): Promise<GatewayManagedExtensionsResponse> {
		return this.mutate("plugins.managed.setDisabled", {
			path,
			disabled,
		}) as never;
	}

	uninstallManagedExtension(input: {
		type: "mcp" | "skill" | "workflow" | "plugin";
		id?: string;
		name?: string;
		path?: string;
	}): Promise<GatewayMarketplaceActionResult> {
		return this.mutate("extensions.managed.uninstall", { ...input }) as never;
	}

	listSessions(
		input: { botId?: BotId } = {},
	): Promise<{ sessions: readonly SessionRecord[] }> {
		return this.request("session.list", { ...input }) as Promise<{
			sessions: readonly SessionRecord[];
		}>;
	}

	listRuns(
		input: { sessionId?: SessionId; runId?: RunId } = {},
	): Promise<{ runs: readonly RunRecord[] }> {
		return this.request("run.list", { ...input }) as Promise<{
			runs: readonly RunRecord[];
		}>;
	}

	getSession(input: {
		sessionId: SessionId;
		messageLimit?: number;
	}): Promise<SessionSnapshot> {
		return this.request("session.get", {
			sessionId: input.sessionId,
			...(input.messageLimit === undefined
				? {}
				: { messageLimit: input.messageLimit }),
		}) as Promise<SessionSnapshot>;
	}

	listTools(): Promise<{
		generation: number;
		entries: readonly {
			descriptor: ToolDescriptor;
			executorId: string;
			available: boolean;
			healthGeneration: number;
		}[];
	}> {
		return this.request("tools.catalog", {}) as never;
	}

	listToolProfiles(): Promise<{ profiles: readonly ToolProfile[] }> {
		return this.request("tools.profiles.list", {}) as never;
	}

	putToolProfile(input: {
		profile: ToolProfile;
		expectedRevision?: number;
		idempotencyKey?: string;
	}): Promise<ToolProfile> {
		return this.mutate("tools.profiles.put", {
			profile: input.profile,
			...(input.expectedRevision !== undefined
				? { expectedRevision: input.expectedRevision }
				: {}),
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		}) as Promise<ToolProfile>;
	}

	getToolConfiguration(
		scope: ToolConfigurationScope,
	): Promise<VersionedToolConfiguration | null> {
		return this.request("tools.configuration.get", { scope }) as never;
	}

	putToolConfiguration(input: {
		scope: ToolConfigurationScope;
		config: BotToolConfiguration;
		expectedRevision?: number;
		idempotencyKey?: string;
	}): Promise<VersionedToolConfiguration> {
		return this.mutate("tools.configuration.put", {
			scope: input.scope,
			config: input.config,
			...(input.expectedRevision !== undefined
				? { expectedRevision: input.expectedRevision }
				: {}),
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		}) as Promise<VersionedToolConfiguration>;
	}

	previewEffectiveTools(input: {
		botId: BotId;
		workspaceRoot: string;
		providerId: string;
		modelId: string;
		turn?: BotToolConfiguration;
	}): Promise<EffectiveToolPreview> {
		return this.request("tools.previewEffective", {
			...input,
		}) as Promise<EffectiveToolPreview>;
	}

	/** Admit a prompt; acks immediately without waiting for execution. */
	async startRun(input: StartRunInput): Promise<RunAccepted> {
		const result = await this.mutate("run.start", {
			botId: input.botId,
			prompt: input.prompt,
			...(input.sessionId ? { sessionId: input.sessionId } : {}),
			...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
			...(input.newSession ? { newSession: true } : {}),
			...(input.overrides ? { overrides: input.overrides } : {}),
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		});
		return RunAcceptedSchema.parse(result);
	}

	createSession(input: {
		botId: BotId;
		workspaceRoot?: string;
		kind?: SessionKind;
		idempotencyKey?: string;
	}): Promise<SessionRecord> {
		return this.mutate("session.create", {
			botId: input.botId,
			...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
			...(input.kind ? { kind: input.kind } : {}),
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		}) as Promise<SessionRecord>;
	}

	forkSession(input: {
		sessionId: SessionId;
		beforeRunCount?: number;
		idempotencyKey?: string;
	}): Promise<SessionForkResult> {
		return this.mutate("session.fork", {
			sessionId: input.sessionId,
			...(input.beforeRunCount === undefined
				? {}
				: { beforeRunCount: input.beforeRunCount }),
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		}) as Promise<SessionForkResult>;
	}

	updateSession(
		input: SessionUpdateParams & { idempotencyKey?: string },
	): Promise<SessionRecord> {
		return this.mutate("session.update", {
			sessionId: input.sessionId,
			...(input.title === undefined ? {} : { title: input.title }),
			...(input.metadata === undefined ? {} : { metadata: input.metadata }),
			...(input.expectedRevision === undefined
				? {}
				: { expectedRevision: input.expectedRevision }),
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		}) as Promise<SessionRecord>;
	}

	closeSession(input: {
		sessionId: SessionId;
		idempotencyKey?: string;
	}): Promise<SessionRecord> {
		return this.mutate("session.close", {
			sessionId: input.sessionId,
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		}) as Promise<SessionRecord>;
	}

	deleteSession(input: {
		sessionId: SessionId;
		idempotencyKey?: string;
	}): Promise<SessionDeleteResult> {
		return this.mutate("session.delete", {
			sessionId: input.sessionId,
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		}) as Promise<SessionDeleteResult>;
	}

	steerRun(input: {
		runId: RunId;
		text: string;
		idempotencyKey?: string;
	}): Promise<{ merged: boolean }> {
		return this.mutate("run.steer", {
			runId: input.runId,
			text: input.text,
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		}) as Promise<{ merged: boolean }>;
	}

	updateQueuedRun(input: {
		runId: RunId;
		input: string;
		idempotencyKey?: string;
	}): Promise<QueuedRunUpdateResult> {
		return this.mutate("run.updateQueued", {
			runId: input.runId,
			input: input.input,
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		}) as Promise<QueuedRunUpdateResult>;
	}

	promoteQueuedRun(input: {
		runId: RunId;
		idempotencyKey?: string;
	}): Promise<QueuedRunPromotionResult> {
		return this.mutate("run.promoteQueued", {
			runId: input.runId,
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		}) as Promise<QueuedRunPromotionResult>;
	}

	interruptRun(input: {
		runId: RunId;
		reason?: string;
		idempotencyKey?: string;
	}): Promise<{ state: string }> {
		return this.mutate("run.interrupt", {
			runId: input.runId,
			...(input.reason ? { reason: input.reason } : {}),
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		}) as Promise<{ state: string }>;
	}

	abortRun(input: {
		runId: RunId;
		reason?: string;
		idempotencyKey?: string;
	}): Promise<{ state: string }> {
		return this.mutate("run.abort", {
			runId: input.runId,
			...(input.reason ? { reason: input.reason } : {}),
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		}) as Promise<{ state: string }>;
	}

	/** Re-admit a failed/interrupted run: same runId, new attempt. */
	async retryRun(input: {
		runId: RunId;
		reason?: string;
		idempotencyKey?: string;
	}): Promise<RunAccepted> {
		const result = await this.mutate("run.retry", {
			runId: input.runId,
			...(input.reason ? { reason: input.reason } : {}),
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		});
		return RunAcceptedSchema.parse(result);
	}

	listConnectors(
		input: { botId?: BotId } = {},
	): Promise<{ connectors: readonly ConnectorRecord[] }> {
		return this.request("connector.list", { ...input }) as Promise<{
			connectors: readonly ConnectorRecord[];
		}>;
	}

	/** Register a bot-scoped connector; `credentialRef` names a secret file, never a secret. */
	registerConnector(input: {
		botId: BotId;
		kind: string;
		name: string;
		config?: Record<string, unknown>;
		credentialRef?: string;
		idempotencyKey?: string;
	}): Promise<ConnectorRecord> {
		return this.mutate("connector.register", {
			botId: input.botId,
			kind: input.kind,
			name: input.name,
			...(input.config ? { config: input.config } : {}),
			...(input.credentialRef ? { credentialRef: input.credentialRef } : {}),
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		}) as Promise<ConnectorRecord>;
	}

	/** Configure a connector while keeping Gateway secret paths authority-owned. */
	configureConnector(input: {
		botId: BotId;
		kind: "telegram" | "slack";
		name: string;
		credential: string;
		config?: Record<string, unknown>;
		idempotencyKey?: string;
	}): Promise<ConnectorRecord> {
		return this.mutate("connector.configure", {
			botId: input.botId,
			kind: input.kind,
			name: input.name,
			credential: input.credential,
			...(input.config ? { config: input.config } : {}),
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		}) as Promise<ConnectorRecord>;
	}

	listSchedules(
		input: { botId?: BotId } = {},
	): Promise<{ schedules: readonly ScheduleRecord[] }> {
		return this.request("schedule.list", { ...input }) as Promise<{
			schedules: readonly ScheduleRecord[];
		}>;
	}

	/** Create a schedule with exactly one interval, one-shot, or cron trigger. */
	createSchedule(
		input: ScheduleCreateParams & { idempotencyKey?: string },
	): Promise<ScheduleRecord> {
		const { idempotencyKey, ...params } = input;
		return this.mutate("schedule.create", {
			...params,
			...(idempotencyKey ? { [IDEMPOTENCY_KEY_PARAM]: idempotencyKey } : {}),
		}) as Promise<ScheduleRecord>;
	}

	updateSchedule(
		input: ScheduleUpdateParams & { idempotencyKey?: string },
	): Promise<ScheduleRecord> {
		const { idempotencyKey, ...params } = input;
		return this.mutate("schedule.update", {
			...params,
			...(idempotencyKey ? { [IDEMPOTENCY_KEY_PARAM]: idempotencyKey } : {}),
		}) as Promise<ScheduleRecord>;
	}

	enableSchedule(input: {
		scheduleId: ScheduleId;
		idempotencyKey?: string;
	}): Promise<ScheduleRecord> {
		return this.mutate("schedule.enable", {
			scheduleId: input.scheduleId,
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		}) as Promise<ScheduleRecord>;
	}

	disableSchedule(input: {
		scheduleId: ScheduleId;
		idempotencyKey?: string;
	}): Promise<ScheduleRecord> {
		return this.mutate("schedule.disable", {
			scheduleId: input.scheduleId,
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		}) as Promise<ScheduleRecord>;
	}

	triggerSchedule(input: {
		scheduleId: ScheduleId;
		idempotencyKey?: string;
	}): Promise<ScheduleTriggerResult> {
		return this.mutate("schedule.trigger", {
			scheduleId: input.scheduleId,
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		}) as Promise<ScheduleTriggerResult>;
	}

	deleteSchedule(input: {
		scheduleId: ScheduleId;
		idempotencyKey?: string;
	}): Promise<ScheduleDeleteResult> {
		return this.mutate("schedule.delete", {
			scheduleId: input.scheduleId,
			...(input.idempotencyKey
				? { [IDEMPOTENCY_KEY_PARAM]: input.idempotencyKey }
				: {}),
		}) as Promise<ScheduleDeleteResult>;
	}

	scheduleReport(input: {
		scheduleId: ScheduleId;
	}): Promise<{ jobs: readonly ScheduleJobRecord[] }> {
		return this.request("schedule.report", {
			scheduleId: input.scheduleId,
		}) as Promise<{ jobs: readonly ScheduleJobRecord[] }>;
	}

	// Statistics: bounded reads over the Gateway-maintained aggregates.

	statisticsSummary(
		range: { from?: string; to?: string } = {},
	): Promise<StatisticsSummary> {
		return this.request("statistics.summary", {
			...range,
		}) as Promise<StatisticsSummary>;
	}

	statisticsActivity(
		range: { from?: string; to?: string } = {},
	): Promise<Record<string, unknown>> {
		return this.request("statistics.activity", { ...range }) as Promise<
			Record<string, unknown>
		>;
	}

	statisticsRankings(input: {
		dimension: "model" | "agent" | "topic";
		from?: string;
		to?: string;
		limit?: number;
	}): Promise<Record<string, unknown>> {
		return this.request("statistics.rankings", { ...input }) as Promise<
			Record<string, unknown>
		>;
	}

	statisticsUsage(input: { month: string }): Promise<Record<string, unknown>> {
		return this.request("statistics.usage", { ...input }) as Promise<
			Record<string, unknown>
		>;
	}

	/**
	 * Answer a server-initiated approval request. First answer wins across
	 * all attached clients; the Gateway broadcasts `approval.resolved`.
	 */
	resolveApproval(requestId: string, resolution: ApprovalResolution): void {
		this.respondToServerRequest(requestId, {
			approved: resolution.approved,
			...(resolution.reason ? { reason: resolution.reason } : {}),
		});
	}

	/** Answer a server-initiated user question with the selected/free-form text. */
	resolveQuestion(requestId: string, answer: string): void {
		this.respondToServerRequest(requestId, answer);
	}

	onEvent(listener: GatewayEventListener): () => void {
		this.eventListeners.add(listener);
		return () => {
			this.eventListeners.delete(listener);
		};
	}

	/** Fires once when the connection is lost or closed locally. */
	onClose(listener: () => void): () => void {
		this.closeListeners.add(listener);
		return () => {
			this.closeListeners.delete(listener);
		};
	}

	/** Register the handler answering server-initiated requests. */
	onServerRequest(handler: GatewayServerRequestHandler): void {
		this.serverRequestHandler = handler;
	}

	respondToServerRequest(
		id: string,
		result: unknown,
		error?: GatewayError,
	): void {
		this.socket.write(
			`${JSON.stringify({
				version: GATEWAY_PROTOCOL_VERSION,
				id,
				...(error ? { error } : { result: result ?? null }),
			})}\n`,
		);
	}

	/** Destroy the connection. Never aborts runs (server-side invariant). */
	close(): void {
		this.closed = true;
		this.socket.destroy();
		const failure = new GatewayRequestError(
			createGatewayError("gateway_unreachable", "Connection closed locally"),
		);
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timeoutId);
			pending.reject(failure);
		}
		this.pending.clear();
		this.notifyClosed();
	}

	// ---------------------------------------------------------------------
	// Frame routing (also used by the handshake shim)
	// ---------------------------------------------------------------------

	handleFrame(value: unknown): void {
		if (typeof value !== "object" || value === null) {
			return;
		}
		const frame = value as Record<string, unknown>;
		if (typeof frame.sequence === "number" && typeof frame.event === "string") {
			const parsed = GatewayEventSchema.safeParse(frame);
			if (parsed.success) {
				for (const listener of this.eventListeners) {
					listener(parsed.data);
				}
			}
			return;
		}
		if (typeof frame.method === "string" && typeof frame.id === "string") {
			const parsed = GatewayServerRequestSchema.safeParse(frame);
			if (parsed.success) {
				this.dispatchServerRequest(parsed.data);
			}
			return;
		}
		if (typeof frame.id === "string") {
			this.settleResponse(frame as unknown as GatewayResponse);
		}
	}

	feed(chunk: string): void {
		this.buffer += chunk;
		for (;;) {
			const newline = this.buffer.indexOf("\n");
			if (newline === -1) {
				return;
			}
			const line = this.buffer.slice(0, newline).trim();
			this.buffer = this.buffer.slice(newline + 1);
			if (!line) {
				continue;
			}
			try {
				this.handleFrame(JSON.parse(line));
			} catch {
				// Skip malformed frames; correlation ids keep us consistent.
			}
		}
	}

	handleDisconnect(): void {
		this.closed = true;
		const failure = new GatewayRequestError(
			createGatewayError(
				"gateway_unreachable",
				"Connection to the Gateway was lost",
			),
		);
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timeoutId);
			pending.reject(failure);
		}
		this.pending.clear();
		this.notifyClosed();
	}

	private notifyClosed(): void {
		if (this.closeNotified) {
			return;
		}
		this.closeNotified = true;
		for (const listener of this.closeListeners) {
			listener();
		}
	}

	private settleResponse(response: GatewayResponse): void {
		const pending = this.pending.get(response.id);
		if (!pending) {
			return;
		}
		this.pending.delete(response.id);
		clearTimeout(pending.timeoutId);
		if (response.error) {
			pending.reject(new GatewayRequestError(response.error));
			return;
		}
		pending.resolve(response.result);
	}

	private dispatchServerRequest(request: GatewayServerRequest): void {
		const handler = this.serverRequestHandler;
		if (!handler) {
			return;
		}
		void (async () => {
			try {
				const result = await handler(request);
				this.respondToServerRequest(request.id, result);
			} catch (error) {
				this.respondToServerRequest(
					request.id,
					undefined,
					createGatewayError(
						"internal",
						error instanceof Error ? error.message : String(error),
					),
				);
			}
		})();
	}
}

/**
 * Minimal request transport used only for the handshake, before the
 * `GatewayClient` exists; then hands the socket stream over to it.
 */
class TransportShim {
	private readonly socket: Duplex;
	private buffer = "";
	private pendingResolve: ((value: unknown) => void) | undefined;
	private pendingReject: ((error: Error) => void) | undefined;
	private pendingTimeout: ReturnType<typeof setTimeout> | undefined;
	private client: GatewayClient | undefined;

	constructor(socket: Duplex) {
		this.socket = socket;
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => this.onData(chunk));
		socket.on("close", () => {
			if (this.pendingTimeout) clearTimeout(this.pendingTimeout);
			this.pendingReject?.(
				new GatewayRequestError(
					createGatewayError(
						"gateway_unreachable",
						"Connection closed during the handshake",
					),
				),
			);
			this.client?.handleDisconnect();
		});
	}

	request(
		method: string,
		params: Record<string, unknown>,
		timeoutMs: number,
	): Promise<unknown> {
		const request: GatewayRequest = {
			version: GATEWAY_PROTOCOL_VERSION,
			id: "hello_1",
			method,
			params,
		};
		return new Promise((resolve, reject) => {
			this.pendingResolve = resolve;
			this.pendingReject = reject;
			this.pendingTimeout = setTimeout(() => {
				this.pendingTimeout = undefined;
				reject(
					new GatewayRequestError(
						createGatewayError(
							"gateway_unreachable",
							`Timed out waiting for Gateway method ${method}`,
							{ retryable: true },
						),
					),
				);
				this.socket.destroy();
			}, timeoutMs);
			this.socket.write(`${JSON.stringify(request)}\n`);
		});
	}

	handover(client: GatewayClient): void {
		if (this.pendingTimeout) clearTimeout(this.pendingTimeout);
		this.pendingTimeout = undefined;
		this.client = client;
		if (this.buffer) {
			client.feed(this.buffer);
			this.buffer = "";
		}
	}

	private onData(chunk: string): void {
		if (this.client) {
			this.client.feed(chunk);
			return;
		}
		this.buffer += chunk;
		const newline = this.buffer.indexOf("\n");
		if (newline === -1) {
			return;
		}
		const line = this.buffer.slice(0, newline).trim();
		this.buffer = this.buffer.slice(newline + 1);
		let response: GatewayResponse;
		try {
			response = JSON.parse(line) as GatewayResponse;
		} catch {
			this.pendingReject?.(
				new GatewayRequestError(
					createGatewayError("invalid_request", "Malformed handshake response"),
				),
			);
			return;
		}
		if (response.error) {
			if (this.pendingTimeout) clearTimeout(this.pendingTimeout);
			this.pendingTimeout = undefined;
			this.pendingReject?.(new GatewayRequestError(response.error));
			return;
		}
		if (this.pendingTimeout) clearTimeout(this.pendingTimeout);
		this.pendingTimeout = undefined;
		this.pendingResolve?.(response.result);
	}
}

function connectSocket(options: GatewayClientOptions): Promise<Duplex> {
	return new Promise((resolve, reject) => {
		const socket = connect({ host: options.host, port: options.port });
		const timeout = setTimeout(() => {
			socket.destroy();
			reject(
				new GatewayRequestError(
					createGatewayError(
						"gateway_unreachable",
						`Timed out connecting to ${options.host}:${options.port}`,
						{ retryable: true },
					),
				),
			);
		}, options.connectTimeoutMs ?? 5_000);
		socket.once("connect", () => {
			clearTimeout(timeout);
			resolve(socket);
		});
		socket.once("error", (error) => {
			clearTimeout(timeout);
			socket.destroy();
			reject(
				new GatewayRequestError(
					createGatewayError(
						"gateway_unreachable",
						`Cannot reach the Gateway at ${options.host}:${options.port}: ${error.message}`,
						{ retryable: true },
					),
				),
			);
		});
	});
}

function validateRemoteUrl(value: string, allowInsecure: boolean): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`Invalid remote Gateway URL: ${value}`);
	}
	if (url.protocol !== "ws:" && url.protocol !== "wss:") {
		throw new Error("Remote Gateway URLs must use ws:// or wss://");
	}
	if (
		url.protocol === "ws:" &&
		!isLoopbackHost(url.hostname) &&
		!allowInsecure
	) {
		throw new Error(
			"Refusing insecure remote Gateway URL; use wss:// or explicitly allow insecure development",
		);
	}
	if (url.username || url.password || url.search) {
		throw new Error("Remote Gateway credentials must not be placed in URLs");
	}
	return url;
}

function connectWebSocket(
	url: URL,
	options: GatewayRemoteClientOptions,
): Promise<Duplex> {
	return new Promise((resolve, reject) => {
		const webSocket = new WebSocket(url, {
			rejectUnauthorized: options.rejectUnauthorized ?? true,
		});
		const onError = (error: Error) => {
			clearTimeout(timeout);
			webSocket.terminate();
			reject(
				new GatewayRequestError(
					createGatewayError(
						"gateway_unreachable",
						`Cannot reach the remote Gateway at ${url.origin}: ${error.message}`,
						{ retryable: true },
					),
				),
			);
		};
		const timeout = setTimeout(() => {
			webSocket.off("error", onError);
			webSocket.terminate();
			reject(
				new GatewayRequestError(
					createGatewayError(
						"gateway_unreachable",
						`Timed out connecting to ${url.origin}`,
						{ retryable: true },
					),
				),
			);
		}, options.connectTimeoutMs ?? 5_000);
		webSocket.once("open", () => {
			clearTimeout(timeout);
			webSocket.off("error", onError);
			resolve(createGatewayWebSocketStream(webSocket));
		});
		webSocket.once("error", onError);
	});
}
