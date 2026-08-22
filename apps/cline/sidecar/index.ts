import { resolve } from "node:path";
import {
	SERVER_REQUEST_METHODS,
	type GatewayEvent,
	type GatewayServerRequest,
} from "@cline/shared/gateway";
import { listQueuedPrompts } from "./chat-runs";
import { projectMessageToChatEvents } from "./chat-events";
import { handleImmediateGatewayServerRequest } from "./gateway-server-requests";
import { ensureGateway, updateGateway } from "./gateway";
import { broadcast, startServer } from "./server";
import { SIDECAR_HOST, SIDECAR_VERSION, type SidecarContext } from "./types";

function eventSession(event: GatewayEvent): string | undefined {
	return event.scope.sessionId;
}

function pendingToolApprovalItems(ctx: SidecarContext, sessionId: string) {
	const createdAt = new Date().toISOString();
	return [...ctx.pendingServerRequests.values()]
		.filter(
			(request) =>
				request.method === SERVER_REQUEST_METHODS.toolApproval &&
				request.scope.sessionId === sessionId,
		)
		.map((request) => ({
			requestId: request.id,
			sessionId: request.scope.sessionId,
			createdAt,
			...request.params,
		}));
}

async function main(): Promise<void> {
	const gateway = await ensureGateway();
	let replacingGateway = false;
	let shuttingDown = false;
	const ctx: SidecarContext = {
		client: gateway.client,
		gatewayUpdateRequired: gateway.updateRequired,
		async updateGateway() {
			replacingGateway = true;
			try {
				const replacement = await updateGateway(ctx.client);
				ctx.client = replacement.client;
				ctx.gatewayUpdateRequired = false;
				bindClient(replacement.client);
				await replacement.client.subscribe({});
				broadcast(ctx, "gateway_updated", {});
				broadcast(ctx, "gateway_status", { status: "connected" });
			} catch (error) {
				broadcast(ctx, "gateway_status", {
					status: "unavailable",
					error:
						"The bundled Gateway upgrade failed. Restarting the desktop backend.",
				});
				setTimeout(() => process.exit(1), 250);
				throw error;
			} finally {
				replacingGateway = false;
			}
		},
		botId: process.env.CLINE_BOT_ID?.trim() || undefined,
		workspaceRoot: resolve(
			process.env.CLINE_WORKSPACE_ROOT?.trim() || process.cwd(),
		),
		workspaceRootLocked:
			process.env.CLINE_DESKTOP_WORKSPACE_LOCKED?.trim() === "1",
		sockets: new Set(),
		activeRuns: new Map(),
		pendingServerRequests: new Map(),
	};
	const bindClient = (client: typeof ctx.client) => {
		client.onClose(() => {
			if (shuttingDown || replacingGateway || ctx.client !== client) return;
			broadcast(ctx, "gateway_status", {
				status: "unavailable",
				error:
					"The bundled Gateway connection was lost. Restarting the desktop backend.",
			});
			// A sidecar must never stay alive behind a healthy WebSocket while its
			// Gateway client is dead. Native debug mode and the packaged service
			// both supervise this process and will start a fresh connection. The
			// bridge never owns the Gateway process. Exiting asks the native or
			// service supervisor to reconnect; the singleton authority stays alive.
			setTimeout(() => process.exit(1), 250);
		});
		client.onEvent((event) => {
			const sessionId = eventSession(event);
			const runId = event.scope.runId;
			if (
				(event.event === "approval.resolved" ||
					event.event === "serverRequest.resolved") &&
				typeof event.payload?.requestId === "string"
			) {
				const requestId = event.payload.requestId;
				const pending = ctx.pendingServerRequests.get(requestId);
				ctx.pendingServerRequests.delete(requestId);
				if (pending?.method === SERVER_REQUEST_METHODS.question) {
					broadcast(ctx, "ask_question_answered", { requestId });
				} else if (pending?.method === SERVER_REQUEST_METHODS.toolApproval) {
					const approvalSessionId = pending.scope.sessionId;
					if (approvalSessionId) {
						broadcast(ctx, "tool_approval_state", {
							sessionId: approvalSessionId,
							items: pendingToolApprovalItems(ctx, approvalSessionId),
						});
					}
				}
			}
			const broadcastQueue = () => {
				if (!sessionId) return;
				void listQueuedPrompts(ctx, sessionId)
					.then((items) => {
						if (ctx.client !== client) return;
						broadcast(ctx, "prompts_in_queue_state", { sessionId, items });
					})
					.catch(() => {
						// The client close handler owns reconnection. Queue projection is
						// best-effort while that transition is in progress.
					});
			};
			if (event.event === "run.messageAppended" && sessionId) {
				const message = event.payload?.message as
					| Parameters<typeof projectMessageToChatEvents>[0]
					| undefined;
				if (message) {
					for (const projected of projectMessageToChatEvents(message)) {
						broadcast(ctx, "chat_event", {
							sessionId,
							stream: projected.stream,
							chunk: projected.chunk,
							timestamp: Date.now(),
						});
					}
				}
			}
			if (
				["run.queued", "run.queuedUpdated", "run.queuedPromoted"].includes(
					event.event,
				) &&
				sessionId
			) {
				broadcastQueue();
			}
			if (event.event === "run.started" && sessionId) {
				if (runId) ctx.activeRuns.set(sessionId, runId);
				broadcast(ctx, "chat_session_status", { sessionId, status: "running" });
				if (runId) {
					void client
						.listRuns({ runId })
						.then(({ runs }) => {
							const run = runs[0];
							if (!run || ctx.client !== client) return;
							broadcast(ctx, "chat_event", {
								sessionId,
								stream: "chat_queued_prompt_start",
								chunk: JSON.stringify({
									promptId: run.runId,
									prompt: run.input,
								}),
								timestamp: Date.now(),
							});
						})
						.catch(() => {
							// The close handler will reconnect a failed Gateway client.
						});
				}
				broadcastQueue();
			}
			if (
				[
					"run.completed",
					"run.failed",
					"run.aborted",
					"run.interrupted",
				].includes(event.event) &&
				sessionId
			) {
				const wasActive = !runId || ctx.activeRuns.get(sessionId) === runId;
				if (wasActive) ctx.activeRuns.delete(sessionId);
				broadcastQueue();
				// Cancelling a queued follow-up is a queue mutation, not the end of
				// the run currently visible in the conversation.
				if (event.event === "run.aborted" && !wasActive) return;
				const reason =
					event.event === "run.completed"
						? "completed"
						: event.event === "run.interrupted" || event.event === "run.aborted"
							? "aborted"
							: "error";
				const runError = event.payload?.error as
					| { message?: unknown }
					| undefined;
				const failureText =
					reason === "error" && typeof runError?.message === "string"
						? runError.message.trim()
						: "";
				broadcast(ctx, "chat_event", {
					sessionId,
					stream: "chat_done",
					chunk: JSON.stringify({
						reason,
						...(failureText ? { text: failureText } : {}),
					}),
					timestamp: Date.now(),
				});
				broadcast(ctx, "chat_session_ended", { sessionId, reason });
			}
		});
		client.onServerRequest(async (request: GatewayServerRequest) => {
			const immediate = await handleImmediateGatewayServerRequest(ctx, request);
			if (immediate.handled) return immediate.result;
			ctx.pendingServerRequests.set(request.id, request);
			if (request.method === SERVER_REQUEST_METHODS.question) {
				broadcast(ctx, "ask_question_requested", {
					requestId: request.id,
					createdAt: new Date().toISOString(),
					question: request.params?.question,
					options: request.params?.options,
					context: {
						agentId: request.scope.botId,
						conversationId: request.scope.sessionId,
					},
				});
			} else if (request.method === SERVER_REQUEST_METHODS.toolApproval) {
				const sessionId = request.scope.sessionId;
				if (!sessionId) {
					ctx.pendingServerRequests.delete(request.id);
					throw new Error("Gateway tool approval is missing a session scope");
				}
				broadcast(ctx, "tool_approval_state", {
					sessionId,
					items: pendingToolApprovalItems(ctx, sessionId),
				});
			}
			return new Promise(() => {});
		});
	};
	bindClient(ctx.client);
	await ctx.client.subscribe({});
	const server = startServer(ctx);
	const dialHost = SIDECAR_HOST === "0.0.0.0" ? "127.0.0.1" : SIDECAR_HOST;
	ctx.webSocketAddress = `ws://${dialHost}:${server.port}/`;
	process.stdout.write(
		`${JSON.stringify({ type: "ready", version: SIDECAR_VERSION, endpoint: `http://${dialHost}:${server.port}`, wsEndpoint: ctx.webSocketAddress, pid: process.pid, mode: "gateway", protocol: "cline-gateway-bridge-v1" })}\n`,
	);
	const shutdown = () => {
		shuttingDown = true;
		server.stop();
		ctx.client.close();
		process.exit(0);
	};
	process.once("SIGINT", shutdown);
	process.once("SIGTERM", shutdown);
}

main().catch((error) => {
	process.stderr.write(
		`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
	);
	process.exit(1);
});
