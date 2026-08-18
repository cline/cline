import { describe, expect, it, vi } from "vitest";
import type { SessionPendingPrompt } from "../../types/events";
import { MonitorSteerQueue } from "./monitor-steer-queue";

/** Minimal stand-in for the pending-prompt queue the host owns. */
function createQueue(options?: {
	cooldownMs?: number;
	maxMergedChars?: number;
}) {
	let prompts: SessionPendingPrompt[] = [];
	let nextId = 1;
	let clock = 1_000_000;
	const enqueue = vi.fn((_sessionId: string, entry: { prompt: string }) => {
		prompts.push({
			id: `p${nextId++}`,
			prompt: entry.prompt,
			delivery: "steer",
			attachmentCount: 0,
		});
	});
	const update = vi.fn((input: { promptId: string; prompt: string }) => {
		const found = prompts.find((prompt) => prompt.id === input.promptId);
		if (found) found.prompt = input.prompt;
	});
	const queue = new MonitorSteerQueue(
		{
			list: () => prompts,
			enqueue,
			update,
			now: () => clock,
		},
		options,
	);
	return {
		queue,
		enqueue,
		update,
		get prompts() {
			return prompts;
		},
		/** Simulates the agent consuming everything in the queue. */
		consumeAll: () => {
			prompts = [];
		},
		advance: (ms: number) => {
			clock += ms;
		},
	};
}

describe("MonitorSteerQueue", () => {
	it("enqueues the first report", () => {
		const harness = createQueue();
		harness.queue.deliver("s1", "first");
		expect(harness.enqueue).toHaveBeenCalledTimes(1);
		expect(harness.prompts).toHaveLength(1);
	});

	it("merges into the outstanding prompt instead of stacking more", () => {
		const harness = createQueue();
		harness.queue.deliver("s1", "first");
		harness.queue.deliver("s1", "second");
		harness.queue.deliver("s1", "third");

		// One queue entry no matter how much the watched process printed.
		expect(harness.prompts).toHaveLength(1);
		expect(harness.enqueue).toHaveBeenCalledTimes(1);
		expect(harness.prompts[0]?.prompt).toContain("first");
		expect(harness.prompts[0]?.prompt).toContain("second");
		expect(harness.prompts[0]?.prompt).toContain("third");
	});

	it("does not start another turn during the cooldown", () => {
		const harness = createQueue({ cooldownMs: 5_000 });
		harness.queue.deliver("s1", "first");
		harness.consumeAll();

		// Consumed, so nothing is outstanding — but the cooldown has not expired,
		// so this must buffer rather than enqueue a second turn-starting prompt.
		harness.queue.deliver("s1", "second");
		expect(harness.enqueue).toHaveBeenCalledTimes(1);
		expect(harness.prompts).toHaveLength(0);
	});

	it("delivers buffered output once the cooldown expires", async () => {
		vi.useFakeTimers();
		try {
			const harness = createQueue({ cooldownMs: 100 });
			harness.queue.deliver("s1", "first");
			harness.consumeAll();
			harness.queue.deliver("s1", "second");
			harness.queue.deliver("s1", "third");
			expect(harness.enqueue).toHaveBeenCalledTimes(1);

			harness.advance(100);
			await vi.advanceTimersByTimeAsync(100);

			expect(harness.enqueue).toHaveBeenCalledTimes(2);
			// Nothing buffered is lost — both reports ride the one new prompt.
			const delivered = harness.prompts[0]?.prompt ?? "";
			expect(delivered).toContain("second");
			expect(delivered).toContain("third");
		} finally {
			vi.useRealTimers();
		}
	});

	it("bounds a merged prompt and keeps the newest output", () => {
		const harness = createQueue({ maxMergedChars: 200 });
		harness.queue.deliver("s1", "x".repeat(400));
		harness.queue.deliver("s1", "NEWEST-MARKER");

		const merged = harness.prompts[0]?.prompt ?? "";
		expect(merged.length).toBeLessThanOrEqual(260);
		expect(merged).toContain("NEWEST-MARKER");
		expect(merged).toContain("older monitor output dropped");
	});

	it("keeps sessions independent", () => {
		const harness = createQueue();
		harness.queue.deliver("s1", "one");
		harness.queue.deliver("s2", "two");
		expect(harness.enqueue).toHaveBeenCalledTimes(2);
	});

	it("clears buffered state and timers on forget", async () => {
		vi.useFakeTimers();
		try {
			const harness = createQueue({ cooldownMs: 100 });
			harness.queue.deliver("s1", "first");
			harness.consumeAll();
			harness.queue.deliver("s1", "buffered");

			harness.queue.forget("s1");
			harness.advance(500);
			await vi.advanceTimersByTimeAsync(500);

			// The torn-down session must not get a late prompt.
			expect(harness.enqueue).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});
});
