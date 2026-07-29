import { describe, expect, it, vi } from "vitest";
import { HubContext } from "./state";
import type { BrowserPeer } from "./types";

function createPeer(selectedSessionId?: string) {
	const send = vi.fn();
	const peer = {
		displayName: "test",
		selectedSessionId,
		sending: false,
		outbound: { send },
	} as unknown as BrowserPeer;
	return { peer, send };
}

describe("HubContext websocket delivery", () => {
	it("coalesces replaceable dashboard snapshots", () => {
		const ctx = new HubContext();
		const { peer, send } = createPeer();
		ctx.peers.add(peer);
		ctx.broadcast({ type: "hub_state", connected: true });
		expect(send).toHaveBeenCalledWith(expect.any(String), {
			priority: "low",
			replaceableKey: "hub_state",
		});
	});

	it("keeps streamed deltas low priority without replacing text", () => {
		const ctx = new HubContext();
		const { peer, send } = createPeer("session-1");
		ctx.peers.add(peer);
		ctx.sendToSelectedPeers("session-1", {
			type: "assistant_delta",
			text: "hello",
		});
		expect(send).toHaveBeenCalledWith(expect.any(String), { priority: "low" });
	});
});
