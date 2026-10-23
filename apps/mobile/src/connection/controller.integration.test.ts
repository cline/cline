/**
 * End-to-end proof that the connection layer drives a FULL turn against the real
 * hub server. `startTestHub` boots `startHubWebSocketServer` from `@cline/core/hub`
 * (aliased to source in vitest) with a scripted runtime host, and the controller
 * connects to it through its own production path — `createLocalSessionHandle` +
 * `SessionConnection` — with nothing about the transport faked.
 *
 * connect -> sendInput -> streamed reasoning+text+tool appear in `view` ->
 * respondApproval(true) -> run completes; then a reconnect re-hydrates.
 */

import { startTestHub, type TestHub } from "@cline/hub-testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalPolicyStore } from "../state/approval-policy-store";
import { CloudLaunches } from "./cloud-launches";
import {
	createDroppableTransport,
	waitFor,
} from "../session/__testing__/test-hub-handle";
import { SessionConnectionController } from "./controller";

let hub: TestHub | undefined;
const controllers: SessionConnectionController[] = [];

afterEach(async () => {
	for (const controller of controllers.splice(0)) {
		controller.dispose();
	}
	await hub?.close();
	hub = undefined;
});

function makeController(
	testHub: TestHub,
	deps: ConstructorParameters<typeof SessionConnectionController>[1] = {},
): SessionConnectionController {
	const controller = new SessionConnectionController(
		{ mode: "local", url: testHub.url, authToken: testHub.authToken },
		{
			workspaceRoot: testHub.runtimeHost.workspaceRoot,
			// No `approvalPolicy`: every tier asks, so these tests drive approvals
			// manually. The auto-approve case opts in explicitly.
			...deps,
		},
	);
	controllers.push(controller);
	return controller;
}

const RICH_TURN = {
	approvals: "wait-for-respond" as const,
	script: [
		{ kind: "reasoning" as const, chunks: ["Let me ", "look."] },
		{ kind: "text" as const, chunks: ["Checking ", "the project."] },
		{
			kind: "tool" as const,
			name: "bash",
			input: { command: "ls -la" },
			output: "total 0\n",
		},
		{ kind: "usage" as const, inputTokens: 12, outputTokens: 4, cost: 0.02 },
		{ kind: "text" as const, chunks: ["All done."] },
	],
};

describe("SessionConnectionController — a full local turn", () => {
	it("connects, streams reasoning/text/tool, approves, completes", async () => {
		hub = await startTestHub(RICH_TURN);
		const controller = makeController(hub);

		await controller.start();
		expect(controller.getSnapshot().status.phase).toBe("ready");
		expect(controller.getSnapshot().view.connectionStatus).toBe("live");

		const run = controller.sendInput("look at the project");

		await waitFor(
			() => controller.getSnapshot().view.pendingApprovals.length === 1,
			"the approval to arrive",
		);
		const approval = controller.getSnapshot().view.pendingApprovals[0];
		expect(approval?.toolName).toBe("bash");
		expect(approval?.inputJson).toContain("ls -la");

		// Reasoning + text streamed before the approval gate.
		const preBlocks = controller
			.getSnapshot()
			.view.messages.flatMap((message) => message.blocks);
		expect(
			preBlocks.some(
				(block) => block.kind === "reasoning" && block.text === "Let me look.",
			),
		).toBe(true);
		expect(
			preBlocks.some(
				(block) =>
					block.kind === "text" && block.text === "Checking the project.",
			),
		).toBe(true);

		await controller.respondApproval(approval?.approvalId ?? "", true, "ok");
		await run;

		const view = controller.getSnapshot().view;
		expect(view.pendingApprovals).toEqual([]);
		expect(view.runStatus).toBe("completed");
		const blocks = view.messages.at(-1)?.blocks ?? [];
		expect(blocks).toContainEqual({ kind: "text", text: "All done." });
		const toolBlock = view.messages
			.flatMap((message) => message.blocks)
			.find((block) => block.kind === "tool");
		expect(toolBlock).toMatchObject({
			kind: "tool",
			name: "bash",
			state: "completed",
			output: "total 0\n",
		});
		expect(view.usage.turns.at(-1)).toMatchObject({
			inputTokens: 12,
			outputTokens: 4,
			totalCost: 0.02,
		});
	});

	// RICH_TURN's tool is `bash`, i.e. the execute tier — the one the default
	// policy deliberately withholds. Auto-approving it takes an explicit opt-in.
	it("auto-approves an execute-tier tool call when the policy allows it", async () => {
		hub = await startTestHub(RICH_TURN);
		const controller = makeController(hub, {
			approvalPolicy: { read: "auto", write: "auto", execute: "auto" },
		});

		await controller.start();
		// Only sendInput is called — no respondApproval anywhere in this test.
		await controller.sendInput("look at the project");

		await waitFor(
			() => controller.getSnapshot().view.runStatus === "completed",
			"the auto-approved run to complete",
		);
		const view = controller.getSnapshot().view;
		expect(view.pendingApprovals).toEqual([]);
		const toolBlock = view.messages
			.flatMap((message) => message.blocks)
			.find((block) => block.kind === "tool");
		expect(toolBlock).toMatchObject({ name: "bash", state: "completed" });
	});

	it("setApprovalPolicy unblocks a run already waiting on an approval", async () => {
		hub = await startTestHub(RICH_TURN);
		const controller = makeController(hub);
		await controller.start();

		const run = controller.sendInput("look at the project");
		await waitFor(
			() => controller.getSnapshot().view.pendingApprovals.length === 1,
			"the approval to arrive",
		);

		// The user flips the execute tier on in Settings mid-run.
		controller.setApprovalPolicy({
			read: "auto",
			write: "auto",
			execute: "auto",
		});

		await run;
		await waitFor(
			() => controller.getSnapshot().view.runStatus === "completed",
			"the run to complete after the policy change",
		);
		expect(controller.getSnapshot().view.pendingApprovals).toEqual([]);
	});
	it("revokes auto-approval for a retained local session after leaving its screen", async () => {
		hub = await startTestHub(RICH_TURN);
		const policy = new ApprovalPolicyStore();
		await policy.setPolicy({ read: "auto", write: "auto", execute: "auto" });
		let unsubscribe = vi.fn();
		const controller = makeController(hub, {
			approvalPolicy: policy.get(),
			subscribeApprovalPolicy: (listener) => {
				unsubscribe = vi.fn(policy.subscribe(listener));
				return unsubscribe;
			},
		});
		await controller.start();
		await controller.sendInput("First automatic turn");
		const descriptor = {
			mode: "local" as const,
			url: hub.url,
			hubSessionId: controller.getSnapshot().sessionId,
		};
		const retained = new CloudLaunches();
		retained.retain(descriptor, controller);
		retained.acquire(descriptor)!.release();
		await policy.setTier("execute", "ask");
		hub.script(RICH_TURN.script);
		const run = controller.sendInput("Second turn needs consent");
		await waitFor(
			() => controller.getSnapshot().view.pendingApprovals.length === 1,
			"revoked background approval",
		);
		await controller.respondApproval(
			controller.getSnapshot().view.pendingApprovals[0]!.approvalId,
			true,
		);
		await run;
		retained.clear();
		expect(unsubscribe).toHaveBeenCalledOnce();
	});

	it("re-hydrates the persisted transcript on reconnect()", async () => {
		hub = await startTestHub(RICH_TURN);
		const controller = makeController(hub);
		await controller.start();

		const run = controller.sendInput("do it");
		await waitFor(
			() => controller.getSnapshot().view.pendingApprovals.length === 1,
			"the approval",
		);
		const approvalId =
			controller.getSnapshot().view.pendingApprovals[0]?.approvalId ?? "";
		await controller.respondApproval(approvalId, true);
		await run;
		await waitFor(
			() => controller.getSnapshot().view.runStatus === "completed",
			"the run to complete",
		);

		// A manual reconnect resyncs: transient optimistic blocks are replaced by the
		// hub's persisted transcript, which still ends in the final assistant text.
		await controller.reconnect();
		const view = controller.getSnapshot().view;
		expect(view.connectionStatus).toBe("live");
		expect(view.messages.length).toBeGreaterThan(0);
		// The persisted final assistant text is the concatenation of the turn's text
		// chunks; the reconnect must reproduce it rather than the optimistic blocks.
		const lastAssistant = [...view.messages]
			.reverse()
			.find((message) => message.role === "assistant");
		const lastText = lastAssistant?.blocks.find(
			(block) => block.kind === "text",
		);
		expect(lastText?.kind === "text" ? lastText.text : "").toContain(
			"All done.",
		);
	});

	it("creates a fresh inner session when new-session intent is set", async () => {
		hub = await startTestHub({
			script: [{ kind: "text", chunks: ["fresh answer"] }],
		});
		const seed = await hub.connectClient();
		const existingSessionId = await seed.createSession();
		seed.close();

		const controller = makeController(hub, { createNewSession: true });
		await controller.start();
		expect(controller.getSnapshot().view.messages).toEqual([]);
		await controller.sendInput("start fresh");
		await waitFor(
			() => controller.getSnapshot().view.runStatus === "completed",
			"the fresh session to complete",
		);

		const inspector = await hub.connectClient();
		const listed = await inspector.client.command("session.list", {});
		inspector.close();
		const sessionIds = (
			(listed.payload?.sessions as Array<{ sessionId?: string }> | undefined) ??
			[]
		)
			.map((session) => session.sessionId)
			.filter((id): id is string => typeof id === "string");
		expect(sessionIds).toContain(existingSessionId);
		expect(sessionIds).toHaveLength(2);
	});

	it("converges back to live after a real socket drop", async () => {
		hub = await startTestHub({
			script: [{ kind: "text", chunks: ["first answer"] }],
		});
		const controller = makeController(hub);
		await controller.start();

		const run = controller.sendInput("first question");
		await waitFor(
			() => controller.getSnapshot().view.runStatus === "completed",
			"the first run",
		);
		await run;

		// Rebuild against a droppable transport so we can yank the socket.
		controller.dispose();
		const transport = createDroppableTransport();
		const dropController = makeController(hub, {
			WebSocketImpl: transport.ctor,
		});
		await dropController.start();
		expect(dropController.getSnapshot().view.connectionStatus).toBe("live");

		transport.drop();
		await waitFor(
			() =>
				dropController.getSnapshot().view.connectionStatus === "reconnecting",
			"the drop to be observed",
		);
		await waitFor(
			() => dropController.getSnapshot().view.connectionStatus === "live",
			"the resync to finish",
		);
		expect(transport.openedCount()).toBeGreaterThan(1);
		// The persisted transcript survives the reconnect.
		const view = dropController.getSnapshot().view;
		const lastAssistant = [...view.messages]
			.reverse()
			.find((message) => message.role === "assistant");
		expect(lastAssistant?.blocks).toContainEqual({
			kind: "text",
			text: "first answer",
		});
	});

	it("surfaces a connect failure as status.phase === 'error'", async () => {
		hub = await startTestHub(RICH_TURN);
		const controller = new SessionConnectionController({
			mode: "local",
			url: hub.url,
			authToken: "not-the-real-token",
		});
		controllers.push(controller);

		await expect(controller.start()).rejects.toThrow();
		expect(controller.getSnapshot().status.phase).toBe("error");
		expect(controller.getSnapshot().status.error).toBeInstanceOf(Error);
	});
});
