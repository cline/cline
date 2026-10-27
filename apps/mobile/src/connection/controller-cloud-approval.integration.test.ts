/** Real Hub protocol tests; the scripted runtime always asks before its tool. */
import { startTestHub, type TestHub } from "@cline/hub-testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	resolveTestHubSession,
	waitFor,
} from "../session/__testing__/test-hub-handle";
import { DEFAULT_APPROVAL_POLICY } from "../session/approval-policy";
import { SessionConnection } from "../session/session-connection";
import { SessionConnectionController } from "./controller";

let hub: TestHub | undefined;
const disposables: { dispose(): void }[] = [];
afterEach(async () => {
	for (const disposable of disposables.splice(0)) disposable.dispose();
	await hub?.close();
	hub = undefined;
	vi.restoreAllMocks();
});

const GATED_TURN = {
	approvals: "wait-for-respond" as const,
	script: [
		{
			kind: "tool" as const,
			name: "bash",
			input: { command: "echo approval-fixture" },
			output: "scripted-only",
		},
	],
};

async function cloudController() {
	const handle = await resolveTestHubSession(hub!);
	const command = vi.spyOn(handle.client, "command");
	const subscribeApprovalPolicy = vi.fn(() => vi.fn());
	const controller = new SessionConnectionController(
		{
			mode: "cloud",
			url: hub!.url,
			hubSessionId: handle.hubSessionId,
			remoteSessionId: handle.remoteSession.id,
		},
		{ approvalPolicy: DEFAULT_APPROVAL_POLICY, subscribeApprovalPolicy },
		handle,
	);
	disposables.push(controller);
	controller.setApprovalPolicy(DEFAULT_APPROVAL_POLICY);
	await controller.start();
	expect(subscribeApprovalPolicy).not.toHaveBeenCalled();
	return { controller, command };
}

describe("Cloud approvals preserve the shared runtime's asks", () => {
	it.each([
		true,
		false,
	])("keeps an existing approval pending through attach, settings and resync until explicit response (%s)", async (approved) => {
		hub = await startTestHub(GATED_TURN);
		const owner = new SessionConnection({
			handle: await resolveTestHubSession(hub),
		});
		disposables.push(owner);
		await owner.start();
		const run = owner.sendInput("Wait for consent");
		await waitFor(
			() => owner.getView().pendingApprovals.length === 1,
			"the owner's approval",
		);
		const approvalId = owner.getView().pendingApprovals[0]!.approvalId;
		const { controller, command } = await cloudController();
		controller.setApprovalPolicy(DEFAULT_APPROVAL_POLICY);
		await controller.reconnect();
		expect(controller.getSnapshot().view.pendingApprovals).toHaveLength(1);
		expect(
			command.mock.calls.filter(([name]) => name === "approval.respond"),
		).toHaveLength(0);

		await controller.respondApproval(approvalId, approved, "explicit choice");
		await run;
		const responses = command.mock.calls.filter(
			([name]) => name === "approval.respond",
		);
		expect(responses).toHaveLength(1);
		expect(responses[0]![1]).toMatchObject({
			approvalId,
			approved,
			reason: "explicit choice",
		});
	});

	it("also asks for tools streamed after mobile starts its own Cloud turn", async () => {
		hub = await startTestHub(GATED_TURN);
		const { controller, command } = await cloudController();
		const run = controller.sendInput("A new Cloud turn");
		await waitFor(
			() => controller.getSnapshot().view.pendingApprovals.length === 1,
			"a live Cloud approval",
		);
		controller.setApprovalPolicy(DEFAULT_APPROVAL_POLICY);
		await controller.reconnect();
		expect(controller.getSnapshot().view.pendingApprovals).toHaveLength(1);
		expect(
			command.mock.calls.filter(([name]) => name === "approval.respond"),
		).toHaveLength(0);
		await controller.respondApproval(
			controller.getSnapshot().view.pendingApprovals[0]!.approvalId,
			true,
		);
		await run;
		await waitFor(
			() => controller.getSnapshot().view.runStatus === "completed",
			"the explicitly approved turn to complete",
		);
	});
});
