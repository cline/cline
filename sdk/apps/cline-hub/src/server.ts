import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import {
	dirname,
	extname,
	join,
	normalize,
	basename as pathBasename,
	relative,
} from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type {
	ClineAccountActionRequest,
	ClineCoreStartInput,
	CoreSessionEvent,
	HubServerDiscoveryRecord,
	ProviderCapability,
	ProviderClient,
	ProviderProtocol,
	SessionRecord,
} from "@cline/core";
import {
	addLocalProvider,
	ClineAccountService,
	ClineCore,
	createLocalHubScheduleRuntimeHandlers,
	createUserInstructionConfigService,
	discoverPluginModulePaths,
	ensureCustomProvidersLoaded,
	ensureDetachedHubServer,
	executeClineAccountAction,
	getCoreBuiltinToolCatalog,
	getLocalProviderModels,
	HubScheduleCommandService,
	HubScheduleService,
	HubUIClient,
	Llms,
	listHookConfigFiles,
	listLocalProviders,
	listPluginTools,
	loginLocalProvider,
	normalizeOAuthProvider,
	ProviderSettingsManager,
	readGlobalSettings,
	resolveLocalClineAuthToken,
	resolvePluginConfigSearchPaths,
	resolveAgentConfigSearchPaths as resolveSharedAgentConfigSearchPaths,
	SessionSource,
	saveLocalProviderOAuthCredentials,
	saveLocalProviderSettings,
	setDisabledPlugin,
	setDisabledTools,
	setTelemetryOptOutGlobally,
	stopLocalHubServerGracefully,
	toggleDisabledTool,
	toHubHealthUrl,
} from "@cline/core";
import type { Message } from "@cline/llms";
import type {
	AgentEvent,
	HubUINotifyPayload,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@cline/shared";
import { getClineEnvironmentConfig } from "@cline/shared";
import { resolveMcpSettingsPath } from "@cline/shared/storage";
import {
	buildInviteUrl,
	isNonLocalBindHost,
	resolveClineHubServerOptions,
} from "./options";
import type {
	WebviewActionSessionSummary,
	WebviewChatMessage,
	WebviewClientSummary,
	WebviewConfig,
	WebviewHubEvent,
	WebviewHubState,
	WebviewInboundMessage,
	WebviewOutboundMessage,
	WebviewProviderModel,
	WebviewReasonLevel,
	WebviewSessionSummary,
	WebviewToolEvent,
} from "./webview-protocol";

type BrowserFrame = WebviewInboundMessage | { type: "restart_hub" };

function toRuntimeReasoningOptions(
	reasonLevel?: WebviewReasonLevel,
): Pick<ClineCoreStartInput["config"], "reasoningEffort" | "thinking"> {
	if (reasonLevel === undefined) {
		return {};
	}
	if (reasonLevel === "none") {
		return { thinking: false };
	}
	return {
		thinking: true,
		reasoningEffort: reasonLevel,
	};
}

function asWebviewReasonLevel(value: unknown): WebviewReasonLevel | undefined {
	return value === "none" ||
		value === "low" ||
		value === "medium" ||
		value === "high"
		? value
		: undefined;
}

interface BrowserConfig {
	inviteRequired: boolean;
	publicUrl: string;
}

type TrackedClient = {
	clientId: string;
	displayName?: string;
	clientType: string;
	connectedAt: number;
};

type TrackedSession = {
	sessionId: string;
	status: string;
	title: string;
	workspaceRoot: string;
	cwd?: string;
	provider?: string;
	model?: string;
	source?: string;
	createdAt: number;
	updatedAt: number;
	createdByClientId?: string;
	prompt?: string;
	inputTokens?: number;
	outputTokens?: number;
	totalCost?: number;
	agentCount: number;
	participantCount: number;
};

type SessionContext = {
	workspaceRoot: string;
	cwd: string;
	providerId: string;
	modelId: string;
};

type BrowserPeer = {
	socket: Bun.ServerWebSocket<BrowserPeer>;
	displayName: string;
	selectedSessionId?: string;
	unsubscribeEvents?: () => void;
	sending: boolean;
};

type PendingToolApproval = {
	sessionId: string;
	resolve: (result: ToolApprovalResult) => void;
	timeout: ReturnType<typeof setTimeout>;
};

const options = resolveClineHubServerOptions();
const { host, port, publicUrl, roomSecret, workspaceRoot } = options;
const peers = new Set<BrowserPeer>();
const inviteUrl = buildInviteUrl(publicUrl, roomSecret);
const serverDir = dirname(fileURLToPath(import.meta.url));
const webviewDistDir = join(serverDir, "../dist/webview");
const providerSettingsManager = new ProviderSettingsManager();
const browserConfig: BrowserConfig = {
	inviteRequired: Boolean(roomSecret),
	publicUrl,
};

let hubUrl = "";
let hubAuthToken = "";
let cline: ClineCore | undefined;
let uiClient: HubUIClient | undefined;
let hubStartedAt: string | undefined;
let coreVersion: string | undefined;
const clients = new Map<string, TrackedClient>();
const sessions = new Map<string, TrackedSession>();
const pendingToolApprovals = new Map<string, PendingToolApproval>();
const events: WebviewHubEvent[] = [];
let lastSessionContext: SessionContext | undefined;
let initialHubEventEmitted = false;

function send(peer: BrowserPeer, payload: unknown): void {
	peer.socket.send(JSON.stringify(payload));
}

function broadcast(payload: unknown): void {
	const data = JSON.stringify(payload);
	for (const peer of peers) {
		peer.socket.send(data);
	}
}

function isAuthorizedBrowserRequest(url: URL): boolean {
	if (!roomSecret) return true;
	return url.searchParams.get("roomSecret") === roomSecret;
}

function createJsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

function createTextResponse(text: string, status = 200): Response {
	return new Response(text, {
		status,
		headers: { "content-type": "text/plain; charset=utf-8" },
	});
}

function contentTypeFor(path: string): string {
	switch (extname(path)) {
		case ".html":
			return "text/html; charset=utf-8";
		case ".js":
			return "text/javascript; charset=utf-8";
		case ".css":
			return "text/css; charset=utf-8";
		case ".svg":
			return "image/svg+xml";
		case ".png":
			return "image/png";
		case ".ico":
			return "image/x-icon";
		case ".woff2":
			return "font/woff2";
		default:
			return "application/octet-stream";
	}
}

function resolveStaticPath(pathname: string): string | undefined {
	const decoded = decodeURIComponent(pathname);
	const requested = decoded === "/" ? "/index.html" : decoded;
	const normalized = normalize(requested).replace(/^(\.\.[/\\])+/, "");
	const relativePath = normalized.replace(/^[/\\]+/, "");
	const filePath = join(webviewDistDir, relativePath);
	if (relative(webviewDistDir, filePath).startsWith("..")) {
		return undefined;
	}
	return filePath;
}

async function serveWebviewAsset(pathname: string): Promise<Response> {
	const devServerUrl = process.env.VITE_DEV_SERVER_URL?.trim();
	if (devServerUrl && (pathname === "/" || pathname === "/index.html")) {
		return new Response(renderDevIndexHtml(devServerUrl), {
			headers: { "content-type": "text/html; charset=utf-8" },
		});
	}

	const filePath = resolveStaticPath(pathname);
	if (!filePath) return createTextResponse("not found", 404);
	const file = Bun.file(filePath);
	if (!(await file.exists())) {
		if (pathname === "/" || pathname === "/index.html") {
			return createTextResponse(
				"Cline Hub webview is not built. Run `bun run build:webview` from sdk/apps/cline-hub.",
				503,
			);
		}
		return createTextResponse("not found", 404);
	}
	return new Response(file, {
		headers: { "content-type": contentTypeFor(filePath) },
	});
}

function renderDevIndexHtml(devServerUrl: string): string {
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script type="module">
    import RefreshRuntime from "${devServerUrl}/@react-refresh";
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
  </script>
  <script type="module" src="${devServerUrl}/@vite/client"></script>
  <title>Cline Hub</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${devServerUrl}/src/main.tsx"></script>
</body>
</html>`;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: undefined;
}

type JsonRecord = Record<string, unknown>;

function asTimestamp(value: unknown): number | undefined {
	const numeric = asNumber(value);
	if (numeric !== undefined) return numeric;
	if (typeof value !== "string" || !value.trim()) return undefined;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : undefined;
}

function basename(value: string | undefined): string {
	const trimmed = value?.trim();
	if (!trimmed) return "workspace";
	const parts = trimmed.split(/[\\/]+/).filter(Boolean);
	return parts.at(-1) ?? trimmed;
}

function isVisibleClient(clientType: string): boolean {
	return clientType.trim().length > 0;
}

function isActiveSession(
	title: string | undefined,
	status: string | undefined,
	participantCount?: number,
): boolean {
	if (!title || !status) return false;
	const normalized = status?.trim().toLowerCase();
	if (normalized !== "running" && normalized !== "idle") return false;
	return typeof participantCount === "number" ? participantCount > 0 : false;
}

function formatUptime(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const d = Math.floor(total / 86_400);
	const h = Math.floor((total % 86_400) / 3_600);
	const m = Math.floor((total % 3_600) / 60);
	const s = total % 60;
	if (d > 0) return `${d}d ${h}h`;
	if (h > 0) return `${h}h ${m}m`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

function formatClientLabel(clientType: string | undefined): string {
	const normalized = clientType?.trim().toLowerCase() ?? "";
	if (!normalized || normalized === "unknown") return "Client";
	if (normalized.includes("cline")) return "Cline";
	return normalized
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function formatClientName(client: TrackedClient): string {
	return (
		client.displayName?.trim() ||
		client.clientType.trim() ||
		client.clientId.trim() ||
		"Unknown"
	);
}

function formatSessionCreator(session: TrackedSession): string {
	const clientId = session.createdByClientId?.trim();
	if (!clientId) return "Unknown client";
	const client = clients.get(clientId);
	return client ? formatClientName(client) : clientId;
}

function summarizeClient(client: TrackedClient): {
	key: string;
	label: string;
	name: string;
} {
	const normalizedType = client.clientType.trim().toLowerCase();
	if (
		normalizedType === "code-sidecar" ||
		normalizedType === "code-sidecar-approvals" ||
		normalizedType === "code-sidecar-list"
	) {
		return {
			key: "code-app",
			label: "Code App",
			name: "Code App",
		};
	}
	return {
		key: client.clientId,
		label: formatClientLabel(client.clientType),
		name: formatClientName(client),
	};
}

function pushEvent(
	title: string,
	body: string,
	severity: WebviewHubEvent["severity"] = "info",
	timestamp = Date.now(),
): void {
	events.unshift({
		id: `${timestamp}-${events.length}-${title}`,
		title,
		body,
		severity,
		timestamp,
	});
	if (events.length > 30) events.length = 30;
}

function metadataFor(record: Record<string, unknown>): Record<string, unknown> {
	return asRecord(record.metadata) ?? {};
}

function usageFor(record: Record<string, unknown>): Record<string, unknown> {
	const metadata = metadataFor(record);
	return (
		asRecord(record.aggregateUsage) ??
		asRecord(record.usage) ??
		asRecord(metadata.aggregateUsage) ??
		asRecord(metadata.usage) ??
		{}
	);
}

function sessionTitle(record: Record<string, unknown>): string {
	const metadata = metadataFor(record);
	const title = asString(metadata.title);
	if (title) return title;
	const prompt = asString(record.prompt) ?? asString(metadata.prompt);
	if (prompt) return prompt.length > 34 ? `${prompt.slice(0, 31)}...` : prompt;
	return basename(asString(record.workspaceRoot) ?? asString(record.cwd));
}

function stringifyContent(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		return value
			.map((entry) => {
				if (typeof entry === "string") return entry;
				if (entry && typeof entry === "object") {
					const record = entry as Record<string, unknown>;
					return (
						asString(record.text) ??
						asString(record.content) ??
						asString(record.result) ??
						""
					);
				}
				return "";
			})
			.filter(Boolean)
			.join("\n");
	}
	if (value == null) return "";
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function mapHistoryToWebviewMessages(history: unknown[]): WebviewChatMessage[] {
	return history.map((entry, index) => {
		const record =
			entry && typeof entry === "object"
				? (entry as Record<string, unknown>)
				: { content: entry };
		const rawRole = asString(record.role)?.toLowerCase();
		const role: WebviewChatMessage["role"] =
			rawRole === "user" || rawRole === "assistant" || rawRole === "error"
				? rawRole
				: "meta";
		const text = stringifyContent(record.content ?? record.text ?? record);
		return {
			id: asString(record.id) ?? `history-${index}`,
			role,
			text,
			blocks: text ? [{ id: `history-${index}-text`, type: "text", text }] : [],
		};
	});
}

function trackSession(record: unknown): TrackedSession | undefined {
	const raw =
		record && typeof record === "object"
			? (record as Record<string, unknown>)
			: {};
	const sessionId = asString(raw.sessionId);
	if (!sessionId) return undefined;
	const metadata = metadataFor(raw);
	const usage = usageFor(raw);
	const participantCount = Array.isArray(raw.participants)
		? raw.participants.length
		: 0;
	const createdAt =
		asTimestamp(raw.createdAt) ??
		asTimestamp(raw.startedAt) ??
		asTimestamp(metadata.createdAt) ??
		Date.now();
	return {
		sessionId,
		status: asString(raw.status) ?? "running",
		title: sessionTitle(raw),
		workspaceRoot: asString(raw.workspaceRoot) ?? asString(raw.cwd) ?? "",
		cwd: asString(raw.cwd),
		provider: asString(raw.provider) ?? asString(metadata.provider),
		model: asString(raw.model) ?? asString(metadata.model),
		source: asString(raw.source) ?? asString(metadata.source),
		createdAt,
		updatedAt:
			asTimestamp(raw.updatedAt) ??
			asTimestamp(raw.endedAt) ??
			asTimestamp(metadata.updatedAt) ??
			createdAt,
		createdByClientId: asString(raw.createdByClientId),
		prompt: asString(raw.prompt) ?? asString(metadata.prompt),
		inputTokens:
			asNumber(usage.inputTokens) ??
			asNumber(usage.input) ??
			asNumber(usage.totalInputTokens),
		outputTokens:
			asNumber(usage.outputTokens) ??
			asNumber(usage.output) ??
			asNumber(usage.totalOutputTokens),
		totalCost: asNumber(usage.totalCost) ?? asNumber(metadata.totalCost),
		agentCount: Math.max(1, participantCount),
		participantCount,
	};
}

function toActionSessionSummary(
	session: TrackedSession,
): WebviewActionSessionSummary {
	return {
		sessionId: session.sessionId,
		title: session.title || basename(session.workspaceRoot || session.cwd),
		status: session.status,
		workspaceRoot: session.workspaceRoot,
		workspaceName: basename(session.workspaceRoot || session.cwd),
		cwd: session.cwd,
		model: session.model,
		provider: session.provider,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
		createdByClientId: session.createdByClientId,
		prompt: session.prompt,
		inputTokens: session.inputTokens,
		outputTokens: session.outputTokens,
		totalCost: session.totalCost,
		agentCount: session.agentCount,
	};
}

function clientSummariesPayload(): WebviewClientSummary[] {
	const sessionCounts = new Map<string, number>();
	for (const session of sessions.values()) {
		if (
			!isActiveSession(session.title, session.status, session.participantCount)
		)
			continue;
		const clientId = session.createdByClientId?.trim();
		if (!clientId) continue;
		sessionCounts.set(clientId, (sessionCounts.get(clientId) ?? 0) + 1);
	}
	const grouped = new Map<
		string,
		WebviewClientSummary & { firstConnectedAt: number }
	>();
	for (const client of [...clients.values()].sort(
		(a, b) => a.connectedAt - b.connectedAt,
	)) {
		const summary = summarizeClient(client);
		const existing = grouped.get(summary.key);
		if (existing) {
			existing.sessionCount += sessionCounts.get(client.clientId) ?? 0;
			existing.firstConnectedAt = Math.min(
				existing.firstConnectedAt,
				client.connectedAt,
			);
			continue;
		}
		grouped.set(summary.key, {
			label: summary.label,
			name: summary.name,
			sessionCount: sessionCounts.get(client.clientId) ?? 0,
			firstConnectedAt: client.connectedAt,
		});
	}
	return [...grouped.values()]
		.sort((a, b) => a.firstConnectedAt - b.firstConnectedAt)
		.map(({ label, name, sessionCount }) => ({ label, name, sessionCount }));
}

function toWebviewSessionSummary(
	session: TrackedSession,
): WebviewSessionSummary {
	return {
		sessionId: session.sessionId,
		title: session.title,
		status: session.status,
		source: session.source,
		providerId: session.provider,
		model: session.model,
		workspaceRoot: session.workspaceRoot,
		updatedAt: session.updatedAt,
		inputTokens: session.inputTokens,
		outputTokens: session.outputTokens,
		totalCost: session.totalCost,
	};
}

function webviewSessionsPayload(): WebviewOutboundMessage {
	return {
		type: "sessions",
		sessions: [...sessions.values()]
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.map(toWebviewSessionSummary),
	};
}

function parseSessionContext(record: unknown): SessionContext | undefined {
	const raw =
		record && typeof record === "object"
			? (record as Record<string, unknown>)
			: {};
	const metadata =
		raw.metadata && typeof raw.metadata === "object"
			? (raw.metadata as Record<string, unknown>)
			: {};
	const workspaceRootRaw = asString(raw.workspaceRoot);
	const providerId =
		asString(raw.providerId) ??
		asString(metadata.providerId) ??
		asString(raw.provider) ??
		asString(metadata.provider);
	const modelId =
		asString(raw.modelId) ??
		asString(metadata.modelId) ??
		asString(raw.model) ??
		asString(metadata.model);
	if (!workspaceRootRaw || !providerId || !modelId) return undefined;
	return {
		workspaceRoot: workspaceRootRaw,
		cwd: asString(raw.cwd) ?? workspaceRootRaw,
		providerId,
		modelId,
	};
}

function resolveBrowserDefaults(): {
	provider?: string;
	model?: string;
	workspaceRoot: string;
	cwd: string;
} {
	const lastUsed = providerSettingsManager.getLastUsedProviderSettings();
	return {
		provider:
			lastUsed?.provider ??
			lastSessionContext?.providerId ??
			process.env.CLINE_PROVIDER?.trim(),
		model:
			lastUsed?.model ??
			lastSessionContext?.modelId ??
			process.env.CLINE_MODEL?.trim(),
		workspaceRoot: lastSessionContext?.workspaceRoot ?? workspaceRoot,
		cwd:
			lastSessionContext?.cwd ??
			lastSessionContext?.workspaceRoot ??
			workspaceRoot,
	};
}

async function loadProviders(peer: BrowserPeer): Promise<void> {
	await ensureCustomProvidersLoaded(providerSettingsManager);
	const state = providerSettingsManager.read();
	const defaults = resolveBrowserDefaults();
	const ids = Llms.getProviderIds().sort((a, b) => a.localeCompare(b));
	const providers = (
		await Promise.all(
			ids.map(async (id) => {
				const info = await Llms.getProvider(id);
				const enabled =
					Boolean(state.providers[id]?.settings) || id === defaults.provider;
				return {
					id,
					name: info?.name ?? id,
					enabled,
					defaultModelId: info?.defaultModelId,
				};
			}),
		)
	).filter((provider) => provider.enabled);
	send(peer, { type: "providers", providers });
	const selected =
		(defaults.provider &&
			providers.find((provider) => provider.id === defaults.provider)) ||
		providers[0];
	if (selected) {
		await loadModels(peer, selected.id);
	}
}

async function loadModels(
	peer: BrowserPeer,
	providerId: string,
): Promise<void> {
	const provider = providerId.trim();
	if (!provider) return;
	const payload = await getLocalProviderModels(
		provider,
		providerSettingsManager.getProviderConfig(provider),
	);
	const models: WebviewProviderModel[] = payload.models.map((model) => ({
		id: model.id,
		name: model.name,
		supportsReasoning: model.supportsReasoning,
		supportsThinking: model.supportsReasoning,
	}));
	send(peer, { type: "models", providerId: provider, models });
}

async function sendProviderCatalog(peer: BrowserPeer): Promise<void> {
	await ensureCustomProvidersLoaded(providerSettingsManager);
	const payload = await listLocalProviders(providerSettingsManager);
	send(peer, {
		type: "provider_catalog",
		providers: payload.providers,
		settingsPath: payload.settingsPath,
	});
}

async function saveProviderSettings(
	peer: BrowserPeer,
	frame: Extract<WebviewInboundMessage, { type: "saveProviderSettings" }>,
): Promise<void> {
	const result = saveLocalProviderSettings(providerSettingsManager, {
		providerId: frame.providerId,
		enabled: frame.enabled,
		apiKey: frame.apiKey,
		baseUrl: frame.baseUrl,
	});
	send(peer, {
		type: "provider_settings_saved",
		providerId: result.providerId,
		enabled: result.enabled,
	});
	await sendProviderCatalog(peer);
	await loadProviders(peer);
}

function openExternalUrl(url: string): void {
	const platform = process.platform;
	const command =
		platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
	const args = platform === "win32" ? ["/c", "start", "", url] : [url];
	const child = spawn(command, args, { stdio: "ignore", detached: true });
	child.unref();
}

async function runProviderOAuthLogin(
	peer: BrowserPeer,
	providerId: string,
): Promise<void> {
	const normalized = normalizeOAuthProvider(providerId);
	const existing = providerSettingsManager.getProviderSettings(normalized);
	const credentials = await loginLocalProvider(
		normalized,
		existing,
		openExternalUrl,
	);
	const saved = saveLocalProviderOAuthCredentials(
		providerSettingsManager,
		normalized,
		existing,
		credentials,
	);
	send(peer, {
		type: "provider_oauth_login_done",
		providerId: normalized,
		accessTokenPresent:
			(saved.auth?.accessToken?.trim() ?? saved.apiKey?.trim() ?? "").length >
			0,
	});
	await sendProviderCatalog(peer);
	await loadProviders(peer);
}

function readMcpServersResponse(): JsonRecord {
	const settingsPath = resolveMcpSettingsPath();
	if (!existsSync(settingsPath)) {
		return { settingsPath, hasSettingsFile: false, servers: [] };
	}
	const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as JsonRecord;
	const servers = parsed.mcpServers as JsonRecord | undefined;
	const entries = Object.entries(servers ?? {}).map(([name, body]) => {
		const record = body as JsonRecord;
		const transport =
			record.transport && typeof record.transport === "object"
				? (record.transport as JsonRecord)
				: undefined;
		const transportType = String(
			transport?.type ?? record.transportType ?? record.type ?? "stdio",
		).trim();
		return {
			name,
			transportType,
			disabled: record.disabled === true,
			command:
				typeof transport?.command === "string"
					? transport.command
					: typeof record.command === "string"
						? record.command
						: undefined,
			args: Array.isArray(transport?.args)
				? transport.args
				: Array.isArray(record.args)
					? record.args
					: undefined,
			cwd:
				typeof transport?.cwd === "string"
					? transport.cwd
					: typeof record.cwd === "string"
						? record.cwd
						: undefined,
			env:
				transport?.env && typeof transport.env === "object"
					? transport.env
					: record.env && typeof record.env === "object"
						? record.env
						: undefined,
			url:
				typeof transport?.url === "string"
					? transport.url
					: typeof record.url === "string"
						? record.url
						: undefined,
			headers:
				transport?.headers && typeof transport.headers === "object"
					? transport.headers
					: record.headers && typeof record.headers === "object"
						? record.headers
						: undefined,
			metadata: record.metadata,
		};
	});
	return { settingsPath, hasSettingsFile: true, servers: entries };
}

function writeMcpServersMap(servers: JsonRecord): void {
	const path = resolveMcpSettingsPath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`);
}

function ensureMcpSettingsFile(): string {
	const path = resolveMcpSettingsPath();
	if (!existsSync(path)) {
		writeMcpServersMap({});
	}
	return path;
}

function toPositiveInt(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	const rounded = Math.trunc(value);
	return rounded > 0 ? rounded : undefined;
}

function asTrimmedString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

let localRoutineScheduleService: HubScheduleService | undefined;
let localRoutineScheduleCommands: HubScheduleCommandService | undefined;

function getLocalRoutineScheduleCommands(): HubScheduleCommandService {
	if (!localRoutineScheduleService || !localRoutineScheduleCommands) {
		localRoutineScheduleService = new HubScheduleService({
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		localRoutineScheduleCommands = new HubScheduleCommandService(
			localRoutineScheduleService,
		);
	}
	return localRoutineScheduleCommands;
}

async function handleRoutineScheduleCommand(
	command: string,
	args?: Record<string, unknown>,
): Promise<unknown> {
	const clientCommand = async (
		hubCommand: string,
		payload?: Record<string, unknown>,
	) => {
		const reply = await getLocalRoutineScheduleCommands().handleCommand({
			version: "v1",
			clientId: "cline-hub-schedules",
			command: hubCommand as never,
			payload,
		});
		if (!reply.ok) {
			throw new Error(
				reply.error?.message ?? `hub command failed: ${hubCommand}`,
			);
		}
		return (reply.payload ?? {}) as Record<string, unknown>;
	};

	if (command === "list_routine_schedules") {
		const [schedules, activeExecutions, upcomingRuns] = await Promise.all([
			clientCommand("schedule.list", {
				limit: toPositiveInt(args?.limit) ?? 200,
			}),
			clientCommand("schedule.active"),
			clientCommand("schedule.upcoming", { limit: 30 }),
		]);
		return {
			schedules: schedules.schedules ?? [],
			activeExecutions: activeExecutions.executions ?? [],
			upcomingRuns: upcomingRuns.runs ?? [],
		};
	}

	if (command === "create_routine_schedule") {
		const name = asTrimmedString(args?.name);
		const cronPattern = asTrimmedString(args?.cron_pattern);
		const prompt = asTrimmedString(args?.prompt);
		const routineWorkspaceRoot = asTrimmedString(args?.workspace_root);
		if (!name || !cronPattern || !prompt || !routineWorkspaceRoot) {
			throw new Error(
				"createSchedule requires name, cron_pattern, prompt, and workspace_root",
			);
		}
		const created = await clientCommand("schedule.create", {
			name,
			cronPattern,
			prompt,
			modelSelection: {
				providerId: asTrimmedString(args?.provider) ?? "cline",
				modelId: asTrimmedString(args?.model) ?? "openai/gpt-5.3-codex",
			},
			mode: args?.mode === "plan" ? "plan" : "act",
			workspaceRoot: routineWorkspaceRoot,
			cwd: asTrimmedString(args?.cwd),
			systemPrompt: asTrimmedString(args?.system_prompt),
			maxIterations: toPositiveInt(args?.max_iterations),
			timeoutSeconds: toPositiveInt(args?.timeout_seconds),
			maxParallel: toPositiveInt(args?.max_parallel) ?? 1,
			enabled: args?.enabled !== false,
			tags:
				Array.isArray(args?.tags) && args.tags.length > 0
					? (args.tags as string[])
							.map((v) => v.trim())
							.filter((v) => v.length > 0)
					: undefined,
		});
		return { schedule: created.schedule ?? null };
	}

	const scheduleId = asTrimmedString(args?.schedule_id);
	if (!scheduleId) throw new Error(`${command} requires schedule_id`);
	if (command === "pause_routine_schedule") {
		const reply = await clientCommand("schedule.disable", { scheduleId });
		return { schedule: reply.schedule ?? null };
	}
	if (command === "resume_routine_schedule") {
		const reply = await clientCommand("schedule.enable", { scheduleId });
		return { schedule: reply.schedule ?? null };
	}
	if (command === "trigger_routine_schedule") {
		const reply = await clientCommand("schedule.trigger", { scheduleId });
		return { execution: reply.execution ?? null };
	}
	if (command === "delete_routine_schedule") {
		const reply = await clientCommand("schedule.delete", { scheduleId });
		return { deleted: reply.deleted === true };
	}
	throw new Error(`unsupported routine schedule command: ${command}`);
}

function resolveAgentConfigSearchPaths(workspaceRoot?: string): string[] {
	return resolveSharedAgentConfigSearchPaths(workspaceRoot);
}

async function listUserInstructionConfigs(
	targetWorkspaceRoot: string,
): Promise<JsonRecord> {
	const warnings: string[] = [];

	const loadUserInstructionSnapshot = async (
		type: "rule" | "skill" | "workflow",
	): Promise<unknown[]> => {
		const items: unknown[] = [];
		const service = createUserInstructionConfigService({
			skills: { workspacePath: targetWorkspaceRoot },
			rules: { workspacePath: targetWorkspaceRoot },
			workflows: { workspacePath: targetWorkspaceRoot },
		});
		try {
			await service.start();
			for (const record of service.listRecords(type)) {
				const item = record.item as unknown as JsonRecord;
				if (item.disabled === true) continue;
				items.push({
					id: record.id,
					name: item.name ?? record.id,
					instructions: item.instructions,
					path: record.filePath,
				});
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			warnings.push(`${type}: ${message}`);
		} finally {
			service.stop();
		}
		return items;
	};

	const loadAgents = (): unknown[] => {
		const agentsById = new Map<string, { name: string; path: string }>();
		const directories = resolveAgentConfigSearchPaths(
			targetWorkspaceRoot,
		).filter((d) => existsSync(d));
		for (const directory of directories) {
			try {
				for (const entry of readdirSync(directory, { withFileTypes: true })) {
					if (!entry.isFile()) continue;
					const ext = extname(entry.name).toLowerCase();
					if (ext !== ".yml" && ext !== ".yaml") continue;
					const filePath = join(directory, entry.name);
					const raw = readFileSync(filePath, "utf8");
					const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
					const fm = fmMatch?.[1] ?? "";
					const nameMatch = fm.match(/^\s*name:\s*(.+?)\s*$/m);
					const parsedName = nameMatch?.[1]?.replace(/^["']|["']$/g, "").trim();
					const name =
						parsedName && parsedName.length > 0
							? parsedName
							: pathBasename(entry.name, ext);
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
			return listHookConfigFiles(targetWorkspaceRoot);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			warnings.push(`hooks: ${message}`);
			return [];
		}
	};

	const loadPlugins = (): Array<{
		name: string;
		path: string;
		enabled: boolean;
	}> => {
		const disabledPlugins = new Set(readGlobalSettings().disabledPlugins ?? []);
		const pluginsByPath = new Map<
			string,
			{ name: string; path: string; enabled: boolean }
		>();
		const directories = resolvePluginConfigSearchPaths(
			targetWorkspaceRoot,
		).filter((d) => existsSync(d));
		for (const directory of directories) {
			try {
				for (const filePath of discoverPluginModulePaths(directory)) {
					if (pluginsByPath.has(filePath)) continue;
					pluginsByPath.set(filePath, {
						name: pathBasename(filePath, extname(filePath)),
						path: filePath,
						enabled: !disabledPlugins.has(filePath),
					});
				}
			} catch {
				// best-effort
			}
		}
		return [...pluginsByPath.values()].sort((a, b) =>
			a.name.localeCompare(b.name),
		);
	};

	const [rules, workflows, skills, pluginTools] = await Promise.all([
		loadUserInstructionSnapshot("rule"),
		loadUserInstructionSnapshot("workflow"),
		loadUserInstructionSnapshot("skill"),
		listPluginTools({
			workspacePath: targetWorkspaceRoot,
			cwd: targetWorkspaceRoot,
		}),
	]);
	const disabledTools = new Set(readGlobalSettings().disabledTools ?? []);
	const builtinToolCatalog = getCoreBuiltinToolCatalog({
		disabledToolIds: disabledTools,
	});

	return {
		workspaceRoot: targetWorkspaceRoot,
		rules,
		workflows,
		skills,
		agents: loadAgents(),
		plugins: loadPlugins(),
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
			...pluginTools.map((tool) => ({
				id: `${tool.pluginName}:${tool.name}:${tool.path}`,
				name: tool.name,
				description: tool.description,
				enabled: tool.enabled,
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

async function handleDesktopCommand(
	command: string,
	args?: Record<string, unknown>,
): Promise<unknown> {
	if (command === "list_provider_catalog") {
		await ensureCustomProvidersLoaded(providerSettingsManager);
		return await listLocalProviders(providerSettingsManager);
	}
	if (command === "list_provider_models") {
		const provider = String(args?.provider ?? "").trim();
		return await getLocalProviderModels(
			provider,
			providerSettingsManager.getProviderConfig(provider),
		);
	}
	if (command === "save_provider_settings") {
		return saveLocalProviderSettings(providerSettingsManager, {
			providerId: String(args?.provider ?? ""),
			enabled: typeof args?.enabled === "boolean" ? args.enabled : undefined,
			apiKey: typeof args?.api_key === "string" ? args.api_key : undefined,
			baseUrl: typeof args?.base_url === "string" ? args.base_url : undefined,
		});
	}
	if (command === "add_provider") {
		await ensureCustomProvidersLoaded(providerSettingsManager);
		return await addLocalProvider(providerSettingsManager, {
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
	if (command === "run_provider_oauth_login") {
		const providerId = normalizeOAuthProvider(String(args?.provider ?? ""));
		const existing = providerSettingsManager.getProviderSettings(providerId);
		const credentials = await loginLocalProvider(
			providerId,
			existing,
			openExternalUrl,
		);
		const saved = saveLocalProviderOAuthCredentials(
			providerSettingsManager,
			providerId,
			existing,
			credentials,
		);
		return {
			provider: providerId,
			accessToken: saved.auth?.accessToken ?? saved.apiKey ?? "",
		};
	}
	if (command === "cline_account") {
		const settings = providerSettingsManager.getProviderSettings("cline");
		const accountService = new ClineAccountService({
			apiBaseUrl:
				settings?.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl,
			getAuthToken: async () => resolveLocalClineAuthToken(settings),
		});
		return await executeClineAccountAction(
			args as ClineAccountActionRequest,
			accountService,
		);
	}
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
	if (command === "list_mcp_servers") {
		return readMcpServersResponse();
	}
	if (command === "set_mcp_server_disabled") {
		const path = ensureMcpSettingsFile();
		const parsed = JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
		const servers = (parsed.mcpServers as JsonRecord | undefined) ?? {};
		const name = String(args?.name ?? "").trim();
		const current = servers[name];
		if (!current || typeof current !== "object") {
			throw new Error(`unknown MCP server: ${name}`);
		}
		servers[name] = {
			...(current as JsonRecord),
			disabled: Boolean(args?.disabled),
		};
		writeMcpServersMap(servers);
		return readMcpServersResponse();
	}
	if (command === "upsert_mcp_server") {
		const input =
			args?.input && typeof args.input === "object"
				? (args.input as JsonRecord)
				: ((args ?? {}) as JsonRecord);
		const name = String(input.name ?? "").trim();
		if (!name) throw new Error("server name is required");
		const previousName = String(
			input.previousName ?? input.previous_name ?? "",
		).trim();
		const transportType = String(
			input.transportType ?? input.transport_type ?? "",
		).trim();
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
						disabled: input.disabled === true,
					}
				: {
						transport: {
							type: transportType === "sse" ? "sse" : "streamableHttp",
							url: input.url,
							headers: input.headers,
						},
						disabled: input.disabled === true,
					};
		const path = ensureMcpSettingsFile();
		const parsed = JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
		const servers = (parsed.mcpServers as JsonRecord | undefined) ?? {};
		if (previousName && previousName !== name) {
			delete servers[previousName];
		}
		servers[name] = next;
		writeMcpServersMap(servers);
		return readMcpServersResponse();
	}
	if (command === "delete_mcp_server") {
		const name = String(args?.name ?? "").trim();
		if (!name) throw new Error("server name is required");
		const path = ensureMcpSettingsFile();
		const parsed = JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
		const servers = (parsed.mcpServers as JsonRecord | undefined) ?? {};
		delete servers[name];
		writeMcpServersMap(servers);
		return readMcpServersResponse();
	}
	if (command === "ensure_mcp_settings_file") {
		return ensureMcpSettingsFile();
	}
	if (command === "open_mcp_settings_file") {
		const path = ensureMcpSettingsFile();
		openExternalUrl(path);
		return path;
	}
	if (
		command === "list_routine_schedules" ||
		command === "create_routine_schedule" ||
		command === "pause_routine_schedule" ||
		command === "resume_routine_schedule" ||
		command === "trigger_routine_schedule" ||
		command === "delete_routine_schedule"
	) {
		return await handleRoutineScheduleCommand(command, args);
	}
	if (command === "get_process_context") {
		return { workspaceRoot, cwd: workspaceRoot };
	}
	if (
		command === "list_cli_sessions" ||
		command === "list_discovered_sessions"
	) {
		return [...sessions.values()].map(toWebviewSessionSummary);
	}
	if (command === "read_session_hooks") {
		return [];
	}
	if (command === "list_user_instruction_configs") {
		return await listUserInstructionConfigs(workspaceRoot);
	}
	if (command === "toggle_disabled_plugin_tool") {
		const toolName = String(args?.name ?? "").trim();
		if (!toolName) throw new Error("tool name is required");
		toggleDisabledTool(toolName);
		return await listUserInstructionConfigs(workspaceRoot);
	}
	if (command === "set_tool_disabled") {
		const rawNames = Array.isArray(args?.names) ? args.names : [args?.name];
		const toolNames = rawNames
			.map((name) => String(name ?? "").trim())
			.filter(Boolean);
		if (toolNames.length === 0) throw new Error("tool name is required");
		setDisabledTools(toolNames, args?.disabled === true);
		return await listUserInstructionConfigs(workspaceRoot);
	}
	if (command === "set_plugin_disabled") {
		const pluginPath = String(args?.path ?? "").trim();
		if (!pluginPath) throw new Error("plugin path is required");
		setDisabledPlugin(pluginPath, args?.disabled === true);
		return await listUserInstructionConfigs(workspaceRoot);
	}
	throw new Error(`unsupported desktop command: ${command}`);
}

function hubStatePayload(): WebviewHubState {
	const sessionSummaries = [...sessions.values()]
		.filter((session) =>
			isActiveSession(session.title, session.status, session.participantCount),
		)
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.map(toActionSessionSummary);
	const clientList = [...clients.values()].sort(
		(a, b) => a.connectedAt - b.connectedAt,
	);
	return {
		type: "hub_state",
		connected: Boolean(cline && uiClient),
		hubUrl,
		hubStartedAt,
		coreVersion,
		hubUptime: hubStartedAt
			? formatUptime(Date.now() - Date.parse(hubStartedAt))
			: undefined,
		clients: clientList,
		sessions: sessionSummaries,
		clientSummaries: clientSummariesPayload(),
		sessionSummaries,
		events,
		lastWorkspaceRoot: lastSessionContext?.workspaceRoot,
	};
}

function broadcastHubState(): void {
	broadcast(hubStatePayload());
	broadcast(webviewSessionsPayload());
}

async function syncHubHealth(): Promise<void> {
	if (!hubUrl) return;
	try {
		const response = await fetch(toHubHealthUrl(hubUrl));
		if (!response.ok) return;
		const health = (await response.json()) as Partial<HubServerDiscoveryRecord>;
		if (typeof health.startedAt === "string") {
			hubStartedAt = health.startedAt;
		}
		if (typeof health.coreVersion === "string") {
			coreVersion = health.coreVersion;
		}
	} catch {
		// best-effort
	}
}

async function syncHubClientsAndSessions(): Promise<void> {
	if (!uiClient) return;
	const [knownClients, knownSessions] = await Promise.all([
		uiClient.listClients(),
		uiClient.listSessions(10),
	]);
	clients.clear();
	for (const client of knownClients) {
		if (!client.clientId || !isVisibleClient(client.clientType)) {
			continue;
		}
		clients.set(client.clientId, {
			clientId: client.clientId,
			displayName: client.displayName,
			clientType: client.clientType,
			connectedAt: client.connectedAt,
		});
	}
	sessions.clear();
	for (const session of knownSessions) {
		const tracked = trackSession(session);
		if (tracked) sessions.set(tracked.sessionId, tracked);
	}
	if (!initialHubEventEmitted) {
		const activeSessionCount = [...sessions.values()].filter((session) =>
			isActiveSession(session.title, session.status, session.participantCount),
		).length;
		pushEvent(
			"Hub monitor connected",
			`${clients.size} connected client${clients.size === 1 ? "" : "s"}, ${activeSessionCount} active session${activeSessionCount === 1 ? "" : "s"}`,
			"success",
		);
		initialHubEventEmitted = true;
	}
	const mostRecent = [...knownSessions]
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.map((s) => parseSessionContext(s))
		.find((c): c is SessionContext => Boolean(c));
	if (mostRecent) lastSessionContext = mostRecent;
}

function chunkText(chunk: unknown): string {
	if (typeof chunk === "string") return chunk;
	if (chunk && typeof chunk === "object") {
		const record = chunk as Record<string, unknown>;
		if (typeof record.text === "string") return record.text;
		if (typeof record.content === "string") return record.content;
	}
	return "";
}

function agentEventText(event: AgentEvent): string {
	if (
		event.type === "content_start" &&
		event.contentType === "text" &&
		typeof event.text === "string"
	) {
		return event.text;
	}
	return "";
}

function sendToSelectedPeers(
	sessionId: string,
	payload: WebviewOutboundMessage,
): void {
	for (const peer of peers) {
		if (peer.selectedSessionId === sessionId) {
			send(peer, payload);
		}
	}
}

function hasSelectedPeer(sessionId: string): boolean {
	for (const peer of peers) {
		if (peer.selectedSessionId === sessionId) return true;
	}
	return false;
}

function createApprovalId(): string {
	return `approval-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function resolveToolApproval(
	approvalId: string,
	result: ToolApprovalResult,
): boolean {
	const pending = pendingToolApprovals.get(approvalId);
	if (!pending) return false;
	clearTimeout(pending.timeout);
	pendingToolApprovals.delete(approvalId);
	sendToSelectedPeers(pending.sessionId, {
		type: "approval_resolved",
		approvalId,
		approved: result.approved,
		reason: result.reason,
	});
	pending.resolve(result);
	return true;
}

function rejectPendingApprovalsForSession(
	sessionId: string,
	reason: string,
): void {
	for (const [approvalId, pending] of [...pendingToolApprovals.entries()]) {
		if (pending.sessionId === sessionId) {
			resolveToolApproval(approvalId, { approved: false, reason });
		}
	}
}

function rejectAllPendingApprovals(reason: string): void {
	for (const approvalId of [...pendingToolApprovals.keys()]) {
		resolveToolApproval(approvalId, { approved: false, reason });
	}
}

function rejectOrphanedApprovals(): void {
	for (const [approvalId, pending] of [...pendingToolApprovals.entries()]) {
		if (!hasSelectedPeer(pending.sessionId)) {
			resolveToolApproval(approvalId, {
				approved: false,
				reason: "Cline Hub webview disconnected before approval was resolved.",
			});
		}
	}
}

function requestToolApprovalFromWebview(
	request: ToolApprovalRequest,
): Promise<ToolApprovalResult> {
	if (!hasSelectedPeer(request.sessionId)) {
		return Promise.resolve({
			approved: false,
			reason: "No Cline Hub webview is attached to this session.",
		});
	}

	const approvalId = createApprovalId();
	pushEvent(
		"Tool approval requested",
		`${request.toolName} is waiting for approval`,
		"warn",
	);
	broadcastHubState();

	return new Promise((resolve) => {
		const timeout = setTimeout(() => {
			resolveToolApproval(approvalId, {
				approved: false,
				reason: "Tool approval request timed out.",
			});
		}, 10 * 60_000);
		pendingToolApprovals.set(approvalId, {
			sessionId: request.sessionId,
			resolve,
			timeout,
		});
		sendToSelectedPeers(request.sessionId, {
			type: "approval_request",
			approvalId,
			sessionId: request.sessionId,
			agentId: request.agentId,
			conversationId: request.conversationId,
			iteration: request.iteration,
			toolCallId: request.toolCallId,
			toolName: request.toolName,
			input: request.input,
			policy: request.policy as Record<string, unknown> | undefined,
		});
	});
}

function handleToolApprovalResponse(
	frame: Extract<WebviewInboundMessage, { type: "approval_response" }>,
): void {
	const approvalId = frame.approvalId.trim();
	if (!approvalId) return;
	const resolved = resolveToolApproval(approvalId, {
		approved: frame.approved,
		reason:
			frame.reason ??
			(frame.approved ? "Approved in Cline Hub." : "Rejected in Cline Hub."),
	});
	if (!resolved) {
		console.warn(`Ignoring unknown tool approval response: ${approvalId}`);
	}
}

function sendChunkToSelectedPeers(sessionId: string, text: string): void {
	if (!text) return;
	sendToSelectedPeers(sessionId, { type: "assistant_delta", text });
}

function forwardAgentEvent(sessionId: string, event: AgentEvent): void {
	if (event.type === "content_start") {
		if (event.contentType === "reasoning") {
			sendToSelectedPeers(sessionId, {
				type: "reasoning_delta",
				text: event.reasoning ?? event.text ?? "",
				redacted: event.redacted,
			});
			return;
		}
		if (event.contentType === "tool") {
			sendToSelectedPeers(sessionId, {
				type: "tool_event",
				text: `Running ${event.toolName ?? "tool"}...`,
				event: {
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					status: "running",
					input: event.input,
				},
			});
			return;
		}
		const text = agentEventText(event);
		if (text) sendChunkToSelectedPeers(sessionId, text);
		return;
	}
	if (event.type === "content_update" && event.contentType === "tool") {
		const toolEvent: WebviewToolEvent = {
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			status: "running",
			output: event.update,
		};
		sendToSelectedPeers(sessionId, {
			type: "tool_event",
			text: `${event.toolName ?? "tool"} updated`,
			event: toolEvent,
		});
		return;
	}
	if (event.type === "content_end") {
		if (event.contentType === "reasoning") {
			sendToSelectedPeers(sessionId, {
				type: "reasoning_delta",
				text: event.reasoning ?? event.text ?? "",
			});
			return;
		}
		if (event.contentType === "tool") {
			const toolName = event.toolName ?? "tool";
			sendToSelectedPeers(sessionId, {
				type: "tool_event",
				text: event.error
					? `${toolName} failed: ${event.error}`
					: `${toolName} completed`,
				event: {
					toolCallId: event.toolCallId,
					toolName,
					status: event.error ? "failed" : "completed",
					output: event.output,
					error: event.error,
				},
			});
		}
		return;
	}
	if (event.type === "notice") {
		sendToSelectedPeers(sessionId, { type: "status", text: event.message });
		return;
	}
	if (event.type === "done") {
		sendToSelectedPeers(sessionId, {
			type: "turn_done",
			finishReason: event.reason,
			iterations: event.iterations,
			usage: event.usage
				? {
						inputTokens: event.usage.inputTokens,
						outputTokens: event.usage.outputTokens,
						cacheCreationInputTokens: event.usage.cacheWriteTokens,
						cacheReadInputTokens: event.usage.cacheReadTokens,
						totalCost: event.usage.totalCost,
					}
				: undefined,
		});
		return;
	}
	if (event.type === "error") {
		sendToSelectedPeers(sessionId, {
			type: "error",
			text: event.error.message,
		});
	}
}

function handleSessionEvent(event: CoreSessionEvent): void {
	const payload = event.payload as Record<string, unknown> | undefined;
	const sessionId = asString(payload?.sessionId);
	if (!sessionId) return;
	if (event.type === "chunk") {
		const text = chunkText((payload as Record<string, unknown>).chunk);
		sendChunkToSelectedPeers(sessionId, text);
	} else if (event.type === "agent_event") {
		if (event.payload.teamRole === "teammate") {
			return;
		}
		forwardAgentEvent(sessionId, event.payload.event);
	} else if (event.type === "status") {
		const status = asString((payload as Record<string, unknown>).status);
		const tracked = sessions.get(sessionId);
		if (tracked && status) {
			tracked.status = status;
			tracked.updatedAt = Date.now();
		}
		for (const peer of peers) {
			if (peer.selectedSessionId === sessionId) {
				send(peer, {
					type: "status",
					text: status ?? "Session status changed.",
				});
			}
		}
		broadcastHubState();
	} else if (event.type === "ended") {
		rejectPendingApprovalsForSession(
			sessionId,
			"Session ended before approval was resolved.",
		);
		const tracked = sessions.get(sessionId);
		if (tracked) {
			tracked.status = "completed";
			tracked.updatedAt = Date.now();
		}
		for (const peer of peers) {
			if (peer.selectedSessionId === sessionId) {
				send(peer, {
					type: "turn_done",
					finishReason: event.payload.reason,
					iterations: 0,
				});
			}
		}
		broadcastHubState();
	}
}

async function attachHub(): Promise<void> {
	const hub = await ensureDetachedHubServer(workspaceRoot);
	hubUrl = hub.url;
	hubAuthToken = hub.authToken;

	cline = await ClineCore.create({
		clientName: "cline-hub",
		backendMode: "hub",
		capabilities: {
			requestToolApproval: requestToolApprovalFromWebview,
		},
		hub: {
			endpoint: hubUrl,
			authToken: hubAuthToken,
			clientType: "cline-hub-chat",
			displayName: "Cline Hub Chat",
			workspaceRoot,
		},
	});

	uiClient = new HubUIClient({
		address: hubUrl,
		authToken: hubAuthToken,
		clientType: "cline-hub-server",
		displayName: "Cline Hub Server",
	});
	await uiClient.connect();

	uiClient.subscribeUI({
		onNotify(payload: HubUINotifyPayload) {
			pushEvent(
				payload.title,
				payload.body,
				payload.severity === "error"
					? "error"
					: payload.severity === "warning"
						? "warn"
						: "info",
			);
			broadcast({
				type: "notification",
				title: payload.title,
				body: payload.body,
				severity: payload.severity ?? "info",
			});
		},
		onClientRegistered(payload) {
			const clientId = asString(payload.clientId);
			const clientType = asString(payload.clientType) ?? "unknown";
			if (!clientId || !isVisibleClient(clientType)) {
				return;
			}
			clients.set(clientId, {
				clientId,
				displayName: asString(payload.displayName),
				clientType,
				connectedAt: Date.now(),
			});
			pushEvent(
				"Client connected",
				`${asString(payload.displayName) ?? clientType} joined the hub`,
				"success",
			);
			broadcastHubState();
		},
		onClientDisconnected(payload) {
			const clientId = asString(payload.clientId);
			if (!clientId) return;
			const client = clients.get(clientId);
			clients.delete(clientId);
			if (client) {
				pushEvent(
					"Client disconnected",
					`${formatClientName(client)} left the hub`,
					"info",
				);
			}
			broadcastHubState();
		},
		onSessionCreated(payload) {
			const record =
				payload.session && typeof payload.session === "object"
					? (payload.session as Record<string, unknown>)
					: (payload as unknown as Record<string, unknown>);
			const tracked = trackSession(record);
			if (tracked) {
				sessions.set(tracked.sessionId, tracked);
				const context = parseSessionContext(record);
				if (context) lastSessionContext = context;
				pushEvent(
					"Session started",
					`By ${formatSessionCreator(tracked)} at ${basename(tracked.workspaceRoot || tracked.cwd)}`,
					"success",
				);
				broadcastHubState();
			}
		},
		onSessionUpdated(payload) {
			const record =
				payload.session && typeof payload.session === "object"
					? (payload.session as Record<string, unknown>)
					: (payload as unknown as Record<string, unknown>);
			const tracked = trackSession(record);
			if (tracked) {
				sessions.set(tracked.sessionId, tracked);
				const context = parseSessionContext(record);
				if (context) lastSessionContext = context;
				broadcastHubState();
			}
		},
		onSessionDetached(payload) {
			const sessionId =
				asString((payload as Record<string, unknown>).sessionId) ??
				asString(
					(
						(payload as Record<string, unknown>).session as
							| Record<string, unknown>
							| undefined
					)?.sessionId,
				);
			if (sessionId) {
				sessions.delete(sessionId);
				broadcastHubState();
			}
		},
	});

	cline.subscribe((event) => handleSessionEvent(event));

	await syncHubClientsAndSessions();
	await syncHubHealth();
}

async function detachHub(): Promise<void> {
	rejectAllPendingApprovals("Hub disconnected before approval was resolved.");
	for (const peer of peers) {
		peer.unsubscribeEvents?.();
		peer.unsubscribeEvents = undefined;
	}
	try {
		uiClient?.close();
	} catch {
		// ignore
	}
	uiClient = undefined;
	try {
		await cline?.dispose();
	} catch {
		// ignore
	}
	cline = undefined;
	clients.clear();
	sessions.clear();
	hubStartedAt = undefined;
	coreVersion = undefined;
	initialHubEventEmitted = false;
}

async function restartHub(): Promise<void> {
	broadcast({
		type: "notification",
		title: "Hub restarting",
		body: "Shutting down and respawning hub...",
		severity: "warn",
	});
	await detachHub();
	try {
		await stopLocalHubServerGracefully();
	} catch (error) {
		console.warn("stopLocalHubServerGracefully failed:", error);
	}
	await attachHub();
	broadcastHubState();
	broadcast({
		type: "notification",
		title: "Hub restarted",
		body: `Connected to ${hubUrl}`,
		severity: "info",
	});
}

function resolveLaunchContext(
	override?: Partial<SessionContext> & WebviewConfig,
): SessionContext {
	const providerId =
		override?.provider ??
		override?.providerId ??
		lastSessionContext?.providerId ??
		providerSettingsManager.getLastUsedProviderSettings()?.provider ??
		process.env.CLINE_PROVIDER?.trim() ??
		"";
	const modelId =
		override?.model ??
		override?.modelId ??
		lastSessionContext?.modelId ??
		providerSettingsManager.getLastUsedProviderSettings()?.model ??
		process.env.CLINE_MODEL?.trim() ??
		"";
	const root =
		override?.workspaceRoot ??
		lastSessionContext?.workspaceRoot ??
		workspaceRoot;
	if (!providerId || !modelId) {
		throw new Error(
			"No provider/model available. Start a session in another Cline client first, or set CLINE_PROVIDER and CLINE_MODEL.",
		);
	}
	return {
		workspaceRoot: root,
		cwd: override?.cwd ?? lastSessionContext?.cwd ?? root,
		providerId,
		modelId,
	};
}

function buildSessionStartInput(
	context: SessionContext,
	options?: {
		mode?: "act" | "plan";
		systemPrompt?: string;
		maxIterations?: number;
		reasonLevel?: WebviewReasonLevel;
		enableTools?: boolean;
		enableSpawn?: boolean;
		enableTeams?: boolean;
		autoApproveTools?: boolean;
		teamName?: string;
		source?: SessionSource;
		sessionMetadata?: Record<string, unknown>;
		initialMessages?: Message[];
	},
): ClineCoreStartInput {
	const mode = options?.mode === "plan" ? "plan" : "act";
	const reasoningOptions = toRuntimeReasoningOptions(options?.reasonLevel);
	return {
		source: options?.source ?? SessionSource.WEB,
		interactive: true,
		config: {
			workspaceRoot: context.workspaceRoot,
			cwd: context.cwd,
			providerId: context.providerId,
			modelId: context.modelId,
			systemPrompt: options?.systemPrompt ?? "",
			mode,
			...reasoningOptions,
			maxIterations: options?.maxIterations,
			enableTools: options?.enableTools !== false,
			enableSpawnAgent: options?.enableSpawn !== false,
			enableAgentTeams: options?.enableTeams === true,
			teamName: options?.teamName ?? "cline-hub",
			missionLogIntervalSteps: 3,
			missionLogIntervalMs: 120000,
			checkpoint: { enabled: true },
		},
		sessionMetadata: {
			source: options?.source ?? SessionSource.WEB,
			mode,
			systemPrompt: options?.systemPrompt,
			maxIterations: options?.maxIterations,
			reasonLevel: options?.reasonLevel,
			autoApproveTools: options?.autoApproveTools,
			...(options?.sessionMetadata ?? {}),
		},
		...(options?.initialMessages
			? { initialMessages: options.initialMessages }
			: {}),
		toolPolicies:
			options?.autoApproveTools === false
				? { "*": { autoApprove: false } }
				: { "*": { autoApprove: true } },
	};
}

function buildStartInputFromSession(
	session: SessionRecord,
	options?: {
		sessionMetadata?: Record<string, unknown>;
		initialMessages?: Message[];
	},
) {
	const metadata =
		session.metadata && typeof session.metadata === "object"
			? session.metadata
			: {};
	const mode = metadata.mode === "plan" ? "plan" : "act";
	return buildSessionStartInput(
		{
			workspaceRoot: session.workspaceRoot,
			cwd: session.cwd,
			providerId: session.provider,
			modelId: session.model,
		},
		{
			mode,
			systemPrompt: asString(metadata.systemPrompt),
			maxIterations: asNumber(metadata.maxIterations),
			reasonLevel: asWebviewReasonLevel(metadata.reasonLevel),
			enableTools: session.enableTools,
			enableSpawn: session.enableSpawn,
			enableTeams: session.enableTeams,
			autoApproveTools:
				typeof metadata.autoApproveTools === "boolean"
					? metadata.autoApproveTools
					: undefined,
			teamName: session.teamName,
			source: session.source,
			sessionMetadata: {
				...metadata,
				...(options?.sessionMetadata ?? {}),
			},
			initialMessages: options?.initialMessages,
		},
	);
}

async function loadHistoryFor(sessionId: string): Promise<unknown[]> {
	if (!cline) return [];
	try {
		const messages = await cline.readMessages(sessionId);
		return messages as unknown[];
	} catch (error) {
		console.warn(`readMessages(${sessionId}) failed:`, error);
		return [];
	}
}

async function selectSession(
	peer: BrowserPeer,
	sessionId: string,
): Promise<void> {
	peer.selectedSessionId = sessionId;
	const tracked = sessions.get(sessionId);
	const history = await loadHistoryFor(sessionId);
	send(peer, { type: "session_started", sessionId });
	send(peer, {
		type: "session_hydrated",
		sessionId,
		status: tracked?.status,
		providerId: tracked?.provider,
		modelId: tracked?.model,
		messages: mapHistoryToWebviewMessages(history),
	});
}

async function createSession(
	peer: BrowserPeer,
	prompt: string,
	config?: WebviewConfig,
	attachments?: { userImages?: string[] },
): Promise<void> {
	if (!cline) throw new Error("Hub is not connected.");
	const context = resolveLaunchContext(config);
	const mode = config?.mode === "plan" ? "plan" : "act";
	const result = await cline.start(
		buildSessionStartInput(context, {
			mode,
			systemPrompt: config?.systemPrompt,
			maxIterations: config?.maxIterations,
			reasonLevel: config?.reasonLevel,
			enableTools: config?.enableTools,
			enableSpawn: config?.enableSpawn,
			enableTeams: config?.enableTeams,
			autoApproveTools: config?.autoApproveTools,
		}),
	);
	peer.selectedSessionId = result.sessionId;
	const tracked: TrackedSession = {
		sessionId: result.sessionId,
		status: "running",
		title: prompt.length > 34 ? `${prompt.slice(0, 31)}...` : prompt,
		workspaceRoot: context.workspaceRoot,
		cwd: context.cwd,
		provider: context.providerId,
		model: context.modelId,
		source: SessionSource.WEB,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		prompt,
		agentCount: 1,
		participantCount: 1,
	};
	sessions.set(result.sessionId, tracked);
	send(peer, { type: "session_started", sessionId: result.sessionId });
	send(peer, {
		type: "session_hydrated",
		sessionId: result.sessionId,
		status: tracked.status,
		providerId: context.providerId,
		modelId: context.modelId,
		messages: [],
	});
	broadcastHubState();
	await cline.send({
		sessionId: result.sessionId,
		prompt,
		mode,
		userImages: attachments?.userImages,
	});
}

async function sendMessage(
	peer: BrowserPeer,
	text: string,
	config?: WebviewConfig,
	attachments?: { userImages?: string[] },
): Promise<void> {
	if (!cline) throw new Error("Hub is not connected.");
	if (!peer.selectedSessionId) {
		await createSession(peer, text, config, attachments);
		return;
	}
	await cline.send({
		sessionId: peer.selectedSessionId,
		prompt: text,
		mode: config?.mode === "plan" ? "plan" : "act",
		userImages: attachments?.userImages,
	});
}

async function deleteSession(
	peer: BrowserPeer,
	sessionId: string,
): Promise<void> {
	if (!cline) throw new Error("Hub is not connected.");
	const deleted = await cline.delete(sessionId);
	if (!deleted) {
		send(peer, { type: "status", text: `Session ${sessionId} was not found.` });
		return;
	}
	sessions.delete(sessionId);
	if (peer.selectedSessionId === sessionId) {
		peer.selectedSessionId = undefined;
		send(peer, { type: "reset_done" });
	}
	send(peer, { type: "status", text: `Deleted session ${sessionId}` });
	broadcastHubState();
}

async function initializePeer(peer: BrowserPeer): Promise<void> {
	await syncHubClientsAndSessions();
	send(peer, { type: "status", text: "Cline Hub is ready." });
	send(peer, { type: "defaults", defaults: resolveBrowserDefaults() });
	await loadProviders(peer);
	await sendProviderCatalog(peer);
	send(peer, webviewSessionsPayload());
	send(peer, hubStatePayload());
}

async function resetPeer(peer: BrowserPeer): Promise<void> {
	if (peer.selectedSessionId) {
		rejectPendingApprovalsForSession(
			peer.selectedSessionId,
			"Session detached before approval was resolved.",
		);
	}
	peer.selectedSessionId = undefined;
	send(peer, { type: "reset_done" });
	send(peer, webviewSessionsPayload());
}

async function abortPeerTurn(peer: BrowserPeer): Promise<void> {
	if (!cline || !peer.selectedSessionId) return;
	rejectPendingApprovalsForSession(
		peer.selectedSessionId,
		"Turn aborted before approval was resolved.",
	);
	await cline.abort(peer.selectedSessionId);
	send(peer, { type: "status", text: "Abort requested." });
}

async function forkPeerSession(peer: BrowserPeer): Promise<void> {
	if (!cline) throw new Error("Hub is not connected.");
	const forkedFromSessionId = peer.selectedSessionId;
	if (!forkedFromSessionId) {
		send(peer, { type: "fork_error", text: "No active session to fork." });
		return;
	}
	try {
		const rawMessages = (await cline.readMessages(
			forkedFromSessionId,
		)) as Message[];
		if (rawMessages.length === 0) {
			send(peer, { type: "fork_error", text: "Cannot fork an empty session." });
			return;
		}
		const sourceSession = await cline.get(forkedFromSessionId);
		if (!sourceSession) {
			send(peer, {
				type: "fork_error",
				text: `Session ${forkedFromSessionId} was not found.`,
			});
			return;
		}
		const checkpointMetadata = sourceSession.metadata?.checkpoint;
		const result = await cline.start(
			buildStartInputFromSession(sourceSession, {
				initialMessages: rawMessages,
				sessionMetadata: {
					...(sourceSession.metadata ?? {}),
					fork: {
						forkedFromSessionId,
						forkedAt: new Date().toISOString(),
						source: sourceSession.source,
						...(checkpointMetadata !== undefined
							? { checkpoints: checkpointMetadata }
							: {}),
					},
				},
			}),
		);
		peer.selectedSessionId = result.sessionId;
		const newSession = await cline.get(result.sessionId);
		const tracked = newSession ? trackSession(newSession) : undefined;
		if (tracked) sessions.set(tracked.sessionId, tracked);
		send(peer, { type: "session_started", sessionId: result.sessionId });
		send(peer, {
			type: "session_hydrated",
			sessionId: result.sessionId,
			status: newSession?.status,
			providerId: newSession?.provider,
			modelId: newSession?.model,
			messages: mapHistoryToWebviewMessages(rawMessages),
		});
		send(peer, {
			type: "fork_done",
			forkedFromSessionId,
			newSessionId: result.sessionId,
		});
		await syncHubClientsAndSessions();
		broadcastHubState();
	} catch (error) {
		send(peer, {
			type: "fork_error",
			text: error instanceof Error ? error.message : String(error),
		});
	}
}

async function restorePeerSession(
	peer: BrowserPeer,
	checkpointRunCount: number,
): Promise<void> {
	if (!cline) throw new Error("Hub is not connected.");
	const sourceSessionId = peer.selectedSessionId;
	if (!sourceSessionId) {
		send(peer, { type: "error", text: "No active session to restore." });
		return;
	}
	const sourceSession = await cline.get(sourceSessionId);
	if (!sourceSession) {
		send(peer, {
			type: "error",
			text: `Session ${sourceSessionId} was not found.`,
		});
		return;
	}
	const result = await cline.restore({
		sessionId: sourceSessionId,
		checkpointRunCount,
		cwd: sourceSession.cwd,
		start: buildStartInputFromSession(sourceSession, {
			sessionMetadata: {
				...(sourceSession.metadata ?? {}),
				restoredFromSessionId: sourceSessionId,
				restoredCheckpointRunCount: checkpointRunCount,
			},
		}),
		restore: {
			messages: true,
			workspace: true,
		},
	});
	if (!result.sessionId) {
		send(peer, {
			type: "error",
			text: "Checkpoint restore did not start a session.",
		});
		return;
	}
	peer.selectedSessionId = result.sessionId;
	const restoredSession = await cline.get(result.sessionId);
	const tracked = restoredSession ? trackSession(restoredSession) : undefined;
	if (tracked) sessions.set(tracked.sessionId, tracked);
	const messages = result.messages ?? (await loadHistoryFor(result.sessionId));
	send(peer, { type: "session_started", sessionId: result.sessionId });
	send(peer, {
		type: "session_hydrated",
		sessionId: result.sessionId,
		status: restoredSession?.status,
		providerId: restoredSession?.provider,
		modelId: restoredSession?.model,
		messages: mapHistoryToWebviewMessages(messages),
	});
	await syncHubClientsAndSessions();
	broadcastHubState();
}

await attachHub();
setInterval(() => {
	void (async () => {
		await syncHubHealth();
		broadcastHubState();
	})();
}, 5_000);

const server = Bun.serve<BrowserPeer>({
	port,
	hostname: host,
	async fetch(req, server) {
		const url = new URL(req.url);
		if (url.pathname === "/browser") {
			if (!isAuthorizedBrowserRequest(url)) {
				return createJsonResponse({ error: "invalid_room_secret" }, 401);
			}
			const displayName = `Browser ${Math.random().toString(36).slice(2, 6)}`;
			const data = {
				socket: undefined as never,
				displayName,
				sending: false,
			};
			if (server.upgrade(req, { data })) return undefined;
			return new Response("upgrade failed", { status: 400 });
		}
		if (url.pathname === "/config.json") {
			return createJsonResponse(browserConfig);
		}
		return serveWebviewAsset(url.pathname);
	},
	websocket: {
		async open(socket) {
			const peer = socket.data;
			peer.socket = socket;
			peers.add(peer);
		},
		async message(socket, raw) {
			const peer = socket.data;
			try {
				const frame = JSON.parse(String(raw)) as BrowserFrame;
				if (frame.type === "desktopCommand") {
					try {
						const result = await handleDesktopCommand(
							frame.command,
							frame.args,
						);
						send(peer, {
							type: "desktopCommandResult",
							id: frame.id,
							ok: true,
							result,
						});
					} catch (error) {
						send(peer, {
							type: "desktopCommandResult",
							id: frame.id,
							ok: false,
							error: error instanceof Error ? error.message : String(error),
						});
					}
				} else if (frame.type === "ready") {
					await initializePeer(peer);
				} else if (frame.type === "loadModels") {
					await loadModels(peer, frame.providerId);
				} else if (frame.type === "loadProviderCatalog") {
					await sendProviderCatalog(peer);
				} else if (frame.type === "saveProviderSettings") {
					await saveProviderSettings(peer, frame);
				} else if (frame.type === "runProviderOAuthLogin") {
					await runProviderOAuthLogin(peer, frame.providerId);
				} else if (frame.type === "attachSession") {
					await selectSession(peer, frame.sessionId);
				} else if (frame.type === "deleteSession") {
					await deleteSession(peer, frame.sessionId);
				} else if (frame.type === "updateSessionMetadata") {
					if (!cline) throw new Error("Hub is not connected.");
					await cline.update(frame.sessionId, { metadata: frame.metadata });
					await syncHubClientsAndSessions();
					broadcastHubState();
				} else if (frame.type === "approval_response") {
					handleToolApprovalResponse(frame);
				} else if (frame.type === "abort") {
					await abortPeerTurn(peer);
				} else if (frame.type === "reset") {
					await resetPeer(peer);
				} else if (frame.type === "send") {
					if (peer.sending) {
						send(peer, {
							type: "status",
							text: "A turn is already in progress.",
						});
						return;
					}
					peer.sending = true;
					try {
						await sendMessage(
							peer,
							frame.prompt,
							frame.config,
							frame.attachments,
						);
					} finally {
						peer.sending = false;
					}
				} else if (frame.type === "forkSession") {
					await forkPeerSession(peer);
				} else if (frame.type === "restore") {
					await restorePeerSession(peer, frame.checkpointRunCount);
				} else if (frame.type === "restart_hub") {
					await restartHub();
				}
			} catch (error) {
				send(peer, {
					type: "error",
					text: error instanceof Error ? error.message : String(error),
				});
			}
		},
		close(socket) {
			const peer = socket.data;
			peer.unsubscribeEvents?.();
			peers.delete(peer);
			rejectOrphanedApprovals();
		},
	},
});

console.log(`Cline Hub dashboard listening: ${server.url}`);
console.log(`Cline Hub public URL: ${publicUrl}`);
console.log(`hub endpoint: ${hubUrl}`);
if (roomSecret) {
	console.log(`Cline Hub invite URL: ${inviteUrl}`);
} else if (isNonLocalBindHost(host)) {
	console.warn("WARNING: non-local bind without ROOM_SECRET is not allowed.");
} else {
	console.log(
		"ROOM_SECRET is not set; this local-only instance accepts browser connections without an invite token.",
	);
}
