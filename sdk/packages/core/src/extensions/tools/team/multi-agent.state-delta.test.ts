import { describe, expect, it, vi } from "vitest";
import { AgentTeamsRuntime } from "./multi-agent";

vi.mock("../../../runtime/orchestration/session-runtime-orchestrator", () => ({
	SessionRuntime: vi.fn(),
}));

function newRuntime() {
	return new AgentTeamsRuntime({ teamName: "delta-team", leadAgentId: "lead" });
}

describe("AgentTeamsRuntime state delta", () => {
	it("starts clean", () => {
		const runtime = newRuntime();
		expect(runtime.hasPendingStateDelta()).toBe(false);
	});

	it("returns only entities changed since the previous drain", () => {
		const runtime = newRuntime();
		const t1 = runtime.createTask({
			title: "one",
			description: "d",
			createdBy: "lead",
		});
		runtime.appendMissionLog({
			agentId: "lead",
			kind: "progress",
			summary: "s",
		});
		const first = runtime.drainStateDelta();
		expect(first.reset).toBe(false);
		expect(first.tasks.map((t) => t.id)).toEqual([t1.id]);
		expect(first.missionLog).toHaveLength(1);
		expect(runtime.hasPendingStateDelta()).toBe(false);

		const t2 = runtime.createTask({
			title: "two",
			description: "d",
			createdBy: "lead",
		});
		const second = runtime.drainStateDelta();
		expect(second.tasks.map((t) => t.id)).toEqual([t2.id]);
		expect(second.missionLog).toHaveLength(0);
	});

	it("tracks mailbox read receipts", () => {
		const runtime = newRuntime();
		runtime.sendMessage("lead", "lead", "subj", "body");
		runtime.drainStateDelta();
		runtime.listMailbox("lead", { unreadOnly: true, markRead: true });
		const delta = runtime.drainStateDelta();
		expect(delta.mailbox).toHaveLength(1);
		expect(delta.mailbox[0]?.readAt).toBeInstanceOf(Date);
	});

	it("notifies onStateDirty for eventless changes", () => {
		const onStateDirty = vi.fn();
		const runtime = new AgentTeamsRuntime({
			teamName: "delta-team",
			leadAgentId: "lead",
			onStateDirty,
		});
		runtime.sendMessage("lead", "lead", "subj", "body");
		runtime.listMailbox("lead", { unreadOnly: true, markRead: true });
		expect(onStateDirty).toHaveBeenCalledTimes(1);
		// Already read: nothing changed, no notification.
		runtime.listMailbox("lead", { unreadOnly: false, markRead: true });
		expect(onStateDirty).toHaveBeenCalledTimes(1);
		runtime.cleanup();
		expect(onStateDirty).toHaveBeenCalledTimes(2);
	});

	it("requeues a drained delta for retry", () => {
		const runtime = newRuntime();
		const task = runtime.createTask({
			title: "t",
			description: "d",
			createdBy: "lead",
		});
		const delta = runtime.drainStateDelta();
		expect(runtime.hasPendingStateDelta()).toBe(false);
		runtime.requeueStateDelta(delta);
		expect(runtime.drainStateDelta().tasks.map((t) => t.id)).toEqual([task.id]);
	});

	it("tracks outcome status changes from fragment attach", () => {
		const runtime = newRuntime();
		const outcome = runtime.createOutcome({
			title: "o",
			requiredSections: ["a"],
			createdBy: "lead",
		});
		runtime.drainStateDelta();
		runtime.attachOutcomeFragment({
			outcomeId: outcome.id,
			section: "a",
			sourceAgentId: "lead",
			content: "c",
		});
		const delta = runtime.drainStateDelta();
		expect(delta.outcomeFragments).toHaveLength(1);
		expect(delta.outcomes.map((o) => o.status)).toEqual(["in_review"]);
	});

	it("hydrate starts clean; cleanup requests a reset", () => {
		const runtime = newRuntime();
		runtime.createTask({ title: "t", description: "d", createdBy: "lead" });
		const state = runtime.exportState();

		const restored = newRuntime();
		restored.hydrateState(state);
		expect(restored.hasPendingStateDelta()).toBe(false);

		restored.cleanup();
		const delta = restored.drainStateDelta();
		expect(delta.reset).toBe(true);
		expect(delta.tasks).toHaveLength(0);
	});

	it("compacts legacy full results when hydrating", () => {
		const runtime = newRuntime();
		const state = runtime.exportState();
		state.runs.push({
			id: "run_00001",
			agentId: "x",
			status: "completed",
			message: "m",
			priority: 0,
			retryCount: 0,
			maxRetries: 0,
			startedAt: new Date(),
			result: {
				text: "ok",
				iterations: 1,
				finishReason: "completed",
				durationMs: 1,
				usage: { inputTokens: 1, outputTokens: 1 },
				messages: [{ role: "user", content: "huge" }],
			},
		});
		runtime.hydrateState(state);
		const [run] = runtime.listRuns();
		expect(JSON.stringify(run?.result)).not.toContain("huge");
		expect((run?.result as { text: string }).text).toBe("ok");
	});
});
