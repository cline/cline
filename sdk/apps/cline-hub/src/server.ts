import process from "node:process";
import type {
	CoreSessionEvent,
	HubServerDiscoveryRecord,
	SessionHistoryRecord,
} from "@cline/core";
import {
	ClineCore,
	ensureDetachedHubServer,
	HubUIClient,
	SessionSource,
	stopLocalHubServerGracefully,
	toHubHealthUrl,
} from "@cline/core";
import type {
	AgentEvent,
	HubUINotifyPayload,
	SessionRecord,
} from "@cline/shared";
import {
	buildInviteUrl,
	isNonLocalBindHost,
	resolveClineHubServerOptions,
} from "./options";

type BrowserFrame =
	| { type: "hello"; displayName?: string }
	| { type: "list" }
	| { type: "select"; sessionId: string }
	| { type: "create"; prompt: string }
	| { type: "message"; text: string }
	| { type: "restart_hub" };

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
};

const options = resolveClineHubServerOptions();
const { host, port, publicUrl, roomSecret, workspaceRoot } = options;
const peers = new Set<BrowserPeer>();
const inviteUrl = buildInviteUrl(publicUrl, roomSecret);
const browserConfig: BrowserConfig = {
	inviteRequired: Boolean(roomSecret),
	publicUrl,
};

let hubUrl = "";
let hubAuthToken = "";
let cline: ClineCore | undefined;
let uiClient: HubUIClient | undefined;
let hubStartedAt: string | undefined;
const clients = new Map<string, TrackedClient>();
const sessions = new Map<string, TrackedSession>();
let lastSessionContext: SessionContext | undefined;

function send(peer: BrowserPeer, payload: Record<string, unknown>): void {
	peer.socket.send(JSON.stringify(payload));
}

function broadcast(payload: Record<string, unknown>): void {
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
	if (!trimmed) return "workspace";
	const parts = trimmed.split(/[\\/]+/).filter(Boolean);
	return parts.at(-1) ?? trimmed;
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

function sessionTitle(record: Record<string, unknown>): string {
	const metadata =
		record.metadata && typeof record.metadata === "object"
			? (record.metadata as Record<string, unknown>)
			: {};
	const title = asString(metadata.title);
	if (title) return title;
	const prompt = asString(record.prompt) ?? asString(metadata.prompt);
	if (prompt) return prompt.length > 34 ? `${prompt.slice(0, 31)}...` : prompt;
	return basename(asString(record.workspaceRoot) ?? asString(record.cwd));
}

function trackSession(
	record: SessionRecord | SessionHistoryRecord | Record<string, unknown>,
): TrackedSession | undefined {
	const raw = record as Record<string, unknown>;
	const sessionId = asString(raw.sessionId);
	if (!sessionId) return undefined;
	const metadata =
		raw.metadata && typeof raw.metadata === "object"
			? (raw.metadata as Record<string, unknown>)
			: {};
	const createdAt =
		asNumber(raw.createdAt) ?? asNumber(metadata.createdAt) ?? Date.now();
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
			asNumber(raw.updatedAt) ?? asNumber(metadata.updatedAt) ?? createdAt,
	};
}

function parseSessionContext(
	record: SessionRecord | SessionHistoryRecord | Record<string, unknown>,
): SessionContext | undefined {
	const raw = record as Record<string, unknown>;
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

function hubStatePayload(): Record<string, unknown> {
	const sessionList = [...sessions.values()].sort(
		(a, b) => b.updatedAt - a.updatedAt,
	);
	const clientList = [...clients.values()].sort(
		(a, b) => a.connectedAt - b.connectedAt,
	);
	return {
		type: "hub_state",
		connected: Boolean(cline && uiClient),
		hubUrl,
		hubStartedAt,
		hubUptime: hubStartedAt
			? formatUptime(Date.now() - Date.parse(hubStartedAt))
			: undefined,
		clients: clientList,
		sessions: sessionList,
		lastWorkspaceRoot: lastSessionContext?.workspaceRoot,
	};
}

function broadcastHubState(): void {
	broadcast(hubStatePayload());
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
	const selfId = uiClient.getClientId();
	for (const client of knownClients) {
		if (!client.clientId || client.clientId === selfId) continue;
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

function sendChunkToSelectedPeers(sessionId: string, text: string): void {
	if (!text) return;
	for (const peer of peers) {
		if (peer.selectedSessionId === sessionId) {
			send(peer, { type: "chunk", sessionId, text });
		}
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
		const text = agentEventText(event.payload.event);
		sendChunkToSelectedPeers(sessionId, text);
		if (event.payload.event.type === "error") {
			for (const peer of peers) {
				if (peer.selectedSessionId === sessionId) {
					send(peer, {
						type: "error",
						message: event.payload.event.error.message,
					});
				}
			}
		}
	} else if (event.type === "status") {
		const status = asString((payload as Record<string, unknown>).status);
		const tracked = sessions.get(sessionId);
		if (tracked && status) {
			tracked.status = status;
			tracked.updatedAt = Date.now();
		}
		for (const peer of peers) {
			if (peer.selectedSessionId === sessionId) {
				send(peer, { type: "status", sessionId, status });
			}
		}
		broadcastHubState();
	} else if (event.type === "ended") {
		const tracked = sessions.get(sessionId);
		if (tracked) {
			tracked.status = "completed";
			tracked.updatedAt = Date.now();
		}
		for (const peer of peers) {
			if (peer.selectedSessionId === sessionId) {
				send(peer, { type: "ended", sessionId });
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
		hub: {
			endpoint: hubUrl,
			authToken: hubAuthToken,
			clientType: "cline-hub-server",
			displayName: "Cline Hub Server",
			workspaceRoot,
		},
	});

	uiClient = new HubUIClient({
		address: hubUrl,
		authToken: hubAuthToken,
		clientType: "cline-hub-monitor",
		displayName: "Cline Hub Monitor",
	});
	await uiClient.connect();

	uiClient.subscribeUI({
		onNotify(payload: HubUINotifyPayload) {
			broadcast({
				type: "notification",
				title: payload.title,
				body: payload.body,
				severity: payload.severity ?? "info",
			});
		},
		onClientRegistered(payload) {
			const clientId = asString(payload.clientId);
			if (!clientId || clientId === uiClient?.getClientId()) return;
			clients.set(clientId, {
				clientId,
				displayName: asString(payload.displayName),
				clientType: asString(payload.clientType) ?? "unknown",
				connectedAt: Date.now(),
			});
			broadcastHubState();
		},
		onClientDisconnected(payload) {
			const clientId = asString(payload.clientId);
			if (!clientId) return;
			clients.delete(clientId);
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
	override?: Partial<SessionContext>,
): SessionContext {
	const providerId =
		override?.providerId ??
		lastSessionContext?.providerId ??
		process.env.CLINE_PROVIDER?.trim() ??
		"";
	const modelId =
		override?.modelId ??
		lastSessionContext?.modelId ??
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
	send(peer, {
		type: "session",
		sessionId,
		session: tracked,
		history,
	});
}

async function createSession(peer: BrowserPeer, prompt: string): Promise<void> {
	if (!cline) throw new Error("Hub is not connected.");
	const context = resolveLaunchContext();
	const result = await cline.start({
		source: SessionSource.WEB,
		config: {
			workspaceRoot: context.workspaceRoot,
			cwd: context.cwd,
			providerId: context.providerId,
			modelId: context.modelId,
			systemPrompt: "",
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
		},
		prompt,
	});
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
	};
	sessions.set(result.sessionId, tracked);
	send(peer, {
		type: "session",
		sessionId: result.sessionId,
		session: tracked,
		history: [{ role: "user", content: prompt }],
	});
	broadcastHubState();
	if (!result.result) {
		await cline.send({
			sessionId: result.sessionId,
			prompt,
		});
	}
}

async function sendMessage(peer: BrowserPeer, text: string): Promise<void> {
	if (!cline) throw new Error("Hub is not connected.");
	if (!peer.selectedSessionId) throw new Error("No session selected.");
	await cline.send({
		sessionId: peer.selectedSessionId,
		prompt: text,
	});
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
	fetch(req, server) {
		const url = new URL(req.url);
		if (url.pathname === "/browser") {
			if (!isAuthorizedBrowserRequest(url)) {
				return createJsonResponse({ error: "invalid_room_secret" }, 401);
			}
			const displayName = `Browser ${Math.random().toString(36).slice(2, 6)}`;
			const data = { socket: undefined as never, displayName };
			if (server.upgrade(req, { data })) return undefined;
			return new Response("upgrade failed", { status: 400 });
		}
		if (url.pathname === "/config.json") {
			return createJsonResponse(browserConfig);
		}
		if (url.pathname === "/" || url.pathname === "/index.html") {
			return new Response(renderIndexHtml(browserConfig), {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		}
		return new Response("not found", { status: 404 });
	},
	websocket: {
		async open(socket) {
			const peer = socket.data;
			peer.socket = socket;
			peers.add(peer);
			send(peer, { type: "connected", displayName: peer.displayName });
			send(peer, hubStatePayload());
		},
		async message(socket, raw) {
			const peer = socket.data;
			try {
				const frame = JSON.parse(String(raw)) as BrowserFrame;
				if (frame.type === "hello") {
					peer.displayName = frame.displayName?.trim() || peer.displayName;
					send(peer, { type: "ready", displayName: peer.displayName, hubUrl });
					send(peer, hubStatePayload());
				} else if (frame.type === "list") {
					await syncHubClientsAndSessions();
					send(peer, hubStatePayload());
				} else if (frame.type === "select") {
					await selectSession(peer, frame.sessionId);
				} else if (frame.type === "create") {
					await createSession(peer, frame.prompt);
				} else if (frame.type === "message") {
					await sendMessage(peer, frame.text);
				} else if (frame.type === "restart_hub") {
					await restartHub();
				}
			} catch (error) {
				send(peer, {
					type: "error",
					message: error instanceof Error ? error.message : String(error),
				});
			}
		},
		close(socket) {
			const peer = socket.data;
			peer.unsubscribeEvents?.();
			peers.delete(peer);
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

function renderIndexHtml(config: BrowserConfig): string {
	return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Cline Hub Chat</title>
  <style>
    body { font: 14px system-ui, sans-serif; margin: 0; display: grid; grid-template-columns: 320px 1fr; height: 100vh; }
    aside { border-right: 1px solid #ddd; padding: 16px; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
    main { display: flex; flex-direction: column; min-width: 0; }
    h2, h3 { margin: 4px 0 6px; }
    .section { border-top: 1px solid #eee; padding-top: 10px; }
    .row { display: flex; gap: 6px; align-items: center; }
    button { font: inherit; padding: 6px 10px; cursor: pointer; }
    input { font: inherit; padding: 6px 8px; }
    .secret-row { display: ${config.inviteRequired ? "block" : "none"}; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #f3f4f6; font-size: 12px; }
    .pill.ok { background: #dcfce7; color: #166534; }
    .pill.bad { background: #fee2e2; color: #991b1b; }
    #clients, #sessions { display: flex; flex-direction: column; gap: 4px; }
    .client, .session { padding: 6px 8px; border-radius: 6px; background: #f9fafb; font-size: 12px; }
    .session { cursor: pointer; }
    .session:hover { background: #eef2ff; }
    .session.selected { background: #c7d2fe; }
    #messages { flex: 1; overflow: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
    #session-status { border-bottom: 1px solid #ddd; padding: 8px 16px; color: #666; font-size: 12px; }
    .msg { padding: 8px 10px; border-radius: 8px; background: #f3f4f6; max-width: 760px; white-space: pre-wrap; }
    .msg.assistant { background: #eef2ff; }
    .msg.user { background: #dbeafe; align-self: flex-end; }
    .msg.system { background: #fef3c7; font-style: italic; }
    .meta { color: #666; font-size: 12px; margin-bottom: 2px; }
    form { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #ddd; }
    #text { flex: 1; }
    .hint { color: #666; font-size: 12px; line-height: 1.4; }
    .danger { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
  </style>
</head>
<body>
  <aside>
    <h2>Cline Hub Chat</h2>
    <div class="row"><span id="connection" class="pill bad">Disconnected</span> <span id="uptime" class="hint"></span></div>
    <label>Display name <input id="name" /></label>
    <p class="secret-row"><label>Room secret <input id="secret" type="password" autocomplete="off" /></label></p>
    <p class="hint">Public URL: <span id="public-url"></span><br/>Hub: <span id="hub-url" class="hint"></span></p>
    <div class="row"><button id="connect">Connect</button> <button id="refresh">Refresh</button> <button id="restart" class="danger">Restart Hub</button></div>
    <div class="section">
      <h3>New chat</h3>
      <div class="row"><input id="new-prompt" placeholder="Initial prompt..." style="flex:1" /><button id="create">Start</button></div>
      <p class="hint">Uses the most recent session's workspace, provider, and model.</p>
    </div>
    <div class="section">
      <h3>Connected clients</h3>
      <div id="clients"><p class="hint">No clients reported yet.</p></div>
    </div>
    <div class="section">
	      <h3>Recent Sessions</h3>
      <div id="sessions"><p class="hint">No sessions reported yet.</p></div>
    </div>
  </aside>
  <main>
    <div id="session-status">No session selected.</div>
    <div id="messages"></div>
    <form id="form"><input id="text" placeholder="Send a message to the selected session..." /><button>Send</button></form>
  </main>
  <script>
    const CONFIG = ${JSON.stringify(config)};
    let ws;
    let currentSessionId;
    const $ = id => document.getElementById(id);
    function frame(payload) { ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(payload)); }
    $('public-url').textContent = CONFIG.publicUrl;
    const pageSecret = new URLSearchParams(location.search).get('roomSecret') || '';
    $('secret').value = pageSecret;

    function setConnectionState(state) {
      const el = $('connection');
      el.textContent = state.connected ? 'Hub connected' : 'Hub disconnected';
      el.className = 'pill ' + (state.connected ? 'ok' : 'bad');
      $('uptime').textContent = state.hubUptime ? ('uptime ' + state.hubUptime) : '';
      $('hub-url').textContent = state.hubUrl || '';
    }

    function renderClients(list) {
      const container = $('clients');
      container.innerHTML = '';
      if (!list || list.length === 0) {
        container.innerHTML = '<p class="hint">No clients connected.</p>';
        return;
      }
      for (const client of list) {
        const div = document.createElement('div');
        div.className = 'client';
        const name = client.displayName || client.clientType || client.clientId;
        div.innerHTML = '<strong>' + escapeHtml(name) + '</strong><br/><span class="hint">' + escapeHtml(client.clientType || '') + '</span>';
        container.appendChild(div);
      }
    }

    function renderSessions(list) {
      const container = $('sessions');
      container.innerHTML = '';
      if (!list || list.length === 0) {
        container.innerHTML = '<p class="hint">No sessions yet.</p>';
        return;
      }
      for (const session of list) {
        const div = document.createElement('div');
        div.className = 'session' + (session.sessionId === currentSessionId ? ' selected' : '');
        const title = session.title || session.sessionId.slice(0, 10);
        const source = session.source ? (' · ' + session.source) : '';
        const model = session.model ? (' · ' + session.model) : '';
        div.innerHTML = '<strong>' + escapeHtml(title) + '</strong><br/><span class="hint">' + escapeHtml(session.status || 'unknown') + escapeHtml(source) + escapeHtml(model) + '</span>';
        div.onclick = () => frame({ type: 'select', sessionId: session.sessionId });
        container.appendChild(div);
      }
    }

    function renderMessage(record) {
      const role = (record.role || record.kind || 'user').toLowerCase();
      const div = document.createElement('div');
      const cls = role === 'assistant' || role === 'agent' ? 'assistant' : role === 'system' ? 'system' : 'user';
      div.className = 'msg ' + cls;
      const text = typeof record.content === 'string'
        ? record.content
        : (typeof record.text === 'string' ? record.text : JSON.stringify(record.content ?? record));
      div.innerHTML = '<div class="meta">' + escapeHtml(role) + '</div><div></div>';
      div.children[1].textContent = text;
      $('messages').appendChild(div);
      $('messages').scrollTop = $('messages').scrollHeight;
    }

    function appendChunk(sessionId, text) {
      if (sessionId !== currentSessionId) return;
      const messages = $('messages');
      let last = messages.lastElementChild;
      if (!last || !last.classList.contains('assistant') || !last.dataset.streaming) {
        last = document.createElement('div');
        last.className = 'msg assistant';
        last.dataset.streaming = '1';
        last.innerHTML = '<div class="meta">assistant</div><div></div>';
        messages.appendChild(last);
      }
      last.children[1].textContent += text;
      messages.scrollTop = messages.scrollHeight;
    }

    function finishStreaming() {
      for (const el of $('messages').querySelectorAll('.msg.assistant[data-streaming]')) {
        delete el.dataset.streaming;
      }
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    $('connect').onclick = () => {
      if (ws && ws.readyState === WebSocket.OPEN) return;
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const params = new URLSearchParams();
      const secret = $('secret').value.trim();
      if (secret) params.set('roomSecret', secret);
      const query = params.toString();
      ws = new WebSocket(protocol + '//' + location.host + '/browser' + (query ? '?' + query : ''));
      ws.onopen = () => frame({ type: 'hello', displayName: $('name').value });
      ws.onclose = () => setConnectionState({ connected: false });
      ws.onmessage = event => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'hub_state') {
          setConnectionState(msg);
          renderClients(msg.clients || []);
          renderSessions(msg.sessions || []);
        } else if (msg.type === 'session') {
          currentSessionId = msg.sessionId;
          $('messages').innerHTML = '';
          $('session-status').textContent = 'Session ' + (msg.session?.title || msg.sessionId) + ' · ' + (msg.session?.status || 'unknown');
          (msg.history || []).forEach(renderMessage);
          renderSessions([...document.querySelectorAll('.session')].map(() => null) ? null : null);
          // re-render selected pill in sidebar; trigger by requesting list
          frame({ type: 'list' });
        } else if (msg.type === 'chunk') {
          appendChunk(msg.sessionId, msg.text);
        } else if (msg.type === 'status') {
          if (msg.sessionId === currentSessionId) {
            $('session-status').textContent = 'Session ' + msg.sessionId + ' · ' + msg.status;
          }
        } else if (msg.type === 'ended') {
          finishStreaming();
          if (msg.sessionId === currentSessionId) {
            $('session-status').textContent = 'Session ' + msg.sessionId + ' · ended';
          }
        } else if (msg.type === 'notification') {
          console.log('[notification]', msg.severity, msg.title, msg.body);
        } else if (msg.type === 'error') {
          alert(msg.message);
        }
      };
    };

    $('refresh').onclick = () => frame({ type: 'list' });
    $('restart').onclick = () => {
      if (confirm('Restart the Cline hub? Running sessions on this server will be detached.')) frame({ type: 'restart_hub' });
    };
    $('create').onclick = () => {
      const prompt = $('new-prompt').value.trim();
      if (!prompt) { alert('Enter an initial prompt for the new session.'); return; }
      frame({ type: 'create', prompt });
      $('new-prompt').value = '';
    };
    $('form').onsubmit = e => {
      e.preventDefault();
      const text = $('text').value.trim();
      if (!text) return;
      // Optimistically render the user's message; assistant chunks will stream back.
      renderMessage({ role: 'user', content: text });
      frame({ type: 'message', text });
      $('text').value = '';
    };
  </script>
</body>
</html>`;
}
