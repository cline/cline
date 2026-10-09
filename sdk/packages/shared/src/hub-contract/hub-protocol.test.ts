import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CURRENT_HUB_PROTOCOL_VERSION } from "../hub";
import {
	buildHubProtocolDocument,
	findBreakingHubProtocolChanges,
	type HubProtocolDocument,
} from ".";

/**
 * Clients accept a Hub from another installation (for example the Cline CLI
 * on an SSH host) when its core release is at least theirs and the protocol
 * version is compatible, so a breaking wire change that keeps the protocol
 * version fails installed clients mid-session instead of at connect.
 *
 * hub-protocol.released.json is the contract as of the latest SDK release;
 * `bun run version` refreshes it (scripts/hub-protocol-baseline.ts), so
 * everyday additive changes need no regeneration. A breaking change needs a
 * protocol version bump in hub.ts: CURRENT_HUB_PROTOCOL_VERSION, plus
 * MIN/MAX_CLIENT_HUB_PROTOCOL_VERSION as appropriate.
 */
describe("Hub protocol", () => {
	const released = JSON.parse(
		readFileSync(
			new URL("./hub-protocol.released.json", import.meta.url),
			"utf8",
		),
	) as HubProtocolDocument;
	const current = buildHubProtocolDocument(CURRENT_HUB_PROTOCOL_VERSION);

	it("stays compatible with the last release unless the protocol version is bumped", () => {
		if (released.protocolVersion !== current.protocolVersion) return;
		expect(
			findBreakingHubProtocolChanges(released, current),
			"Breaking Hub wire changes since the last release; see this test's header",
		).toEqual([]);
	});
});
