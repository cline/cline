import { describe, expect, it } from "vitest";
import { type LoopDetectionCall, LoopDetectionTracker } from "./loop-detection";

describe("LoopDetectionTracker", () => {
	const call = { name: "poll", input: { command: "status" } };
	const observeSuccess = (
		tracker: LoopDetectionTracker,
		inspectedCall: LoopDetectionCall,
		output: unknown,
	) => {
		tracker.observeOutcome(inspectedCall, { successful: true, output });
	};

	it("resets repeated-call counting when successful output changes meaningfully", () => {
		const tracker = new LoopDetectionTracker({
			softThreshold: 2,
			hardThreshold: 3,
		});

		expect(tracker.inspect(call).kind).toBe("ok");
		observeSuccess(tracker, call, "10% complete");
		expect(tracker.inspect(call).kind).toBe("soft");
		observeSuccess(tracker, call, "20% complete");

		expect(tracker.inspect(call).kind).toBe("ok");
	});

	it("ignores volatile timestamps and request IDs when detecting progress", () => {
		const tracker = new LoopDetectionTracker({
			softThreshold: 2,
			hardThreshold: 3,
		});

		expect(tracker.inspect(call).kind).toBe("ok");
		observeSuccess(tracker, call, {
			status: "pending",
			timestamp: "2026-07-25T01:00:00Z",
			startedAt: "2026-07-25T00:59:00Z",
			elapsedMs: 60_000,
			requestId: "9be5a8dd-7214-4d51-8b04-261e54e62ac2",
			message:
				"status=pending request-id=9be5a8dd-7214-4d51-8b04-261e54e62ac2 elapsed=60s at 2026-07-25T01:00:00Z",
		});
		expect(tracker.inspect(call).kind).toBe("soft");
		observeSuccess(tracker, call, {
			status: "pending",
			timestamp: "2026-07-25T01:00:01Z",
			startedAt: "2026-07-25T00:59:00Z",
			elapsedMs: 61_000,
			requestId: "6b265eb9-cc65-4577-87e1-03d4328a06d4",
			message:
				"status=pending request-id=6b265eb9-cc65-4577-87e1-03d4328a06d4 elapsed=61s at 2026-07-25T01:00:01Z",
		});

		expect(tracker.inspect(call).kind).toBe("hard");
	});

	it("ignores append-only heartbeat log tails without semantic progress", () => {
		const tracker = new LoopDetectionTracker({
			softThreshold: 2,
			hardThreshold: 3,
		});

		expect(tracker.inspect(call).kind).toBe("ok");
		observeSuccess(
			tracker,
			call,
			[
				"2026-07-25T01:00:00Z heartbeat",
				"2026-07-25T01:00:01Z heartbeat",
				"2026-07-25T01:00:02Z heartbeat",
			].join("\n"),
		);
		expect(tracker.inspect(call).kind).toBe("soft");
		observeSuccess(
			tracker,
			call,
			[
				"2026-07-25T01:00:00Z heartbeat",
				"2026-07-25T01:00:01Z heartbeat",
				"2026-07-25T01:00:02Z heartbeat",
				"2026-07-25T01:00:03Z heartbeat",
			].join("\n"),
		);

		expect(tracker.inspect(call).kind).toBe("hard");
	});

	it("ignores growth in structured log-tail fields", () => {
		const tracker = new LoopDetectionTracker({
			softThreshold: 2,
			hardThreshold: 3,
		});

		expect(tracker.inspect(call).kind).toBe("ok");
		observeSuccess(tracker, call, {
			status: "pending",
			logs: [{ timestamp: "2026-07-25T01:00:00Z", message: "heartbeat" }],
		});
		expect(tracker.inspect(call).kind).toBe("soft");
		observeSuccess(tracker, call, {
			status: "pending",
			logs: [
				{ timestamp: "2026-07-25T01:00:00Z", message: "heartbeat" },
				{ timestamp: "2026-07-25T01:00:01Z", message: "heartbeat" },
			],
		});

		expect(tracker.inspect(call).kind).toBe("hard");
	});

	it("still escalates identical calls with identical successful output", () => {
		const tracker = new LoopDetectionTracker({
			softThreshold: 2,
			hardThreshold: 3,
		});

		expect(tracker.inspect(call).kind).toBe("ok");
		observeSuccess(tracker, call, "still running");
		expect(tracker.inspect(call).kind).toBe("soft");
		observeSuccess(tracker, call, "still running");

		expect(tracker.inspect(call).kind).toBe("hard");
	});

	it("enforces an absolute limit across repeatedly changing outcomes", () => {
		const tracker = new LoopDetectionTracker({
			softThreshold: 2,
			hardThreshold: 3,
		});

		for (let index = 1; index < 12; index++) {
			expect(tracker.inspect(call).kind).not.toBe("hard");
			observeSuccess(tracker, call, `changing output ${index}`);
		}
		expect(tracker.inspect(call).kind).toBe("hard");
	});

	it("bounds long-running calls even when progress-classified values change", () => {
		const tracker = new LoopDetectionTracker({
			softThreshold: 2,
			hardThreshold: 3,
		});

		for (let index = 1; index < 12; index++) {
			expect(tracker.inspect(call).kind).not.toBe("hard");
			observeSuccess(tracker, call, { status: `waiting-${index}` });
		}
		expect(tracker.inspect(call).kind).toBe("hard");
	});

	it("keeps the absolute limit across interleaved tool signatures", () => {
		const tracker = new LoopDetectionTracker({
			softThreshold: 2,
			hardThreshold: 3,
		});

		for (let index = 1; index < 12; index++) {
			const poll = { ...call, id: `poll-${index}` };
			expect(tracker.inspect(poll).kind).not.toBe("hard");
			observeSuccess(tracker, poll, { status: `waiting-${index}` });
			expect(
				tracker.inspect({
					id: `other-${index}`,
					name: "other",
					input: { step: index },
				}).kind,
			).toBe("ok");
		}

		expect(tracker.inspect({ ...call, id: "poll-12" }).kind).toBe("hard");
	});

	it("counts identical parallel calls as one batch and accepts every outcome", () => {
		const tracker = new LoopDetectionTracker({
			softThreshold: 2,
			hardThreshold: 3,
		});
		const firstBatch = ["a1", "a2", "a3"].map((id) => ({ ...call, id }));
		const secondBatch = ["b1", "b2", "b3"].map((id) => ({ ...call, id }));

		expect(firstBatch.map((entry) => tracker.inspect(entry).kind)).toEqual([
			"ok",
			"ok",
			"ok",
		]);
		for (const entry of firstBatch) {
			observeSuccess(tracker, entry, "10% complete");
		}

		expect(secondBatch.map((entry) => tracker.inspect(entry).kind)).toEqual([
			"soft",
			"ok",
			"ok",
		]);
		observeSuccess(tracker, secondBatch[0], "20% complete");
		observeSuccess(tracker, secondBatch[1], "20% complete");
		observeSuccess(tracker, secondBatch[2], "20% complete");

		expect(tracker.inspect({ ...call, id: "c1" }).kind).toBe("ok");
	});

	it("compares parallel outcomes as an order-independent batch", () => {
		const tracker = new LoopDetectionTracker({
			softThreshold: 2,
			hardThreshold: 3,
		});
		const firstBatch = ["a1", "a2"].map((id) => ({ ...call, id }));
		const secondBatch = ["b1", "b2"].map((id) => ({ ...call, id }));

		expect(firstBatch.map((entry) => tracker.inspect(entry).kind)).toEqual([
			"ok",
			"ok",
		]);
		observeSuccess(tracker, firstBatch[0], "10% complete");
		observeSuccess(tracker, firstBatch[1], "20% complete");

		expect(secondBatch.map((entry) => tracker.inspect(entry).kind)).toEqual([
			"soft",
			"ok",
		]);
		observeSuccess(tracker, secondBatch[0], "20% complete");
		observeSuccess(tracker, secondBatch[1], "10% complete");

		expect(tracker.inspect({ ...call, id: "c1" }).kind).toBe("hard");
	});

	it("still escalates repeated parallel batches without progress", () => {
		const tracker = new LoopDetectionTracker({
			softThreshold: 2,
			hardThreshold: 3,
		});
		const inspectBatch = (prefix: string) => {
			const batch = [1, 2, 3].map((index) => ({
				...call,
				id: `${prefix}${index}`,
			}));
			const verdicts = batch.map((entry) => tracker.inspect(entry).kind);
			for (const entry of batch) {
				observeSuccess(tracker, entry, "still running");
			}
			return verdicts;
		};

		expect(inspectBatch("a")).toEqual(["ok", "ok", "ok"]);
		expect(inspectBatch("b")).toEqual(["soft", "ok", "ok"]);
		expect(inspectBatch("c")[0]).toBe("hard");
	});

	it("bounds an identical parallel batch when earlier calls never finish", () => {
		const tracker = new LoopDetectionTracker({
			softThreshold: 2,
			hardThreshold: 3,
		});

		for (let index = 1; index < 12; index++) {
			expect(
				tracker.inspect({ ...call, id: `pending-${index}` }).kind,
			).not.toBe("hard");
		}
		expect(tracker.inspect({ ...call, id: "pending-12" }).kind).toBe("hard");
	});

	it("does not let a late parallel outcome reset another call's counter", () => {
		const tracker = new LoopDetectionTracker({
			softThreshold: 2,
			hardThreshold: 3,
		});
		const firstPoll = { ...call, id: "poll-1" };
		const secondPoll = { ...call, id: "poll-2" };
		const otherCall = {
			id: "other-1",
			name: "other",
			input: { command: "status" },
		};

		expect(tracker.inspect(firstPoll).kind).toBe("ok");
		observeSuccess(tracker, firstPoll, "10% complete");
		expect(tracker.inspect(secondPoll).kind).toBe("soft");
		expect(tracker.inspect(otherCall).kind).toBe("ok");
		observeSuccess(tracker, otherCall, "still running");

		observeSuccess(tracker, secondPoll, "20% complete");

		expect(tracker.inspect({ ...otherCall, id: "other-2" }).kind).toBe("soft");
	});

	it("applies a completed poll outcome after an interleaved call finishes", () => {
		const tracker = new LoopDetectionTracker({
			softThreshold: 2,
			hardThreshold: 3,
		});
		const baseline = { ...call, id: "baseline" };
		const firstPoll = { ...call, id: "poll-1" };
		const otherCall = {
			id: "other-1",
			name: "other",
			input: { command: "status" },
		};

		expect(tracker.inspect(baseline).kind).toBe("ok");
		observeSuccess(tracker, baseline, "10% complete");
		expect(tracker.inspect(firstPoll).kind).toBe("soft");
		expect(tracker.inspect(otherCall).kind).toBe("ok");
		observeSuccess(tracker, otherCall, "unchanged");
		observeSuccess(tracker, firstPoll, "20% complete");

		const secondPoll = { ...call, id: "poll-2" };
		expect(tracker.inspect(secondPoll).kind).toBe("ok");
		observeSuccess(tracker, secondPoll, "10% complete");
		expect(tracker.inspect({ ...call, id: "poll-3" }).kind).toBe("ok");
	});

	it("starts a fresh batch when an older interleaved poll remains pending", () => {
		const tracker = new LoopDetectionTracker({
			softThreshold: 2,
			hardThreshold: 3,
		});
		const baseline = { ...call, id: "baseline" };
		const stalePoll = { ...call, id: "stale-poll" };
		const otherCall = {
			id: "other-1",
			name: "other",
			input: { command: "status" },
		};

		expect(tracker.inspect(baseline).kind).toBe("ok");
		observeSuccess(tracker, baseline, "10% complete");
		expect(tracker.inspect(stalePoll).kind).toBe("soft");
		expect(tracker.inspect(otherCall).kind).toBe("ok");
		observeSuccess(tracker, otherCall, "unchanged");

		const resumedPoll = { ...call, id: "resumed-poll" };
		expect(tracker.inspect(resumedPoll).kind).toBe("ok");
		observeSuccess(tracker, resumedPoll, "20% complete");

		const nextPoll = { ...call, id: "next-poll" };
		expect(tracker.inspect(nextPoll).kind).toBe("ok");
		observeSuccess(tracker, nextPoll, "30% complete");
		expect(tracker.inspect({ ...call, id: "after-progress" }).kind).toBe("ok");
	});

	it("ignores an older batch that finishes after a newer poll outcome", () => {
		const tracker = new LoopDetectionTracker({
			softThreshold: 2,
			hardThreshold: 3,
		});
		const baseline = { ...call, id: "baseline" };
		const oldPoll = { ...call, id: "old-poll" };
		const otherCall = {
			id: "other-1",
			name: "other",
			input: { command: "status" },
		};

		expect(tracker.inspect(baseline).kind).toBe("ok");
		observeSuccess(tracker, baseline, "10% complete");
		expect(tracker.inspect(oldPoll).kind).toBe("soft");
		expect(tracker.inspect(otherCall).kind).toBe("ok");
		observeSuccess(tracker, otherCall, "unchanged");

		const newPoll = { ...call, id: "new-poll" };
		expect(tracker.inspect(newPoll).kind).toBe("ok");
		observeSuccess(tracker, newPoll, "20% complete");
		const repeatedPoll = { ...call, id: "repeated-poll" };
		expect(tracker.inspect(repeatedPoll).kind).toBe("ok");
		observeSuccess(tracker, repeatedPoll, "20% complete");

		observeSuccess(tracker, oldPoll, "30% complete");

		expect(tracker.inspect({ ...call, id: "after-stale" }).kind).toBe("soft");
	});

	it("keeps earlier identical parallel outcomes across an interleaved call", () => {
		const tracker = new LoopDetectionTracker({
			softThreshold: 2,
			hardThreshold: 3,
		});
		const baseline = { ...call, id: "baseline" };
		const firstPoll = { ...call, id: "poll-1" };
		const secondPoll = { ...call, id: "poll-2" };
		const otherCall = {
			id: "other-1",
			name: "other",
			input: { command: "status" },
		};

		expect(tracker.inspect(baseline).kind).toBe("ok");
		observeSuccess(tracker, baseline, "10% complete");
		expect(tracker.inspect(firstPoll).kind).toBe("soft");
		expect(tracker.inspect(otherCall).kind).toBe("ok");
		expect(tracker.inspect(secondPoll).kind).toBe("ok");

		observeSuccess(tracker, firstPoll, "20% complete");
		observeSuccess(tracker, secondPoll, "10% complete");

		const thirdPoll = { ...call, id: "poll-3" };
		expect(tracker.inspect(thirdPoll).kind).toBe("ok");
		observeSuccess(tracker, thirdPoll, "10% complete");
		expect(tracker.inspect({ ...call, id: "poll-4" }).kind).toBe("soft");
	});
});
