import {
	ClineCore,
	ensureDetachedHubServer,
	type HubServerDiscoveryRecord,
	HubUIClient,
	rememberRecoverableLocalHubUrl,
	stopLocalHubServerGracefully,
	toHubHealthUrl,
} from "@cline/core";
import type { HubUINotifyPayload } from "@cline/shared";
import { handleSessionEvent } from "./agent-events";
import {
	rejectAllPendingApprovals,
	requestToolApprovalFromWebview,
} from "./approvals";
import { workspaceRoot } from "./deps";
import {
	formatClientName,
	formatSessionCreator,
	parseSessionContext,
	trackSession,
} from "./session-mapping";
import type { HubContext } from "./state";
import { broadcastHubState } from "./state-payloads";
import type { SessionContext } from "./types";
import { asString, basename, isActiveSession, isVisibleClient } from "./utils";

export async function syncHubHealth(ctx: HubContext): Promise<void> {
	if (!ctx.hubUrl) {
		ctx.hubHealthy = false;
		return;
	}
	try {
		const response = await fetch(toHubHealthUrl(ctx.hubUrl));
		if (!response.ok) {
			ctx.hubHealthy = false;
			return;
		}
		ctx.hubHealthy = true;
		const health = (await response.json()) as Partial<HubServerDiscoveryRecord>;
		if (typeof health.startedAt === "string")
			ctx.hubStartedAt = health.startedAt;
		if (typeof health.coreVersion === "string") {
			ctx.coreVersion = health.coreVersion;
		}
	} catch {
		ctx.hubHealthy = false;
		// best-effort
	}
}

export async function syncHubClientsAndSessions(
	ctx: HubContext,
): Promise<void> {
	if (!ctx.uiClient) return;
	const [knownClients, knownSessions] = await Promise.all([
		ctx.uiClient.listClients(),
		ctx.uiClient.listSessions(10),
	]);
	ctx.clients.clear();
	for (const client of knownClients) {
		if (!client.clientId || !isVisibleClient(client.clientType)) continue;
		ctx.clients.set(client.clientId, {
			clientId: client.clientId,
			displayName: client.displayName,
			clientType: client.clientType,
			connectedAt: client.connectedAt,
		});
	}
	ctx.sessions.clear();
	for (const session of knownSessions) {
		const tracked = trackSession(session);
		if (tracked) ctx.sessions.set(tracked.sessionId, tracked);
	}
	if (!ctx.initialHubEventEmitted) {
		const activeSessionCount = [...ctx.sessions.values()].filter((session) =>
			isActiveSession(session.title, session.status, session.participantCount),
		).length;
		ctx.pushEvent(
			"Hub monitor connected",
			`${ctx.clients.size} connected client${ctx.clients.size === 1 ? "" : "s"}, ${activeSessionCount} active session${activeSessionCount === 1 ? "" : "s"}`,
			"success",
		);
		ctx.initialHubEventEmitted = true;
	}
	const mostRecent = [...knownSessions]
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.map((s) => parseSessionContext(s))
		.find((c): c is SessionContext => Boolean(c));
	if (mostRecent) ctx.lastSessionContext = mostRecent;
}

export interface HubAttachmentOverride {
	hubUrl?: string;
	authToken?: string;
}

function resolveHubAttachmentOverride(
	override?: HubAttachmentOverride,
): { hubUrl: string; authToken: string } | undefined {
	const rawHubUrl = override?.hubUrl?.trim();
	if (!rawHubUrl) {
		return undefined;
	}
	const parsed = new URL(rawHubUrl);
	const queryToken = parsed.searchParams.get("authToken")?.trim();
	parsed.searchParams.delete("authToken");
	parsed.hash = "";
	const authToken = override?.authToken?.trim() || queryToken || undefined;
	if (!authToken) {
		throw new Error(
			"Hub auth token is required when connecting the dashboard to a custom hub URL.",
		);
	}
	return {
		hubUrl: parsed.toString(),
		authToken,
	};
}

export async function attachHub(
	ctx: HubContext,
	override?: HubAttachmentOverride,
): Promise<void> {
	const resolvedOverride = resolveHubAttachmentOverride(override);
	const hub = resolvedOverride
		? {
				url: rememberRecoverableLocalHubUrl(
					resolvedOverride.hubUrl,
					resolvedOverride.authToken,
				),
				authToken: resolvedOverride.authToken,
			}
		: await ensureDetachedHubServer(workspaceRoot);

	await detachHub(ctx);
	ctx.hubUrl = hub.url;
	ctx.hubAuthToken = hub.authToken;

	ctx.cline = await ClineCore.create({
		clientName: "cline-hub",
		backendMode: "hub",
		capabilities: {
			requestToolApproval: (request) =>
				requestToolApprovalFromWebview(ctx, request),
		},
		hub: {
			endpoint: ctx.hubUrl,
			authToken: ctx.hubAuthToken,
			clientType: "cline-hub-chat",
			displayName: "Cline Hub Chat",
			workspaceRoot,
		},
	});

	ctx.uiClient = new HubUIClient({
		address: ctx.hubUrl,
		authToken: ctx.hubAuthToken,
		clientType: "cline-hub-server",
		displayName: "Cline Hub Server",
	});
	await ctx.uiClient.connect();

	ctx.uiClient.subscribeUI({
		onNotify(payload: HubUINotifyPayload) {
			ctx.pushEvent(
				payload.title,
				payload.body,
				payload.severity === "error"
					? "error"
					: payload.severity === "warning"
						? "warn"
						: "info",
			);
			ctx.broadcast({
				type: "notification",
				title: payload.title,
				body: payload.body,
				severity: payload.severity ?? "info",
			});
		},
		onClientRegistered(payload) {
			const clientId = asString(payload.clientId);
			const clientType = asString(payload.clientType) ?? "unknown";
			if (!clientId || !isVisibleClient(clientType)) return;
			ctx.clients.set(clientId, {
				clientId,
				displayName: asString(payload.displayName),
				clientType,
				connectedAt: Date.now(),
			});
			ctx.pushEvent(
				"Client connected",
				`${asString(payload.displayName) ?? clientType} joined the hub`,
				"success",
			);
			broadcastHubState(ctx);
		},
		onClientDisconnected(payload) {
			const clientId = asString(payload.clientId);
			if (!clientId) return;
			const client = ctx.clients.get(clientId);
			ctx.clients.delete(clientId);
			if (client) {
				ctx.pushEvent(
					"Client disconnected",
					`${formatClientName(client)} left the hub`,
					"info",
				);
			}
			broadcastHubState(ctx);
		},
		onSessionCreated(payload) {
			const record =
				payload.session && typeof payload.session === "object"
					? (payload.session as Record<string, unknown>)
					: (payload as unknown as Record<string, unknown>);
			const tracked = trackSession(record);
			if (tracked) {
				ctx.sessions.set(tracked.sessionId, tracked);
				const context = parseSessionContext(record);
				if (context) ctx.lastSessionContext = context;
				ctx.pushEvent(
					"Session started",
					`By ${formatSessionCreator(ctx, tracked)} at ${basename(tracked.workspaceRoot || tracked.cwd)}`,
					"success",
				);
				broadcastHubState(ctx);
			}
		},
		onSessionUpdated(payload) {
			const record =
				payload.session && typeof payload.session === "object"
					? (payload.session as Record<string, unknown>)
					: (payload as unknown as Record<string, unknown>);
			const tracked = trackSession(record);
			if (tracked) {
				ctx.sessions.set(tracked.sessionId, tracked);
				const context = parseSessionContext(record);
				if (context) ctx.lastSessionContext = context;
				broadcastHubState(ctx);
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
				ctx.sessions.delete(sessionId);
				broadcastHubState(ctx);
			}
		},
	});

	ctx.cline.subscribe((event) => handleSessionEvent(ctx, event));

	await syncHubClientsAndSessions(ctx);
	await syncHubHealth(ctx);
}

export async function detachHub(ctx: HubContext): Promise<void> {
	rejectAllPendingApprovals(
		ctx,
		"Hub disconnected before approval was resolved.",
	);
	for (const peer of ctx.peers) {
		peer.unsubscribeEvents?.();
		peer.unsubscribeEvents = undefined;
	}
	try {
		ctx.uiClient?.close();
	} catch {
		// ignore
	}
	ctx.uiClient = undefined;
	try {
		await ctx.cline?.dispose();
	} catch {
		// ignore
	}
	ctx.cline = undefined;
	ctx.clients.clear();
	ctx.sessions.clear();
	ctx.hubStartedAt = undefined;
	ctx.coreVersion = undefined;
	ctx.initialHubEventEmitted = false;
}

export async function restartHub(ctx: HubContext): Promise<void> {
	ctx.broadcast({
		type: "notification",
		title: "Hub restarting",
		body: "Shutting down and respawning hub...",
		severity: "warn",
	});
	await detachHub(ctx);
	try {
		await stopLocalHubServerGracefully();
	} catch (error) {
		console.warn("stopLocalHubServerGracefully failed:", error);
	}
	await attachHub(ctx);
	broadcastHubState(ctx);
	ctx.broadcast({
		type: "notification",
		title: "Hub restarted",
		body: `Connected to ${ctx.hubUrl}`,
		severity: "info",
	});
}
