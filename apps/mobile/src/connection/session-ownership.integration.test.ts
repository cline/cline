/**
 * Regression cover for the on-device approval redbox
 * (`HubCommandError: … is not a participant of session … and cannot answer
 * approval …`).
 *
 * Two guarantees are proved against the real hub server:
 *
 *  1. A descriptor drives exactly ONE `HubClient`, so the client that lazily
 *     creates the session (via `sendInput`) is the same one that answers its
 *     approvals — the server's creator-or-participant ACL is then satisfied by
 *     construction.
 *  2. When the hub *does* refuse an answer (a client that never owned the
 *     session), the failure is surfaced as a diagnostic and never escapes as an
 *     unhandled promise rejection — which on device is the redbox.
 */

import type { HubClient } from "@cline/hub-client";
import { startTestHub, type TestHub } from "@cline/hub-testkit";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionDiagnostic, SessionHandle } from "../session";
import {
	resolveTestHubSession,
	waitFor,
} from "../session/__testing__/test-hub-handle";
import {
	SessionConnectionController,
	type SessionConnectionControllerDeps,
} from "./controller";

let hub: TestHub | undefined;
const controllers: SessionConnectionController[] = [];

afterEach(async () => {
	for (const controller of controllers.splice(0)) {
		controller.dispose();
	}
	await hub?.close();
	hub = undefined;
});

/**
 * A controller wired to the test hub through a counting handle factory, so a
 * test can assert how many `HubClient`s a descriptor actually built.
 */
function makeCountingController(
	testHub: TestHub,
	deps: SessionConnectionControllerDeps = {},
): { controller: SessionConnectionController; clients: HubClient[] } {
	const clients: HubClient[] = [];
	const controller = new SessionConnectionController(
		{ mode: "local", url: testHub.url, authToken: testHub.authToken },
		{
			createHandle: async (): Promise<SessionHandle> => {
				const handle = await resolveTestHubSession(testHub);
				clients.push(handle.client);
				return handle;
			},
			// No `approvalPolicy`: every tier asks, so the gated tool below stays
			// pending until this test answers it.
			...deps,
		},
	);
	controllers.push(controller);
	return { controller, clients };
}

const GATED_TOOL_TURN = {
	approvals: "wait-for-respond" as const,
	script: [
		{
			kind: "tool" as const,
			name: "bash",
			input: { command: "ls -la" },
			output: "total 0\n",
		},
		{ kind: "text" as const, chunks: ["done"] },
	],
};

describe("session ownership", () => {
	it("answers the approval through the single client that created the session", async () => {
		hub = await startTestHub(GATED_TOOL_TURN);
		const { controller, clients } = makeCountingController(hub);
		await controller.start();

		const run = controller.sendInput("look at the project");
		await waitFor(
			() => controller.getSnapshot().view.pendingApprovals.length === 1,
			"the approval to arrive",
		);
		const approvalId =
			controller.getSnapshot().view.pendingApprovals[0]?.approvalId ?? "";

		await controller.respondApproval(approvalId, true, "ok");
		await run;

		expect(controller.getSnapshot().view.runStatus).toBe("completed");
		expect(controller.getSnapshot().view.pendingApprovals).toEqual([]);
		// The whole point: one descriptor, one client — the creator answers.
		expect(clients).toHaveLength(1);
		expect(clients[0]?.isConnected()).toBe(true);
	});

	it("surfaces a hub-refused approval as both a diagnostic and a retryable rejection", async () => {
		hub = await startTestHub(GATED_TOOL_TURN);
		const diagnostics: SessionDiagnostic[] = [];
		// This controller connects while the hub is still empty, so it never creates
		// or attaches the session below: it is exactly the stale/wrong client the
		// device bug answered through.
		const { controller } = makeCountingController(hub, {
			onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
		});
		await controller.start();

		// A different client creates the session and drives it to the approval gate.
		const owner = await hub.connectClient();
		const sessionId = await owner.createSession();
		await owner.subscribeReady(sessionId);
		const ownerRun = owner.sendInput(sessionId, "go");
		ownerRun.catch(() => {});

		const requested = await owner.waitForEvent("approval.requested");
		const approvalId = String(
			(requested.payload as { approvalId?: unknown }).approvalId,
		);

		// The approval belongs to a session this controller never created or attached
		// to, so it must never reach this transcript or this approval sheet — the
		// client-side half of the broadcast ACL.
		expect(controller.getSnapshot().view.pendingApprovals).toEqual([]);

		// Answering it anyway (a stale id from a push notification, say) is still
		// refused by the hub. The sheet awaits this method and owns the inline retry
		// surface, so the rejection must reach it as well as the diagnostic channel.
		await expect(
			controller.respondApproval(approvalId, true, "ok"),
		).rejects.toThrow();
		expect(
			diagnostics.some(
				(diagnostic) =>
					diagnostic.type === "command_failed" &&
					diagnostic.command === "approval.respond",
			),
		).toBe(true);
	});
});
