/**
 * C3 against the real hub server (`startTestHub`): no fakes below the REST
 * gateway, which is the one layer that does not exist yet.
 */

import { HubClient } from "@cline/hub-client";
import { startTestHub, type TestHub } from "@cline/hub-testkit";
import { afterEach, describe, expect, it } from "vitest";
import {
	resolveTestHubSession,
	TEST_REMOTE_SESSION_ID,
	testGateway,
} from "./__testing__/test-hub-handle";
import {
	ExactSessionNotFoundError,
	RemoteSessionExpiredError,
	RemoteSessionNotFoundError,
	resolveCloudSession,
} from "./cloud-resolver";
import { asRemoteSessionId } from "./ids";
import type { SessionDiagnostic } from "./reducer";

let hub: TestHub | undefined;

afterEach(async () => {
	await hub?.close();
	hub = undefined;
});

describe("resolveCloudSession against a real hub", () => {
	it("resumes the canonical task over real transport and refuses a missing task", async () => {
		hub = await startTestHub();
		const seed = await hub.connectClient();
		const canonical = await seed.createSession();
		await seed.createSession();
		const handle = await resolveTestHubSession(hub, {
			gateway: testGateway(hub, { taskId: canonical }),
		});
		expect(handle.hubSessionId).toBe(canonical);
		expect(handle.needsCreate).toBe(false);
		handle.client.close();
		await expect(
			resolveTestHubSession(hub, {
				gateway: testGateway(hub, { taskId: "tsk-missing" }),
			}),
		).rejects.toBeInstanceOf(ExactSessionNotFoundError);
	});
	it("returns a needsCreate handle for a sandbox with no inner session", async () => {
		hub = await startTestHub({ script: [{ kind: "text", chunks: ["hi"] }] });
		const handle = await resolveTestHubSession(hub);
		expect(handle.needsCreate).toBe(true);
		expect(handle.hubSessionId).toBeUndefined();
		expect(handle.client.isConnected()).toBe(true);

		const sessionId = await handle.ensureSession();
		expect(sessionId).toMatch(/\S/);
		expect(handle.hubSessionId).toBe(sessionId);
		expect(handle.needsCreate).toBe(false);
		handle.client.close();
	});

	it("selects the only existing inner session", async () => {
		hub = await startTestHub();
		const seed = await hub.connectClient();
		const existing = await seed.createSession();

		const handle = await resolveTestHubSession(hub);
		expect(handle.hubSessionId).toBe(existing);
		expect(handle.needsCreate).toBe(false);
		handle.client.close();
	});

	it("breaks a tie between equally-fresh inner sessions deterministically", async () => {
		hub = await startTestHub();
		const seed = await hub.connectClient();
		const ids = [
			await seed.createSession(),
			await seed.createSession(),
			await seed.createSession(),
		];
		// The scripted host stamps every session with the same `updatedAt`, so this
		// exercises the documented tie-break rather than the recency ordering.
		const expected = [...ids].sort()[0];

		const first = await resolveTestHubSession(hub);
		const second = await resolveTestHubSession(hub);
		expect(first.hubSessionId).toBe(expected);
		expect(second.hubSessionId).toBe(expected);
		first.client.close();
		second.client.close();
	});

	it("refuses an expired outer session before opening a socket", async () => {
		hub = await startTestHub();
		const gateway = testGateway(hub, { status: "expired" });
		const error = await resolveTestHubSession(hub, { gateway }).catch(
			(caught: unknown) => caught,
		);
		expect(error).toBeInstanceOf(RemoteSessionExpiredError);
		expect((error as RemoteSessionExpiredError).remoteSessionId).toBe(
			TEST_REMOTE_SESSION_ID,
		);
	});

	it("refuses an outer session whose expiry has passed", async () => {
		hub = await startTestHub();
		const gateway = testGateway(hub, { expiredAt: 1_000 });
		await expect(
			resolveTestHubSession(hub, { gateway, now: () => 2_000 }),
		).rejects.toBeInstanceOf(RemoteSessionExpiredError);
		const handle = await resolveTestHubSession(hub, {
			gateway,
			now: () => 500,
		});
		expect(handle.client.isConnected()).toBe(true);
		handle.client.close();
	});

	it("reports a missing outer session without touching the hub", async () => {
		hub = await startTestHub();
		await expect(
			resolveTestHubSession(hub, {
				remoteSessionId: asRemoteSessionId("rs_nope") as never,
			}),
		).rejects.toBeInstanceOf(RemoteSessionNotFoundError);
	});

	it("negotiates the protocol handshake and sees the approval capability", async () => {
		hub = await startTestHub();
		const diagnostics: SessionDiagnostic[] = [];
		const handle = await resolveTestHubSession(hub, {
			onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
		});
		expect(handle.client.getServerProtocol()?.protocolVersion).toBe("v1");
		expect(handle.client.hasCapability("approval.list_pending")).toBe(true);
		expect(diagnostics).toEqual([]);
		handle.client.close();
	});

	it("does not hardcode an auth mode: a wrong credential fails to connect", async () => {
		hub = await startTestHub();
		await expect(
			resolveCloudSession({
				gateway: testGateway(hub),
				remoteSessionId: TEST_REMOTE_SESSION_ID,
				clientFactory: ({ url }) =>
					new HubClient({
						url,
						authMode: "hub-subprotocol",
						credential: "not-the-token",
						connectTimeoutMs: 3_000,
					}),
			}),
		).rejects.toThrow();
	});
});
