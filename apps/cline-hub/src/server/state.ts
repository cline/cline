import {
	type BoundedOutboundChannelOptions,
	type ClineCore,
	CORE_BUILD_VERSION,
	type HubUIClient,
	type OutboundMessageOptions,
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
	constructor(readonly websocketDelivery: BoundedOutboundChannelOptions = {}) {}
	readonly clients = new Map<string, TrackedClient>();
	readonly sessions = new Map<string, TrackedSession>();
	readonly pendingToolApprovals = new Map<string, PendingToolApproval>();
	readonly events: WebviewHubEvent[] = [];
	/** toolCallId → input captured at content_start for Drive work bridge. */
	readonly pendingToolInputs = new Map<string, unknown>();

	hubUrl = "";
	hubAuthToken = "";
	hubHealthy = false;
	cline: ClineCore | undefined;
	uiClient: HubUIClient | undefined;
	hubStartedAt: string | undefined;
	coreVersion: string | undefined = CORE_BUILD_VERSION;
	lastSessionContext: SessionContext | undefined;
	initialHubEventEmitted = false;

	send(
		peer: BrowserPeer,
		payload: unknown,
		options: OutboundMessageOptions = { priority: "high" },
	): void {
		peer.outbound?.send(JSON.stringify(payload), options);
	}

	broadcast(
		payload: unknown,
		options: OutboundMessageOptions = { priority: "normal" },
	): void {
		const data = JSON.stringify(payload);
		const type =
			payload && typeof payload === "object"
				? (payload as { type?: unknown }).type
				: undefined;
		const delivery =
			type === "hub_state" || type === "sessions" || type === "room_snapshot"
				? { priority: "low" as const, replaceableKey: String(type) }
				: options;
		for (const peer of this.peers) {
			peer.outbound?.send(data, delivery);
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
				const type =
					payload && typeof payload === "object"
						? (payload as { type?: unknown }).type
						: undefined;
				this.send(
					peer,
					payload,
					type === "assistant_delta" || type === "reasoning_delta"
						? { priority: "low" }
						: { priority: "normal" },
				);
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
