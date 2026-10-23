import { startTestHub, type TestHub } from "@cline/hub-testkit";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionHandle } from "../session";
import {
	resolveTestHubSession,
	waitFor,
} from "../session/__testing__/test-hub-handle";
import { CloudStartStore } from "../state/cloud-starts";
import { cloudLaunches } from "./cloud-launches";
import type { SessionConnectionControllerDeps } from "./controller";
import { type ConnectionDescriptor, descriptorKey } from "./endpoints";
import {
	useCloudSessionStatuses,
	useUnreadCloudSessions,
} from "./use-cloud-session-statuses";
import {
	type UseSessionConnection,
	useSessionConnection,
} from "./use-session-connection";

const hubs: TestHub[] = [];
(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
async function waitScreen(predicate: () => boolean): Promise<void> {
	await vi.waitFor(
		async () => {
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 10));
			});
			expect(predicate()).toBe(true);
		},
		{ timeout: 15_000 },
	);
}
let root: ReactTestRenderer | undefined;
let visible: UseSessionConnection;
let sidebarStatuses: ReturnType<typeof useCloudSessionStatuses>;
let unreadSessions: ReturnType<typeof useUnreadCloudSessions>;
function Screen({
	descriptor,
	deps,
}: {
	descriptor: ConnectionDescriptor;
	deps: SessionConnectionControllerDeps;
}) {
	visible = useSessionConnection(descriptor, deps);
	sidebarStatuses = useCloudSessionStatuses();
	unreadSessions = useUnreadCloudSessions();
	return null;
}
afterEach(async () => {
	act(() => root?.unmount());
	cloudLaunches.clear();
	for (const hub of hubs.splice(0)) await hub.close();
});

describe("Cloud launch across real Hub connections and screen changes", () => {
	it("updates a previously opened Cloud session while a different Cloud chat is visible", async () => {
		const a = await startTestHub({
			approvals: "wait-for-respond",
			script: [
				{
					kind: "tool",
					name: "bash",
					input: { command: "pwd" },
					output: "/workspace",
				},
				{ kind: "text", chunks: ["Finished background A"] },
			],
		});
		const b = await startTestHub({ script: [{ kind: "text", chunks: ["B"] }] });
		hubs.push(a, b);
		const descriptorA: ConnectionDescriptor = {
			mode: "cloud",
			url: a.url,
			remoteSessionId: "A",
		};
		const descriptorB: ConnectionDescriptor = {
			mode: "cloud",
			url: b.url,
			remoteSessionId: "B",
		};
		const depsA = { createHandle: vi.fn(() => resolveTestHubSession(a)) };
		const depsB = { createHandle: vi.fn(() => resolveTestHubSession(b)) };
		await act(async () => {
			root = create(<Screen descriptor={descriptorA} deps={depsA} />);
		});
		await waitScreen(() => visible.status.phase === "ready");
		act(() => {
			void visible.sendInput("Run A");
		});
		await waitScreen(() => visible.view.pendingApprovals.length === 1);
		const approvalId = visible.view.pendingApprovals[0].approvalId;
		// Keep the actual controller callback, not the hook callback (whose ref follows B).
		const lease = cloudLaunches.acquire(descriptorA)!;
		await act(async () => {
			root?.update(<Screen descriptor={descriptorB} deps={depsB} />);
		});
		await waitScreen(() => visible.status.phase === "ready");
		expect(sidebarStatuses[descriptorKey(descriptorA)]).toBe("running");
		lease.release();
		await act(async () => {
			await lease.controller.respondApproval(approvalId, true);
		});
		await waitScreen(
			() => sidebarStatuses[descriptorKey(descriptorA)] === "completed",
		);
		expect(unreadSessions.has(descriptorKey(descriptorA))).toBe(true);
		expect(unreadSessions.has(descriptorKey(descriptorB))).toBe(false);
		expect(visible.view.runStatus).toBe("idle");
		expect(visible.view.messages).toHaveLength(0);
		await act(async () => {
			root?.update(<Screen descriptor={descriptorA} deps={depsA} />);
		});
		await waitScreen(() => visible.view.runStatus === "completed");
		expect(unreadSessions.has(descriptorKey(descriptorA))).toBe(false);
		expect(
			visible.view.messages
				.flatMap((message) => message.blocks)
				.some(
					(block) =>
						block.kind === "text" && block.text === "Finished background A",
				),
		).toBe(true);
		expect(depsA.createHandle).toHaveBeenCalledOnce();
		expect(depsB.createHandle).toHaveBeenCalledOnce();
	});
	it("retains a newly created local question under its resolved session key", async () => {
		const hub = await startTestHub({
			script: [{ kind: "text", chunks: ["Ready"] }],
		});
		hubs.push(hub);
		const machine: ConnectionDescriptor = { mode: "local", url: hub.url };
		let handle: SessionHandle | undefined;
		const deps = {
			createNewSession: true,
			createHandle: vi.fn(async () => {
				handle = await resolveTestHubSession(hub);
				return handle;
			}),
		};
		await act(async () => {
			root = create(<Screen descriptor={machine} deps={deps} />);
		});
		await waitScreen(() => visible.status.phase === "ready");
		await act(async () => {
			await visible.sendInput("Start local work");
		});
		if (!handle || !visible.sessionId)
			throw new Error("Expected local session");
		const pinned = { ...machine, hubSessionId: visible.sessionId };
		const key = descriptorKey(pinned);
		const question = handle.client.command(
			"capability.request",
			{
				sessionId: visible.sessionId,
				targetClientId: handle.client.getClientId(),
				capabilityName: "tool_executor.askQuestion",
				payload: { args: ["Continue local work?", ["Yes", "No"]] },
			},
			visible.sessionId,
		);
		await waitScreen(() => visible.view.pendingQuestions.length === 1);
		const requestId = visible.view.pendingQuestions[0].requestId;
		await act(async () => {
			root?.unmount();
		});
		expect(handle.client.isConnected()).toBe(true);
		expect(cloudLaunches.getStatuses()[key]).toBe("completed");
		const reopenedDeps = { createHandle: deps.createHandle };
		await act(async () => {
			root = create(<Screen descriptor={pinned} deps={reopenedDeps} />);
		});
		expect(visible.view.pendingQuestions[0]?.requestId).toBe(requestId);
		await act(async () => {
			await visible.respondQuestion(requestId, "Yes");
		});
		expect((await question).payload).toEqual({ result: "Yes" });
		expect(deps.createHandle).toHaveBeenCalledOnce();
	});

	it("starts A while B is visible, preserves A's question across switches, and sends once", async () => {
		const a = await startTestHub({
			approvals: "wait-for-respond",
			script: [
				{ kind: "text", chunks: ["Working in A"] },
				{
					kind: "tool",
					name: "bash",
					input: { command: "pwd" },
					output: "/workspace",
				},
				{ kind: "text", chunks: ["Finished A"] },
			],
		});
		const b = await startTestHub({
			script: [{ kind: "text", chunks: ["Finished B"] }],
		});
		hubs.push(a, b);
		const descriptorA: ConnectionDescriptor = {
			mode: "cloud",
			url: a.url,
			remoteSessionId: "A",
			pendingInitialMessage: "Run A",
		};
		const descriptorB: ConnectionDescriptor = { mode: "local", url: b.url };
		let handleA: SessionHandle | undefined;
		let sendCount = () => 0;
		const depsA = {
			createHandle: vi.fn(async () => {
				handleA = await resolveTestHubSession(a);
				const commands = vi.spyOn(handleA.client, "command");
				sendCount = () =>
					commands.mock.calls.filter(([name]) => name === "session.send_input")
						.length;
				return handleA;
			}),
		};
		const depsB = { createHandle: () => resolveTestHubSession(b) };
		await act(async () => {
			root = create(<Screen descriptor={descriptorB} deps={depsB} />);
		});
		await waitScreen(() => visible.status.phase === "ready");
		await act(async () => {
			await visible.sendInput("Run B");
		});
		expect(visible.view.runStatus).toBe("completed");

		const jobs = new CloudStartStore();
		let ready = (_value: ConnectionDescriptor) => {};
		jobs.start({
			target: {
				id: "target",
				mode: "cloud",
				label: "repo",
				repoUrl: "https://github.com/cline/cline",
				modelId: "test",
			},
			message: "Run A",
			provision: () =>
				new Promise((resolve) => {
					ready = resolve;
				}),
			launch: (descriptor) =>
				cloudLaunches.start({
					descriptor,
					message: "Run A",
					deps: depsA,
					save: async () => {},
				}),
		});
		await act(async () => {
			ready(descriptorA);
			await waitFor(
				() => jobs.getSnapshot()[0]?.phase === "ready",
				"A starts without visiting A",
			);
		});
		expect(
			visible.view.messages
				.flatMap((m) => m.blocks)
				.some((block) => block.kind === "text" && block.text === "Finished B"),
		).toBe(true);
		const job = jobs.getSnapshot()[0];
		if (job?.phase !== "ready") throw new Error("Expected ready A");
		await act(async () => {
			root?.update(<Screen descriptor={job.descriptor} deps={depsA} />);
		});
		await waitScreen(() => visible.view.pendingApprovals.length === 1);
		if (!handleA) throw new Error("Expected A handle");
		const sessionId = await handleA.ensureSession();
		const question = handleA.client.command(
			"capability.request",
			{
				sessionId,
				targetClientId: handleA.client.getClientId(),
				capabilityName: "tool_executor.askQuestion",
				payload: { args: ["Continue A?", ["Yes", "No"]] },
			},
			sessionId,
		);
		await waitScreen(() => visible.view.pendingQuestions.length === 1);
		const requestId = visible.view.pendingQuestions[0].requestId;
		await act(async () => {
			root?.update(<Screen descriptor={descriptorB} deps={depsB} />);
		});
		expect(handleA.client.isConnected()).toBe(true);
		await act(async () => {
			root?.update(<Screen descriptor={job.descriptor} deps={depsA} />);
		});
		expect(visible.view.pendingQuestions[0]?.requestId).toBe(requestId);
		await act(async () => {
			await visible.respondQuestion(requestId, "Yes");
		});
		expect((await question).payload).toEqual({ result: "Yes" });
		await act(async () => {
			await visible.respondApproval(
				visible.view.pendingApprovals[0].approvalId,
				true,
			);
		});
		await waitScreen(() => visible.view.runStatus === "completed");
		expect(depsA.createHandle).toHaveBeenCalledOnce();
		expect(sendCount()).toBe(1);
	});
});
