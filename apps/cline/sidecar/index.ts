import { resolve } from "node:path";
import type { GatewayEvent, GatewayServerRequest } from "@cline/shared/gateway";
import { ensureGateway } from "./gateway";
import { broadcast, startServer } from "./server";
import { SIDECAR_HOST, type SidecarContext } from "./types";

function eventSession(event: GatewayEvent): string | undefined { return event.scope.sessionId; }

async function main(): Promise<void> {
	const { client, ownedProcess } = await ensureGateway();
	const ctx: SidecarContext = {
		client,
		workspaceRoot: resolve(process.env.CLINE_WORKSPACE_ROOT?.trim() || process.cwd()),
		sockets: new Set(), activeRuns: new Map(), pendingApprovals: new Map(),
	};
	client.onEvent((event) => {
		const sessionId = eventSession(event);
		if (event.event === "run.messageAppended" && sessionId) {
			const message = event.payload?.message as { role?: string; content?: Array<{ type?: string; text?: string }> } | undefined;
			const chunk = message?.content?.filter((part) => part.type === "text").map((part) => part.text ?? "").join("") ?? "";
			if (message?.role === "assistant" && chunk) broadcast(ctx, "chat_event", { sessionId, stream: "chat_text", chunk, timestamp: Date.now() });
		}
		if (event.event === "run.started" && sessionId) broadcast(ctx, "chat_session_status", { sessionId, status: "running" });
		if (["run.completed", "run.failed", "run.interrupted"].includes(event.event) && sessionId) {
			ctx.activeRuns.delete(sessionId);
			const reason = event.event === "run.completed" ? "completed" : event.event === "run.interrupted" ? "aborted" : "error";
			broadcast(ctx, "chat_event", { sessionId, stream: "chat_done", chunk: JSON.stringify({ reason }), timestamp: Date.now() });
			broadcast(ctx, "chat_session_ended", { sessionId, reason });
		}
	});
	client.onServerRequest((request: GatewayServerRequest) => {
		ctx.pendingApprovals.set(request.id, { sessionId: request.scope.sessionId, request: request.params });
		broadcast(ctx, "tool_approval_state", { sessionId: request.scope.sessionId, items: [{ requestId: request.id, sessionId: request.scope.sessionId, ...request.params }] });
		return new Promise(() => {});
	});
	await client.subscribe({});
	const server = startServer(ctx);
	const dialHost = SIDECAR_HOST === "0.0.0.0" ? "127.0.0.1" : SIDECAR_HOST;
	process.stdout.write(`${JSON.stringify({ type: "ready", endpoint: `http://${dialHost}:${server.port}`, wsEndpoint: `ws://${dialHost}:${server.port}/transport`, pid: process.pid, mode: "bun" })}\n`);
	const shutdown = () => { server.stop(); client.close(); ownedProcess?.kill("SIGTERM"); process.exit(0); };
	process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exit(1); });
