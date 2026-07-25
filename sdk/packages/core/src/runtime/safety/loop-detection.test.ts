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

	it("allows long-running calls that report explicit semantic progress", () => {
		const tracker = new LoopDetectionTracker({
			softThreshold: 2,
			hardThreshold: 3,
		});

		for (let index = 1; index <= 20; index++) {
			expect(tracker.inspect(call).kind).not.toBe("hard");
			observeSuccess(tracker, call, `${index}/20 complete`);
		}
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
});
