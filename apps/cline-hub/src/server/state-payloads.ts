import { listActiveConnectors } from "@cline/cline-hub/connectors";
import type { WebviewHubState } from "../webview-protocol";
import {
	clientSummariesPayload,
	toActionSessionSummary,
	webviewSessionsPayload,
} from "./session-mapping";
import type { HubContext } from "./state";
import { formatUptime, isActiveSession } from "./utils";

function activeSessionSummaries(ctx: HubContext) {
	return [...ctx.sessions.values()]
		.filter((session) =>
			isActiveSession(session.title, session.status, session.participantCount),
		)
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.map(toActionSessionSummary);
}

export function hubStatePayload(ctx: HubContext): WebviewHubState {
	const sessionSummaries = activeSessionSummaries(ctx);
	const clientList = [...ctx.clients.values()].sort(
		(a, b) => a.connectedAt - b.connectedAt,
	);
	return {
		type: "hub_state",
		connected: Boolean(ctx.cline && ctx.uiClient),
		hubUrl: ctx.hubUrl,
		hubStartedAt: ctx.hubStartedAt,
		coreVersion: ctx.coreVersion,
		hubUptime: ctx.hubStartedAt
			? formatUptime(Date.now() - Date.parse(ctx.hubStartedAt))
			: undefined,
		clients: clientList,
		connectors: listActiveConnectors(),
		sessions: sessionSummaries,
		clientSummaries: clientSummariesPayload(ctx),
		sessionSummaries,
		events: ctx.events,
		lastWorkspaceRoot: ctx.lastSessionContext?.workspaceRoot,
	};
}

export function hubStatusPayload(ctx: HubContext) {
	const clientList = [...ctx.clients.values()].sort(
		(a, b) => a.connectedAt - b.connectedAt,
	);
	const sessionSummaries = activeSessionSummaries(ctx);
	return {
		address: ctx.hubUrl,
		status: ctx.hubHealthy ? "healthy" : "unhealthy",
		healthy: ctx.hubHealthy,
		connected: Boolean(ctx.cline && ctx.uiClient),
		startedAt: ctx.hubStartedAt,
		uptime: ctx.hubStartedAt
			? formatUptime(Date.now() - Date.parse(ctx.hubStartedAt))
			: undefined,
		coreVersion: ctx.coreVersion,
		clients: clientList.map((client) => ({
			clientId: client.clientId,
			displayName: client.displayName,
			clientType: client.clientType,
			connectedAt: new Date(client.connectedAt).toISOString(),
		})),
		activeSessions: sessionSummaries.length,
	};
}

export function broadcastHubState(ctx: HubContext): void {
	ctx.broadcast(hubStatePayload(ctx));
	ctx.broadcast(webviewSessionsPayload(ctx));
}
