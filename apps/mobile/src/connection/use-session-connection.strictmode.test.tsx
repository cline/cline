/**
 * `useSessionConnection` must build exactly ONE `HubClient` per descriptor
 * lifecycle, even under React Strict Mode's mount → unmount → remount, and must
 * never leave the transient first client connected. A second live client is how
 * the on-device flow ended up answering an approval through a client that never
 * owned the session.
 */

import type { HubClient } from "@cline/hub-client";
import { startTestHub, type TestHub } from "@cline/hub-testkit";
import { StrictMode } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it } from "vitest";
import {
	resolveTestHubSession,
	waitFor,
} from "../session/__testing__/test-hub-handle";
import type { SessionConnectionControllerDeps } from "./controller";
import type { ConnectionDescriptor } from "./endpoints";
import { useSessionConnection } from "./use-session-connection";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let hub: TestHub | undefined;

afterEach(async () => {
	await hub?.close();
	hub = undefined;
});

function Probe({
	descriptor,
	deps,
}: {
	descriptor: ConnectionDescriptor;
	deps: SessionConnectionControllerDeps;
}) {
	useSessionConnection(descriptor, deps);
	return null;
}

describe("useSessionConnection under Strict Mode", () => {
	it("builds exactly one HubClient and leaves no orphaned connection", async () => {
		hub = await startTestHub({ script: [{ kind: "text", chunks: ["hi"] }] });
		const testHub = hub;
		const clients: HubClient[] = [];
		const deps: SessionConnectionControllerDeps = {
			createHandle: async () => {
				const handle = await resolveTestHubSession(testHub);
				clients.push(handle.client);
				return handle;
			},
		};
		const descriptor: ConnectionDescriptor = {
			mode: "local",
			url: hub.url,
			authToken: hub.authToken,
		};

		await act(async () => {
			create(
				<StrictMode>
					<Probe descriptor={descriptor} deps={deps} />
				</StrictMode>,
			);
		});
		await act(async () => {
			await waitFor(
				() => clients.some((client) => client.isConnected()),
				"the session to connect",
			);
			// Let any transient second bootstrap settle before counting.
			await new Promise((resolve) => setTimeout(resolve, 500));
		});

		// Exactly one client is ever built for a single descriptor lifecycle...
		expect(clients).toHaveLength(1);
		// ...and it is live (no orphaned, still-connected first client).
		expect(clients.filter((client) => client.isConnected())).toHaveLength(1);
	});
});
