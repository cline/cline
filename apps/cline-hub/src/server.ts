import { CORE_BUILD_VERSION } from "@cline/core";
import { isNonLocalBindHost } from "./options";
import {
	handleToolApprovalResponse,
	rejectOrphanedApprovals,
} from "./server/approvals";
import {
	browserConfig,
	host,
	inviteUrl,
	port,
	publicUrl,
	roomSecret,
	webviewDistDir,
} from "./server/deps";
import { handleDesktopCommand } from "./server/desktop-commands";
import { createJsonResponse, WebviewAssets } from "./server/http";
import {
	attachHub,
	detachHub,
	restartHub,
	syncHubClientsAndSessions,
	syncHubHealth,
} from "./server/hub";
import { fetchMarketplaceCatalog } from "./server/marketplace";
import {
	loadModels,
	runProviderOAuthLogin,
	saveProviderSettings,
	sendProviderCatalog,
} from "./server/providers";
import {
	abortPeerTurn,
	deleteSession,
	forkPeerSession,
	initializePeer,
	resetPeer,
	restorePeerSession,
	selectSession,
	sendMessage,
} from "./server/sessions";
import { HubContext } from "./server/state";
import { broadcastHubState, hubStatusPayload } from "./server/state-payloads";
import type { BrowserFrame, BrowserPeer } from "./server/types";

export interface ClineHubDashboardServer {
	listenUrl: string;
	publicUrl: string;
	inviteUrl: string;
	bindHost: string;
	inviteRequired: boolean;
	hubUrl: string | undefined;
	stop: () => Promise<void>;
}

export async function startClineHubDashboardServer(): Promise<ClineHubDashboardServer> {
	const ctx = new HubContext();
	const assets = new WebviewAssets(webviewDistDir);
	const syncClientsAndSessions = () => syncHubClientsAndSessions(ctx);
	let stopped = false;

	function isAuthorizedBrowserRequest(url: URL): boolean {
		if (!roomSecret) return true;
		return url.searchParams.get("roomSecret") === roomSecret;
	}

	await attachHub(ctx);
	const healthInterval = setInterval(() => {
		void (async () => {
			await syncHubHealth(ctx);
			broadcastHubState(ctx);
		})();
	}, 5_000);

	const server = Bun.serve<BrowserPeer>({
		port,
		hostname: host,
		async fetch(req, server) {
			const url = new URL(req.url);
			if (url.pathname === "/version") {
				return createJsonResponse({ coreVersion: CORE_BUILD_VERSION });
			}
			if (url.pathname === "/health") {
				await syncHubHealth(ctx);
				return createJsonResponse(hubStatusPayload(ctx));
			}
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
			if (url.pathname === "/api/marketplace/catalog") {
				try {
					return createJsonResponse(await fetchMarketplaceCatalog());
				} catch (error) {
					return createJsonResponse(
						{
							error:
								error instanceof Error
									? error.message
									: "Failed to fetch marketplace catalog",
						},
						502,
					);
				}
			}
			return assets.serve(url.pathname);
		},
		websocket: {
			async open(socket) {
				const peer = socket.data;
				peer.socket = socket;
				ctx.peers.add(peer);
			},
			async message(socket, raw) {
				const peer = socket.data;
				try {
					const frame = JSON.parse(String(raw)) as BrowserFrame;
					if (frame.type === "desktopCommand") {
						try {
							const result = await handleDesktopCommand(
								ctx,
								frame.command,
								frame.args,
							);
							ctx.send(peer, {
								type: "desktopCommandResult",
								id: frame.id,
								ok: true,
								result,
							});
						} catch (error) {
							ctx.send(peer, {
								type: "desktopCommandResult",
								id: frame.id,
								ok: false,
								error: error instanceof Error ? error.message : String(error),
							});
						}
					} else if (frame.type === "ready") {
						await initializePeer(ctx, peer, syncClientsAndSessions);
					} else if (frame.type === "loadModels") {
						await loadModels(ctx, peer, frame.providerId);
					} else if (frame.type === "loadProviderCatalog") {
						await sendProviderCatalog(ctx, peer);
					} else if (frame.type === "saveProviderSettings") {
						await saveProviderSettings(ctx, peer, frame);
					} else if (frame.type === "runProviderOAuthLogin") {
						await runProviderOAuthLogin(ctx, peer, frame.providerId);
					} else if (frame.type === "attachSession") {
						await selectSession(ctx, peer, frame.sessionId);
					} else if (frame.type === "deleteSession") {
						await deleteSession(ctx, peer, frame.sessionId);
					} else if (frame.type === "updateSessionMetadata") {
						if (!ctx.cline) throw new Error("Hub is not connected.");
						const session = await ctx.cline.get(frame.sessionId);
						const metadata =
							session?.metadata && typeof session.metadata === "object"
								? (session.metadata as Record<string, unknown>)
								: {};
						await ctx.cline.update(frame.sessionId, {
							metadata: { ...metadata, ...frame.metadata },
						});
						await syncHubClientsAndSessions(ctx);
						broadcastHubState(ctx);
					} else if (frame.type === "approval_response") {
						handleToolApprovalResponse(ctx, frame);
					} else if (frame.type === "abort") {
						await abortPeerTurn(ctx, peer);
					} else if (frame.type === "reset") {
						await resetPeer(ctx, peer);
					} else if (frame.type === "send") {
						if (peer.sending) {
							ctx.send(peer, {
								type: "status",
								text: "A turn is already in progress.",
							});
							return;
						}
						peer.sending = true;
						try {
							await sendMessage(
								ctx,
								peer,
								frame.prompt,
								frame.config,
								frame.attachments,
							);
						} finally {
							peer.sending = false;
						}
					} else if (frame.type === "forkSession") {
						await forkPeerSession(ctx, peer, syncClientsAndSessions);
					} else if (frame.type === "restore") {
						await restorePeerSession(
							ctx,
							peer,
							frame.checkpointRunCount,
							syncClientsAndSessions,
						);
					} else if (frame.type === "restart_hub") {
						await restartHub(ctx);
					}
				} catch (error) {
					ctx.send(peer, {
						type: "error",
						text: error instanceof Error ? error.message : String(error),
					});
				}
			},
			close(socket) {
				const peer = socket.data;
				peer.unsubscribeEvents?.();
				ctx.peers.delete(peer);
				rejectOrphanedApprovals(ctx);
			},
		},
	});

	return {
		listenUrl: server.url.toString(),
		publicUrl,
		inviteUrl,
		bindHost: host,
		inviteRequired: Boolean(roomSecret),
		hubUrl: ctx.hubUrl,
		stop: async () => {
			if (stopped) return;
			stopped = true;
			clearInterval(healthInterval);
			try {
				server.stop(true);
			} finally {
				await detachHub(ctx);
			}
		},
	};
}

export function printClineHubDashboardServerInfo(
	server: ClineHubDashboardServer,
): void {
	console.log(`Cline Hub dashboard listening: ${server.listenUrl}`);
	console.log(`Cline Hub public URL: ${server.publicUrl}`);
	console.log(`hub endpoint: ${server.hubUrl}`);
	if (server.inviteRequired) {
		console.log(`Cline Hub invite URL: ${server.inviteUrl}`);
	} else if (isNonLocalBindHost(server.bindHost)) {
		console.warn("WARNING: non-local bind without ROOM_SECRET is not allowed.");
	} else {
		console.log(
			"ROOM_SECRET is not set; this local-only instance accepts browser connections without an invite token.",
		);
	}
}

if (import.meta.main) {
	const server = await startClineHubDashboardServer();
	printClineHubDashboardServerInfo(server);
}
