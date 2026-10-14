import {
	ensureDetachedHubServer,
	type NodeHubClient,
	probeHubServer,
	requestHubShutdown,
} from "@cline/core";
import type { HubClientRecord } from "@cline/shared";
import type { HubActivity, HubStatus } from "../webview/lib/hub-status";
import type { SidecarContext } from "./types";

const activity = new WeakMap<SidecarContext, HubActivity[]>();
let nextId = 0;
let restartPending: Promise<void> | undefined;

export function recordHubActivity(
	ctx: SidecarContext,
	event: {
		event: string;
		sessionId?: string;
		payload?: Record<string, unknown>;
	},
): void {
	const titles: Record<string, string> = {
		"hub.client.registered": "Client connected",
		"hub.client.disconnected": "Client disconnected",
		"session.created": "Session started",
		"session.detached": "Session detached",
		"run.started": "Run started",
		"run.completed": "Run completed",
		"run.failed": "Run failed",
		"run.aborted": "Run stopped",
		"ui.notify": "Notification",
	};
	const title = titles[event.event];
	if (!title) return;
	const payload = event.payload ?? {};
	const detail = [
		payload.displayName,
		payload.clientType,
		payload.clientId,
		event.sessionId,
	].find((value) => typeof value === "string") as string | undefined;
	const entry: HubActivity = {
		id: ++nextId,
		timestamp: Date.now(),
		title:
			event.event === "ui.notify" && typeof payload.title === "string"
				? payload.title
				: title,
		detail:
			event.event === "ui.notify" && typeof payload.body === "string"
				? payload.body
				: (detail ?? ""),
	};
	activity.set(ctx, [entry, ...(activity.get(ctx) ?? [])].slice(0, 100));
}

export async function getHubStatus(
	ctx: SidecarContext,
	client: NodeHubClient,
): Promise<HubStatus> {
	const reply = await client.command("client.list");
	if (!reply.ok)
		throw new Error(reply.error?.message ?? "Unable to list hub clients");
	const clients = (reply.payload?.clients ?? []) as HubClientRecord[];
	return {
		url: client.getUrl(),
		clients: clients.map(
			({ clientId, clientType, displayName, connectedAt }) => ({
				clientId,
				clientType,
				displayName,
				connectedAt,
			}),
		),
		events: activity.get(ctx) ?? [],
	};
}

export function restartHub(
	ctx: SidecarContext,
	client: NodeHubClient,
): Promise<void> {
	if (restartPending) return restartPending;
	restartPending = (async () => {
		const url = client.getUrl();
		if (!(await requestHubShutdown(url)))
			throw new Error("The hub did not accept the restart request.");
		const deadline = Date.now() + 15_000;
		while (
			await probeHubServer(url, { signal: AbortSignal.timeout(2000) }).catch(
				() => undefined,
			)
		) {
			if (Date.now() >= deadline)
				throw new Error("The hub did not stop in time. Try again.");
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		await ensureDetachedHubServer(ctx.localWorkspaceRoot);
		// Existing desktop clients rediscover the daemon on their next command.
		await client.command("client.list").then((reply) => {
			if (!reply.ok)
				throw new Error(
					reply.error?.message ?? "Unable to reconnect to the hub",
				);
		});
	})().finally(() => {
		restartPending = undefined;
	});
	return restartPending;
}
