import type { WebviewInboundMessage } from "../webview-protocol";
import { attachHub } from "./hub";
import { initializePeer } from "./sessions";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

type ConnectHubMessage = Extract<
	WebviewInboundMessage,
	{ type: "connect_hub" }
>;

export async function connectHubFromWebview(
	ctx: HubContext,
	peer: BrowserPeer,
	frame: ConnectHubMessage,
	syncClientsAndSessions: () => Promise<void>,
): Promise<void> {
	try {
		await attachHub(ctx, {
			hubUrl: frame.hubUrl,
			authToken: frame.authToken,
		});
		await initializePeer(ctx, peer, syncClientsAndSessions);
		ctx.send(peer, {
			type: "hub_connection_result",
			ok: true,
			hubUrl: ctx.hubUrl,
		});
	} catch (error) {
		ctx.send(peer, {
			type: "hub_connection_result",
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
