import {
	type ClineCore,
	CORE_BUILD_VERSION,
	type HubUIClient,
} from "@cline/core";
import type { WebviewHubEvent } from "../webview-protocol";
import type {
	BrowserPeer,
	PendingToolApproval,
	SessionContext,
	TrackedClient,
	TrackedSession,
} from "./types";

/**
 * Shared mutable runtime state for the Cline Hub server. A single instance is
 * created in `server.ts` and threaded through the feature modules, replacing
 * what used to be a wall of module-level `let`s in the monolithic file.
 */
export class HubContext {
	readonly peers = new Set<BrowserPeer>();
	readonly clients = new Map<string, TrackedClient>();
	readonly sessions = new Map<string, TrackedSession>();
	readonly pendingToolApprovals = new Map<string, PendingToolApproval>();
	readonly events: WebviewHubEvent[] = [];

	hubUrl = "";
	hubAuthToken = "";
	hubHealthy = false;
	cline: ClineCore | undefined;
	uiClient: HubUIClient | undefined;
	hubStartedAt: string | undefined;
	coreVersion: string | undefined = CORE_BUILD_VERSION;
	lastSessionContext: SessionContext | undefined;
	initialHubEventEmitted = false;

	send(peer: BrowserPeer, payload: unknown): void {
		peer.socket.send(JSON.stringify(payload));
	}

	broadcast(payload: unknown): void {
		const data = JSON.stringify(payload);
		for (const peer of this.peers) {
			peer.socket.send(data);
		}
	}

	pushEvent(
		title: string,
		body: string,
		severity: WebviewHubEvent["severity"] = "info",
		timestamp = Date.now(),
	): void {
		this.events.unshift({
			id: `${timestamp}-${this.events.length}-${title}`,
			title,
			body,
			severity,
			timestamp,
		});
		if (this.events.length > 30) this.events.length = 30;
	}

	sendToSelectedPeers(sessionId: string, payload: unknown): void {
		for (const peer of this.peers) {
			if (peer.selectedSessionId === sessionId) {
				this.send(peer, payload);
			}
		}
	}

	hasSelectedPeer(sessionId: string): boolean {
		for (const peer of this.peers) {
			if (peer.selectedSessionId === sessionId) return true;
		}
		return false;
	}
}
