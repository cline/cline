/**
 * The cloud handle against a real hub server (`startTestHub`): the REST gateway
 * is faked (its sandboxUrl points at the test hub), but the resolver, hub client
 * and `session.list`/`session.create` handshake are all real — proving a handle
 * built by `createCloudSessionHandle` is one `SessionConnection` can drive.
 *
 * The injected `clientFactory` uses `hub-subprotocol` with the hub's printed
 * token because the local test hub does not run the bearer-header proxy; the
 * production bearer-header wiring is covered by `cloud-handle.test.ts`.
 */

import { HubClient } from "@cline/hub-client";
import { startTestHub, type TestHub } from "@cline/hub-testkit";
import { afterEach, describe, expect, it } from "vitest";
import {
	TEST_REMOTE_SESSION_ID,
	testCreateSessionInput,
	testGateway,
	waitFor,
} from "../session/__testing__/test-hub-handle";
import type { HubClientFactory } from "../session/cloud-resolver";
import { SessionConnection } from "../session/session-connection";
import { createCloudSessionHandle } from "./cloud-handle";

let hub: TestHub | undefined;

afterEach(async () => {
	await hub?.close();
	hub = undefined;
});

describe("createCloudSessionHandle against a real hub", () => {
	it("answers a question routed to its original identity after recreating the client", async () => {
		hub = await startTestHub({ script: [{ kind: "text", chunks: ["hi"] }] });
		const authToken = hub.authToken;
		const options = {
			apiBaseUrl: "https://core-api.test",
			getAccessToken: async () => "unused-jwt",
			gateway: testGateway(hub),
			allowInitialCreate: true,
			createSessionInput: testCreateSessionInput(hub),
			clientFactory: (({ url, onConnectionState }) =>
				new HubClient({
					url,
					clientId: "persisted-mobile-workspace-identity",
					authMode: "hub-subprotocol",
					credential: authToken,
					onConnectionState,
				})) satisfies HubClientFactory,
		};
		const first = await createCloudSessionHandle(options);
		const sessionId = await first.ensureSession();
		const owner = first.client.getClientId();
		first.client.close();
		const second = await createCloudSessionHandle({
			...options,
			hubSessionId: sessionId,
		});
		const connection = new SessionConnection({ handle: second });
		try {
			await connection.start();
			const reply = second.client.command(
				"capability.request",
				{
					sessionId,
					targetClientId: owner,
					capabilityName: "tool_executor.askQuestion",
					payload: { args: ["Ready after reopen?", ["Yes", "No"]] },
				},
				sessionId,
			);
			await waitFor(
				() => connection.getView().pendingQuestions.length === 1,
				"resumed question",
			);
			await connection.respondQuestion(
				connection.getView().pendingQuestions[0].requestId,
				"Yes",
			);
			expect((await reply).payload).toEqual({ result: "Yes" });
		} finally {
			connection.dispose();
		}
	});
	it("resolves the newest remote session and drives an inner session", async () => {
		hub = await startTestHub({ script: [{ kind: "text", chunks: ["hi"] }] });
		const gateway = testGateway(hub);

		const handle = await createCloudSessionHandle({
			apiBaseUrl: "https://core-api.test",
			getAccessToken: async () => "unused-jwt",
			gateway,
			allowInitialCreate: true,
			// A fresh sandbox has no inner session yet.
			clientFactory: ({ url, onConnectionState }) =>
				new HubClient({
					url,
					authMode: "hub-subprotocol",
					credential: hub?.authToken ?? "",
					clientType: "cline-mobile",
					displayName: "cline-mobile",
					onConnectionState,
				}),
			createSessionInput: testCreateSessionInput(hub),
		});

		expect(handle.remoteSession.id).toBe(TEST_REMOTE_SESSION_ID);
		expect(handle.client.isConnected()).toBe(true);
		expect(handle.needsCreate).toBe(true);

		const inner = await handle.ensureSession();
		expect(inner).toMatch(/\S/);
		expect(handle.needsCreate).toBe(false);
		handle.client.close();
	});
});
