import type { AgentResult } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	ComputerUserCoordinator,
	type ComputerUserSessionHost,
} from "./coordinator";

function makeResult(overrides: Partial<AgentResult> = {}): AgentResult {
	return {
		text: "done",
		iterations: 1,
		finishReason: "completed",
		messages: [],
		toolCalls: [],
		usage: { inputTokens: 1, outputTokens: 1 },
		...overrides,
	} as AgentResult;
}

/**
 * Fake host matching the real runTurn contract: a turn send resolves only
 * when the test releases it (so tests can interleave driver commands with an
 * in-flight background run), while a `delivery: "steer"` send enqueues and
 * resolves `undefined` immediately, exactly as the real host does.
 */
function makeControllableHost() {
	const pendingSends: Array<{
		input: { sessionId: string; prompt: string; delivery?: string };
		resolve: (result: AgentResult | undefined) => void;
		reject: (error: Error) => void;
	}> = [];
	const steerSends: Array<{ sessionId: string; prompt: string }> = [];
	const aborts: unknown[] = [];
	const host: ComputerUserSessionHost = {
		start: async () => ({ sessionId: "helper-session" }),
		send: (input) => {
			if (input.delivery === "steer") {
				steerSends.push({ sessionId: input.sessionId, prompt: input.prompt });
				return Promise.resolve(undefined);
			}
			return new Promise((resolve, reject) => {
				pendingSends.push({ input, resolve, reject });
			});
		},
		abort: async (_sessionId, reason) => {
			aborts.push(reason);
		},
		stop: async () => {},
	};
	return { host, pendingSends, steerSends, aborts };
}

function makeCoordinator(host: ComputerUserSessionHost) {
	const driverMessages: Array<{ prompt: string; delivery: string }> = [];
	const coordinator = new ComputerUserCoordinator({
		host,
		helperConfig: { providerId: "anthropic", modelId: "claude-sonnet-4-6" },
		notifyDriver: (input) => driverMessages.push(input),
	});
	return { coordinator, driverMessages };
}

async function settle(): Promise<void> {
	// Microtask hops: promise settlement plus the transition queue.
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

describe("ComputerUserCoordinator", () => {
	it("start returns immediately and completion notifies the driver via steer", async () => {
		const { host, pendingSends } = makeControllableHost();
		const { coordinator, driverMessages } = makeCoordinator(host);

		const { sessionId, runId } = await coordinator.start("check the dashboard");
		expect(sessionId).toBe("helper-session");
		expect(runId).toMatch(/^curun_/);
		expect(coordinator.getState().kind).toBe("running");
		expect(driverMessages).toHaveLength(0);

		coordinator.onHelperFinish({
			result: "Deployment failed on payments health check",
			observations: ["0/3 healthy instances"],
		});
		pendingSends[0]?.resolve(makeResult());
		await settle();

		expect(coordinator.getState().kind).toBe("idle");
		expect(driverMessages).toHaveLength(1);
		expect(driverMessages[0]?.delivery).toBe("steer");
		expect(driverMessages[0]?.prompt).toContain("[COMPUTER USER DONE]");
		expect(driverMessages[0]?.prompt).toContain("payments health check");
		expect(driverMessages[0]?.prompt).toContain("0/3 healthy instances");
	});

	it("status reports the latest note with a poll-time age", async () => {
		let clock = 1_000_000;
		const { host } = makeControllableHost();
		const coordinator = new ComputerUserCoordinator({
			host,
			helperConfig: {},
			notifyDriver: () => {},
			now: () => clock,
		});
		await coordinator.start("task");
		coordinator.onHelperNote({ kind: "progress", text: "signing in" });
		clock += 43_000;

		const status = coordinator.status();
		expect(status.latestNote?.ageSeconds).toBe(43);
		expect(status.summary).toContain('"signing in" 43 seconds ago');
		expect(status.summary).toContain("working");
	});

	it("message steers a running helper without starting a new run", async () => {
		const { host, pendingSends, steerSends } = makeControllableHost();
		const { coordinator } = makeCoordinator(host);
		await coordinator.start("task");
		expect(pendingSends).toHaveLength(1);

		const result = await coordinator.message("look at the error modal");
		expect(result.delivered).toBe("steer");
		// No second turn started; the message was enqueued as a steer.
		expect(pendingSends).toHaveLength(1);
		expect(steerSends).toEqual([
			{ sessionId: "helper-session", prompt: "look at the error modal" },
		]);
		expect(coordinator.getState().kind).toBe("running");
	});

	it("interrupt aborts the run and settles to idle, keeping the session", async () => {
		const { host, pendingSends, aborts } = makeControllableHost();
		const { coordinator, driverMessages } = makeCoordinator(host);
		await coordinator.start("task");

		const { interrupted } = await coordinator.interrupt("changed my mind");
		expect(interrupted).toBe(true);
		expect(aborts).toHaveLength(1);
		expect(coordinator.getState().kind).toBe("cancelling");

		// The aborted run settles (hosts surface aborts as rejections).
		pendingSends[0]?.reject(new Error("aborted"));
		await settle();

		expect(coordinator.getState()).toMatchObject({
			kind: "idle",
			sessionId: "helper-session",
		});
		expect(driverMessages[0]?.prompt).toContain("interrupted");
	});

	it("a question parks the helper at waiting_for_driver and message resumes it", async () => {
		const { host, pendingSends } = makeControllableHost();
		const { coordinator, driverMessages } = makeCoordinator(host);
		await coordinator.start("task");

		coordinator.onHelperQuestion({
			question: "Replace or Merge?",
			context: "The import dialog offers two options.",
			options: ["Replace", "Merge"],
		});
		pendingSends[0]?.resolve(makeResult());
		await settle();

		expect(coordinator.getState().kind).toBe("waiting_for_driver");
		expect(driverMessages[0]?.prompt).toContain("[COMPUTER USER QUESTION]");
		expect(driverMessages[0]?.prompt).toContain("Replace or Merge?");

		const result = await coordinator.message("Choose Merge");
		expect(result.delivered).toBe("new_turn");
		expect(coordinator.getState().kind).toBe("running");
		expect(pendingSends[1]?.input.prompt).toBe("Choose Merge");
	});

	it("ignores a stale settlement from a superseded run", async () => {
		const { host, pendingSends } = makeControllableHost();
		const { coordinator, driverMessages } = makeCoordinator(host);
		await coordinator.start("first task");
		const firstSend = pendingSends[0];

		await coordinator.interrupt("stop");
		firstSend?.reject(new Error("aborted"));
		await settle();
		expect(coordinator.getState().kind).toBe("idle");

		await coordinator.message("second task");
		expect(coordinator.getState().kind).toBe("running");
		const messagesBefore = driverMessages.length;

		// A duplicate/late settlement of the first run must not disturb run 2.
		firstSend?.reject(new Error("aborted again"));
		await settle();
		expect(coordinator.getState().kind).toBe("running");
		expect(driverMessages.length).toBe(messagesBefore);
	});

	it("a failed run reports failure and a follow-up message recovers", async () => {
		const { host, pendingSends } = makeControllableHost();
		const { coordinator, driverMessages } = makeCoordinator(host);
		await coordinator.start("task");

		pendingSends[0]?.reject(new Error("provider exploded"));
		await settle();
		expect(coordinator.getState()).toMatchObject({
			kind: "failed",
			error: "provider exploded",
		});
		expect(driverMessages[0]?.prompt).toContain("[COMPUTER USER FAILED]");

		const result = await coordinator.message("try again");
		expect(result.delivered).toBe("new_turn");
		expect(coordinator.getState().kind).toBe("running");
	});

	it("rejects a second start while a run is active", async () => {
		const { host } = makeControllableHost();
		const { coordinator } = makeCoordinator(host);
		await coordinator.start("task");
		await expect(coordinator.start("another")).rejects.toThrow(/busy/);
	});

	it("dispose aborts active work and refuses further commands", async () => {
		const { host, pendingSends, aborts } = makeControllableHost();
		const { coordinator } = makeCoordinator(host);
		await coordinator.start("task");

		const disposePromise = coordinator.dispose();
		pendingSends[0]?.reject(new Error("aborted"));
		await disposePromise;

		expect(aborts.length).toBeGreaterThan(0);
		expect(coordinator.getState().kind).toBe("disposed");
		await expect(coordinator.start("more")).rejects.toThrow(/disposed/);
		await expect(coordinator.message("hello")).rejects.toThrow(/disposed/);
	});
});
