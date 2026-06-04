import process from "node:process";
import { createInterface } from "node:readline";
import {
	ensureDetachedHubServer,
	type HubServerDiscoveryRecord,
	HubSessionClient,
	HubUIClient,
	Llms,
	ProviderSettingsManager,
	stopLocalHubServerGracefully,
	toHubHealthUrl,
} from "@cline/core";
import type { HubUINotifyPayload, SessionRecord } from "@cline/shared";

interface TrackedClient {
	clientId: string;
	displayName?: string;
	clientType: string;
	connectedAt: number;
}

interface TrackedSession {
	sessionId: string;
	status: string;
	workspaceRoot: string;
	cwd?: string;
	createdAt: number;
	updatedAt: number;
	createdByClientId?: string;
	title?: string;
	provider?: string;
	model?: string;
	prompt?: string;
	inputTokens?: number;
	outputTokens?: number;
	totalCost?: number;
	agentCount?: number;
}

interface ClientSummary {
	label: string;
	name: string;
	sessionCount: number;
}

interface SessionSummary {
	sessionId: string;
	title: string;
	status: string;
	workspaceRoot: string;
	workspaceName: string;
	cwd?: string;
	model?: string;
	provider?: string;
	createdAt: number;
	updatedAt: number;
	createdByClientId?: string;
	prompt?: string;
	inputTokens?: number;
	outputTokens?: number;
	totalCost?: number;
	agentCount: number;
}

interface EventRecord {
	id: string;
	title: string;
	body: string;
	severity: "info" | "success" | "warn" | "error";
	timestamp: number;
}

type ClientSummaryGroup = {
	label: string;
	name: string;
	sessionCount: number;
	firstConnectedAt: number;
};

function isBundledDaemonEntryInvocation(): boolean {
	const entryArg = process.argv[1]?.trim() ?? "";
	const isBunEmbeddedEntry =
		entryArg.includes("/$bunfs/") &&
		(entryArg.endsWith("/entry.js") || entryArg.endsWith("/entry.ts"));
	return (
		process.argv.includes("--cline-hub-daemon") ||
		isBunEmbeddedEntry ||
		entryArg.endsWith("/daemon-entry.js") ||
		entryArg.endsWith("/daemon-entry.ts") ||
		entryArg === "daemon-entry.js" ||
		entryArg === "daemon-entry.ts"
	);
}

interface LastSessionContext {
	workspaceRoot: string;
	cwd?: string;
	provider: string;
	model: string;
}

interface ProviderLaunchAuth {
	apiKey?: string;
}

interface SidecarCommand {
	type: "new_chat" | "shutdown_hub" | "abort_session";
	prompt?: string;
	sessionId?: string;
}

function isVisibleClient(clientType: string): boolean {
	return clientType !== "menubar-monitor";
}

function isActiveSession(
	status: string | undefined,
	participantCount?: number,
): boolean {
	const normalized = status?.trim().toLowerCase();
	if (normalized !== "running" && normalized !== "idle") {
		return false;
	}
	return typeof participantCount === "number" ? participantCount > 0 : true;
}

function emit(msg: Record<string, unknown>): void {
	process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function emitNotification(
	title: string,
	body: string,
	severity: "info" | "warn" | "error" = "error",
): void {
	emit({
		type: "notification",
		title,
		body,
		severity,
	});
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function basename(value: string | undefined): string {
	const trimmed = value?.trim();
	if (!trimmed) {
		return "workspace";
	}
	const parts = trimmed.split(/[\\/]+/).filter(Boolean);
	return parts.at(-1) ?? trimmed;
}

function shortSessionId(sessionId: string): string {
	return sessionId.length > 10 ? sessionId.slice(0, 10) : sessionId;
}

function pushEvent(
	events: EventRecord[],
	title: string,
	body: string,
	severity: EventRecord["severity"] = "info",
	timestamp = Date.now(),
): void {
	events.unshift({
		id: `${timestamp}-${events.length}-${title}`,
		title,
		body,
		severity,
		timestamp,
	});
	if (events.length > 30) {
		events.length = 30;
	}
}

function metadataFor(
	session: SessionRecord | Record<string, unknown>,
): Record<string, unknown> {
	return asRecord(session.metadata) ?? {};
}

function usageFor(
	session: SessionRecord | Record<string, unknown>,
): Record<string, unknown> {
	return (
		asRecord(session.aggregateUsage) ??
		asRecord(session.usage) ??
		asRecord(metadataFor(session).aggregateUsage) ??
		asRecord(metadataFor(session).usage) ??
		{}
	);
}

function formatUptime(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const days = Math.floor(totalSeconds / 86_400);
	const hours = Math.floor((totalSeconds % 86_400) / 3_600);
	const minutes = Math.floor((totalSeconds % 3_600) / 60);
	const seconds = totalSeconds % 60;
	if (days > 0) {
		return `${days}d ${hours}h`;
	}
	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds}s`;
	}
	return `${seconds}s`;
}

function formatClientLabel(clientType: string | undefined): string {
	const normalized = clientType?.trim().toLowerCase() ?? "";
	if (!normalized || normalized === "unknown") {
		return "Client";
	}
	if (normalized.includes("cline")) {
		return "Cline";
	}
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

function sessionTitle(
	session: SessionRecord | Record<string, unknown>,
): string {
	const raw = session as Record<string, unknown>;
	const metadata = metadataFor(session);
	const title = asString(metadata.title);
	if (title) {
		return title;
	}
	const prompt = asString(raw.prompt) ?? asString(metadata.prompt);
	if (prompt) {
		return prompt.length > 34 ? `${prompt.slice(0, 31)}...` : prompt;
	}
	return basename(asString(raw.workspaceRoot) ?? asString(raw.cwd));
}

function trackedSessionFrom(
	session: SessionRecord | Record<string, unknown>,
): TrackedSession | undefined {
	const raw = session as Record<string, unknown>;
	const sessionId = asString(raw.sessionId);
	if (!sessionId) {
		return undefined;
	}
	const metadata = metadataFor(session);
	const usage = usageFor(session);
	const createdAt =
		asNumber(raw.createdAt) ??
		asNumber(raw.startedAt) ??
		asNumber(metadata.createdAt) ??
		Date.now();
	return {
		sessionId,
		status: asString(raw.status) ?? "running",
		workspaceRoot: asString(raw.workspaceRoot) ?? asString(raw.cwd) ?? "",
		cwd: asString(raw.cwd),
		createdAt,
		updatedAt:
			asNumber(raw.updatedAt) ??
			asNumber(raw.endedAt) ??
			asNumber(metadata.updatedAt) ??
			createdAt,
		createdByClientId: asString(raw.createdByClientId),
		title: sessionTitle(session),
		provider: asString(raw.provider) ?? asString(metadata.provider),
		model: asString(raw.model) ?? asString(metadata.model),
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
		agentCount: Array.isArray(raw.participants)
			? Math.max(1, raw.participants.length)
			: 1,
	};
}

function toSessionSummary(session: TrackedSession): SessionSummary {
	return {
		sessionId: session.sessionId,
		title: session.title || basename(session.workspaceRoot),
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
		agentCount: session.agentCount ?? 1,
	};
}

function parseLastSessionContext(
	session: SessionRecord | Record<string, unknown> | undefined,
): LastSessionContext | undefined {
	if (!session || typeof session !== "object") {
		return undefined;
	}
	const metadata =
		session.metadata && typeof session.metadata === "object"
			? (session.metadata as Record<string, unknown>)
			: {};
	const workspaceRoot =
		typeof session.workspaceRoot === "string"
			? session.workspaceRoot.trim()
			: "";
	const provider =
		typeof metadata.provider === "string" ? metadata.provider.trim() : "";
	const model = typeof metadata.model === "string" ? metadata.model.trim() : "";
	if (!workspaceRoot || !provider || !model) {
		return undefined;
	}
	return {
		workspaceRoot,
		cwd:
			typeof session.cwd === "string" && session.cwd.trim()
				? session.cwd.trim()
				: workspaceRoot,
		provider,
		model,
	};
}

function resolveProviderLaunchAuth(
	providerSettingsManager: ProviderSettingsManager,
	providerId: string,
): ProviderLaunchAuth {
	const settings = providerSettingsManager.getProviderSettings(providerId);
	const storedApiKey =
		settings?.auth?.accessToken?.trim() ||
		settings?.apiKey?.trim() ||
		settings?.auth?.apiKey?.trim();
	if (storedApiKey) {
		return { apiKey: storedApiKey };
	}

	const provider = Llms.MODEL_COLLECTIONS_BY_PROVIDER_ID[providerId]?.provider;
	const envKeys = provider?.env ?? [];
	for (const key of envKeys) {
		if (process.env[key]?.trim()) {
			return {};
		}
	}

	throw new Error(
		`Provider "${providerId}" has no stored auth or configured environment key for background sessions.`,
	);
}

async function main(): Promise<void> {
	const workspaceRoot = process.cwd();
	const providerSettingsManager = new ProviderSettingsManager();
	// Discover or start a detached shared hub
	let hubUrl: string;
	let hubAuthToken: string;
	try {
		const hub = await ensureDetachedHubServer(workspaceRoot);
		hubUrl = hub.url;
		hubAuthToken = hub.authToken;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		emitNotification("Hub startup failed", msg, "error");
		process.stderr.write(`[menubar-sidecar] hub error: ${msg}\n`);
		process.exit(1);
	}

	emit({
		type: "ready",
		endpoint: hubUrl,
		wsEndpoint: hubUrl,
		pid: process.pid,
	});

	const uiClient = new HubUIClient({
		address: hubUrl,
		authToken: hubAuthToken,
		clientType: "menubar-app",
		displayName: "Cline Menu Bar App",
	});
	const sessionClient = new HubSessionClient({
		address: hubUrl,
		authToken: hubAuthToken,
		clientType: "menubar-background-client",
		displayName: "Cline Background Client",
	});

	await uiClient.connect();

	const clients = new Map<string, TrackedClient>();
	const sessions = new Map<string, TrackedSession>();
	const events: EventRecord[] = [];
	let lastSessionContext: LastSessionContext | undefined;
	let hubStartedAt: string | undefined;

	const syncHealthState = async (): Promise<void> => {
		try {
			const response = await fetch(toHubHealthUrl(hubUrl));
			if (!response.ok) {
				return;
			}
			const health =
				(await response.json()) as Partial<HubServerDiscoveryRecord>;
			hubStartedAt =
				typeof health.startedAt === "string" ? health.startedAt : hubStartedAt;
		} catch {
			// best-effort health poll
		}
	};

	const syncInitialState = async (): Promise<void> => {
		const [knownClients, knownSessions] = await Promise.all([
			uiClient.listClients(),
			uiClient.listSessions(),
		]);
		clients.clear();
		for (const client of knownClients) {
			if (
				typeof client.clientId !== "string" ||
				!client.clientId ||
				client.clientId === uiClient.getClientId() ||
				!isVisibleClient(client.clientType)
			) {
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
			if (
				typeof session.sessionId !== "string" ||
				!session.sessionId ||
				!isActiveSession(session.status, session.participants?.length)
			) {
				continue;
			}
			const tracked = trackedSessionFrom(session);
			if (tracked) {
				sessions.set(tracked.sessionId, tracked);
			}
		}
		const mostRecentContext = [...knownSessions]
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.map((session) => parseLastSessionContext(session))
			.find((context): context is LastSessionContext => Boolean(context));
		if (mostRecentContext) {
			lastSessionContext = mostRecentContext;
		}
		pushEvent(
			events,
			"Hub monitor connected",
			`${knownClients.length} clients and ${knownSessions.length} sessions discovered`,
			"success",
		);
	};

	function emitState(): void {
		const sessionCounts = new Map<string, number>();
		for (const session of sessions.values()) {
			const clientId = session.createdByClientId?.trim();
			if (!clientId) {
				continue;
			}
			sessionCounts.set(clientId, (sessionCounts.get(clientId) ?? 0) + 1);
		}
		const groupedSummaries = new Map<string, ClientSummaryGroup>();
		for (const client of Array.from(clients.values()).sort(
			(a, b) => a.connectedAt - b.connectedAt,
		)) {
			const summary = summarizeClient(client);
			const existing = groupedSummaries.get(summary.key);
			if (existing) {
				existing.sessionCount += sessionCounts.get(client.clientId) ?? 0;
				existing.firstConnectedAt = Math.min(
					existing.firstConnectedAt,
					client.connectedAt,
				);
				continue;
			}
			groupedSummaries.set(summary.key, {
				label: summary.label,
				name: summary.name,
				sessionCount: sessionCounts.get(client.clientId) ?? 0,
				firstConnectedAt: client.connectedAt,
			});
		}
		const clientSummaries: ClientSummary[] = Array.from(
			groupedSummaries.values(),
		)
			.sort((a, b) => a.firstConnectedAt - b.firstConnectedAt)
			.map(({ label, name, sessionCount }) => ({
				label,
				name,
				sessionCount,
			}));
		emit({
			type: "hub_state",
			connected: true,
			clients: Array.from(clients.values()),
			sessions: Array.from(sessions.values()),
			clientSummaries,
			sessionSummaries: Array.from(sessions.values())
				.sort((a, b) => b.updatedAt - a.updatedAt)
				.map(toSessionSummary),
			events,
			lastWorkspaceRoot: lastSessionContext?.workspaceRoot,
			hubStartedAt,
			hubUptime: hubStartedAt
				? formatUptime(Date.now() - Date.parse(hubStartedAt))
				: undefined,
		});
	}

	async function startBackgroundChat(prompt: string): Promise<void> {
		const trimmedPrompt = prompt.trim();
		if (!trimmedPrompt) {
			return;
		}
		if (!lastSessionContext) {
			emit({
				type: "notification",
				title: "New chat failed",
				body: "No recent workspace and model context is available yet.",
				severity: "error",
			});
			return;
		}
		try {
			const cwd = lastSessionContext.cwd ?? lastSessionContext.workspaceRoot;
			const launchAuth = resolveProviderLaunchAuth(
				providerSettingsManager,
				lastSessionContext.provider,
			);
			const started = await sessionClient.startRuntimeSession({
				workspaceRoot: lastSessionContext.workspaceRoot,
				cwd,
				provider: lastSessionContext.provider,
				model: lastSessionContext.model,
				apiKey: launchAuth.apiKey,
				enableTools: true,
				enableSpawn: false,
				enableTeams: true,
				autoApproveTools: true,
				source: "cline-menubar",
				interactive: false,
			});
			await sessionClient.sendRuntimeSession(started.sessionId, {
				config: {
					workspaceRoot: lastSessionContext.workspaceRoot,
					cwd,
					provider: lastSessionContext.provider,
					model: lastSessionContext.model,
					apiKey: launchAuth.apiKey,
					enableTools: true,
					enableSpawn: false,
					enableTeams: true,
				},
				prompt: trimmedPrompt,
			});
		} catch (error) {
			emit({
				type: "notification",
				title: "New chat failed",
				body: error instanceof Error ? error.message : String(error),
				severity: "error",
			});
		}
	}

	async function shutdownHub(): Promise<void> {
		try {
			await stopLocalHubServerGracefully();
		} catch (error) {
			emit({
				type: "notification",
				title: "Hub shutdown failed",
				body: error instanceof Error ? error.message : String(error),
				severity: "error",
			});
		}
	}

	async function abortBackgroundSession(sessionId: string): Promise<void> {
		const trimmedSessionId = sessionId.trim();
		if (!trimmedSessionId) {
			return;
		}
		try {
			await sessionClient.abortRuntimeSession(trimmedSessionId);
			pushEvent(
				events,
				"Session abort requested",
				`Requested stop for ${shortSessionId(trimmedSessionId)}`,
				"warn",
			);
			emitState();
		} catch (error) {
			emit({
				type: "notification",
				title: "Stop session failed",
				body: error instanceof Error ? error.message : String(error),
				severity: "error",
			});
		}
	}

	const stdin = createInterface({ input: process.stdin, terminal: false });
	stdin.on("line", (line) => {
		const trimmed = line.trim();
		if (!trimmed) {
			return;
		}
		let command: SidecarCommand | undefined;
		try {
			command = JSON.parse(trimmed) as SidecarCommand;
		} catch {
			return;
		}
		if (command?.type === "new_chat") {
			if (typeof command.prompt === "string") {
				void startBackgroundChat(command.prompt);
			}
			return;
		}
		if (command?.type === "shutdown_hub") {
			void shutdownHub();
		}
		if (command?.type === "abort_session") {
			if (typeof command.sessionId === "string") {
				void abortBackgroundSession(command.sessionId);
			}
		}
	});

	uiClient.subscribeUI({
		onNotify(payload: HubUINotifyPayload) {
			pushEvent(
				events,
				payload.title,
				payload.body,
				payload.severity === "error"
					? "error"
					: payload.severity === "warning"
						? "warn"
						: "info",
			);
			emit({
				type: "notification",
				title: payload.title,
				body: payload.body,
				severity: payload.severity ?? "info",
			});
		},
		onClientRegistered(payload) {
			const clientId =
				typeof payload.clientId === "string" ? payload.clientId : undefined;
			if (!clientId) return;
			if (
				clientId === uiClient.getClientId() ||
				(typeof payload.clientType === "string" &&
					!isVisibleClient(payload.clientType))
			) {
				return;
			}
			clients.set(clientId, {
				clientId,
				displayName:
					typeof payload.displayName === "string"
						? payload.displayName
						: undefined,
				clientType:
					typeof payload.clientType === "string"
						? payload.clientType
						: "unknown",
				connectedAt: Date.now(),
			});
			pushEvent(
				events,
				"Client connected",
				`${formatClientLabel(typeof payload.clientType === "string" ? payload.clientType : "unknown")} joined the hub`,
				"success",
			);
			emitState();
		},
		onClientDisconnected(payload) {
			const clientId =
				typeof payload.clientId === "string" ? payload.clientId : undefined;
			if (!clientId) return;
			const client = clients.get(clientId);
			clients.delete(clientId);
			pushEvent(
				events,
				"Client disconnected",
				`${client?.displayName ?? client?.clientType ?? clientId} left the hub`,
				"warn",
			);
			emitState();
		},
		onSessionCreated(payload) {
			const session =
				payload.session && typeof payload.session === "object"
					? (payload.session as Record<string, unknown>)
					: payload;
			const context = parseLastSessionContext(session);
			if (context) {
				lastSessionContext = context;
			}
			const sessionId =
				typeof session.sessionId === "string" ? session.sessionId : undefined;
			if (!sessionId) return;
			const status =
				typeof session.status === "string" ? session.status : "running";
			if (
				!isActiveSession(
					status,
					Array.isArray(session.participants) ? session.participants.length : 1,
				)
			) {
				sessions.delete(sessionId);
				emitState();
				return;
			}
			const tracked = trackedSessionFrom({ ...session, status });
			if (!tracked) return;
			sessions.set(sessionId, tracked);
			pushEvent(
				events,
				`Started session "${tracked.title ?? shortSessionId(sessionId)}"`,
				`${tracked.workspaceRoot || "workspace"} on ${tracked.model ?? "selected model"}`,
				"success",
				tracked.createdAt,
			);
			emitState();
		},
		onSessionUpdated(payload) {
			const session =
				payload.session && typeof payload.session === "object"
					? (payload.session as Record<string, unknown>)
					: payload;
			const context = parseLastSessionContext(session);
			if (context) {
				lastSessionContext = context;
			}
			const sessionId =
				typeof session.sessionId === "string" ? session.sessionId : undefined;
			if (!sessionId) return;
			const existing = sessions.get(sessionId);
			const status =
				typeof session.status === "string"
					? session.status
					: (existing?.status ?? "running");
			const participantCount = Array.isArray(session.participants)
				? session.participants.length
				: undefined;
			if (!isActiveSession(status, participantCount)) {
				sessions.delete(sessionId);
				emitState();
				return;
			}
			if (existing) {
				const previousStatus = existing.status;
				existing.status = status;
				existing.updatedAt =
					asNumber(session.updatedAt) ??
					asNumber(session.endedAt) ??
					Date.now();
				existing.title = sessionTitle(session);
				existing.workspaceRoot =
					typeof session.workspaceRoot === "string"
						? session.workspaceRoot
						: existing.workspaceRoot;
				existing.cwd =
					typeof session.cwd === "string" ? session.cwd : existing.cwd;
				const metadata = metadataFor(session);
				existing.provider =
					asString(session.provider) ??
					asString(metadata.provider) ??
					existing.provider;
				existing.model =
					asString(session.model) ?? asString(metadata.model) ?? existing.model;
				existing.createdByClientId =
					typeof session.createdByClientId === "string"
						? session.createdByClientId
						: existing.createdByClientId;
				sessions.set(sessionId, existing);
				if (previousStatus !== status) {
					pushEvent(
						events,
						`Session ${status}`,
						`${existing.title ?? shortSessionId(sessionId)} changed from ${previousStatus}`,
						status === "running"
							? "success"
							: status === "idle"
								? "info"
								: "warn",
					);
				}
			} else {
				const tracked = trackedSessionFrom({ ...session, status });
				if (tracked) {
					sessions.set(sessionId, tracked);
				}
			}
			emitState();
		},
		onSessionDetached(payload) {
			const session =
				payload.session && typeof payload.session === "object"
					? (payload.session as Record<string, unknown>)
					: undefined;
			const sessionId =
				typeof session?.sessionId === "string"
					? session.sessionId
					: typeof payload.sessionId === "string"
						? payload.sessionId
						: undefined;
			if (!sessionId) return;
			const participantCount = Array.isArray(session?.participants)
				? session.participants.length
				: 0;
			if (participantCount <= 0) {
				const tracked = sessions.get(sessionId);
				sessions.delete(sessionId);
				pushEvent(
					events,
					"Session detached",
					`${tracked?.title ?? shortSessionId(sessionId)} has no active participants`,
					"warn",
				);
				emitState();
			}
		},
	});

	await syncInitialState();
	await syncHealthState();
	emitState();
	const healthInterval = setInterval(() => {
		void (async () => {
			await syncHealthState();
			emitState();
		})();
	}, 5_000);

	// Keep process alive
	process.on("SIGINT", () => {
		clearInterval(healthInterval);
		stdin.close();
		sessionClient.close();
		uiClient.close();
		process.exit(0);
	});
	process.on("SIGTERM", () => {
		clearInterval(healthInterval);
		stdin.close();
		sessionClient.close();
		uiClient.close();
		process.exit(0);
	});

	await new Promise<void>(() => {
		// run forever
	});
}

if (isBundledDaemonEntryInvocation()) {
	await import("@cline/core/hub/daemon-entry");
} else {
	main().catch((err) => {
		const msg = err instanceof Error ? err.message : String(err);
		emitNotification("Menubar sidecar fatal error", msg, "error");
		process.stderr.write(`[menubar-sidecar] fatal: ${msg}\n`);
		process.exit(1);
	});
}
