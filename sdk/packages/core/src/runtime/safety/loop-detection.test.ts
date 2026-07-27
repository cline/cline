import { describe, expect, it } from "vitest";
import { type LoopDetectionCall, LoopDetectionTracker } from "./loop-detection";

const baseCall = { name: "poll", input: { command: "status" } };
const createTracker = () =>
	new LoopDetectionTracker({ softThreshold: 2, hardThreshold: 3 });
const identified = (
	id: string,
	name = baseCall.name,
	input: unknown = baseCall.input,
): LoopDetectionCall => ({ id, name, input });
const inspect = (
	tracker: LoopDetectionTracker,
	call: LoopDetectionCall = baseCall,
) => tracker.inspect(call).kind;
const succeed = (
	tracker: LoopDetectionTracker,
	call: LoopDetectionCall,
	output: unknown,
) => tracker.observeOutcome(call, { successful: true, output });
const cycle = (
	tracker: LoopDetectionTracker,
	output: unknown,
	call: LoopDetectionCall = baseCall,
) => {
	const verdict = inspect(tracker, call);
	succeed(tracker, call, output);
	return verdict;
};
const runBatch = (
	tracker: LoopDetectionTracker,
	prefix: string,
	outputs: unknown[],
) => {
	const calls = outputs.map((_, index) => identified(`${prefix}-${index + 1}`));
	const verdicts = calls.map((call) => inspect(tracker, call));
	calls.forEach((call, index) => {
		succeed(tracker, call, outputs[index]);
	});
	return verdicts;
};

describe("LoopDetectionTracker", () => {
	it("resets repeated-call counting when successful output changes meaningfully", () => {
		const tracker = createTracker();

		expect(cycle(tracker, "10% complete")).toBe("ok");
		expect(cycle(tracker, "20% complete")).toBe("soft");
		expect(inspect(tracker)).toBe("ok");
	});

	it.each([
		{
			name: "timestamps and request IDs",
			first: {
				status: "pending",
				timestamp: "2026-07-25T01:00:00Z",
				elapsedMs: 60_000,
				requestId: "9be5a8dd-7214-4d51-8b04-261e54e62ac2",
				message:
					"status=pending request-id=9be5a8dd-7214-4d51-8b04-261e54e62ac2 elapsed=60s at 2026-07-25T01:00:00Z",
			},
			second: {
				status: "pending",
				timestamp: "2026-07-25T01:00:01Z",
				elapsedMs: 61_000,
				requestId: "6b265eb9-cc65-4577-87e1-03d4328a06d4",
				message:
					"status=pending request-id=6b265eb9-cc65-4577-87e1-03d4328a06d4 elapsed=61s at 2026-07-25T01:00:01Z",
			},
		},
		{
			name: "append-only heartbeat text",
			first: [
				"2026-07-25T01:00:00Z heartbeat",
				"2026-07-25T01:00:01Z heartbeat",
			].join("\n"),
			second: [
				"2026-07-25T01:00:00Z heartbeat",
				"2026-07-25T01:00:01Z heartbeat",
				"2026-07-25T01:00:02Z heartbeat",
			].join("\n"),
		},
		{
			name: "structured log tails",
			first: {
				status: "pending",
				logs: [{ timestamp: "2026-07-25T01:00:00Z", message: "heartbeat" }],
			},
			second: {
				status: "pending",
				logs: [
					{ timestamp: "2026-07-25T01:00:00Z", message: "heartbeat" },
					{ timestamp: "2026-07-25T01:00:01Z", message: "heartbeat 2" },
				],
			},
		},
	])("does not treat volatile $name as progress", ({ first, second }) => {
		const tracker = createTracker();

		expect(cycle(tracker, first)).toBe("ok");
		expect(cycle(tracker, second)).toBe("soft");
		expect(inspect(tracker)).toBe("hard");
	});

	it("still escalates identical successful output", () => {
		const tracker = createTracker();

		expect(cycle(tracker, "still running")).toBe("ok");
		expect(cycle(tracker, "still running")).toBe("soft");
		expect(inspect(tracker)).toBe("hard");
	});

	it.each([
		["unclassified output", (index: number) => `changing output ${index}`],
		[
			"progress-classified output",
			(index: number) => ({ status: `waiting-${index}` }),
		],
	] as const)("enforces an absolute limit across %s", (_name, outputFor) => {
		const tracker = createTracker();

		for (let index = 1; index < 12; index++) {
			expect(cycle(tracker, outputFor(index))).not.toBe("hard");
		}
		expect(inspect(tracker)).toBe("hard");
	});

	it("keeps the absolute limit across interleaved tool signatures", () => {
		const tracker = createTracker();

		for (let index = 1; index < 12; index++) {
			const poll = identified(`poll-${index}`);
			expect(cycle(tracker, { status: `waiting-${index}` }, poll)).not.toBe(
				"hard",
			);
			expect(
				inspect(
					tracker,
					identified(`other-${index}`, "other", { step: index }),
				),
			).toBe("ok");
		}
		expect(inspect(tracker, identified("poll-12"))).toBe("hard");
	});

	it("counts parallel calls as one order-independent batch", () => {
		const tracker = createTracker();

		expect(runBatch(tracker, "a", ["10% complete", "20% complete"])).toEqual([
			"ok",
			"ok",
		]);
		expect(runBatch(tracker, "b", ["20% complete", "10% complete"])).toEqual([
			"soft",
			"ok",
		]);
		expect(inspect(tracker, identified("c-1"))).toBe("hard");
	});

	it("accepts progress from every parallel outcome", () => {
		const tracker = createTracker();

		expect(runBatch(tracker, "a", ["10% complete", "10% complete"])).toEqual([
			"ok",
			"ok",
		]);
		expect(runBatch(tracker, "b", ["20% complete", "20% complete"])).toEqual([
			"soft",
			"ok",
		]);
		expect(inspect(tracker, identified("c-1"))).toBe("ok");
	});

	it("still escalates repeated parallel batches without progress", () => {
		const tracker = createTracker();

		expect(runBatch(tracker, "a", ["same", "same"])).toEqual(["ok", "ok"]);
		expect(runBatch(tracker, "b", ["same", "same"])).toEqual(["soft", "ok"]);
		expect(runBatch(tracker, "c", ["same", "same"])[0]).toBe("hard");
	});

	it("bounds a parallel batch whose calls never finish", () => {
		const tracker = createTracker();

		for (let index = 1; index < 12; index++) {
			expect(inspect(tracker, identified(`pending-${index}`))).not.toBe("hard");
		}
		expect(inspect(tracker, identified("pending-12"))).toBe("hard");
	});

	it("does not let a late outcome reset another tool's counter", () => {
		const tracker = createTracker();
		const firstPoll = identified("poll-1");
		const secondPoll = identified("poll-2");
		const other = identified("other-1", "other");

		expect(cycle(tracker, "10% complete", firstPoll)).toBe("ok");
		expect(inspect(tracker, secondPoll)).toBe("soft");
		expect(cycle(tracker, "unchanged", other)).toBe("ok");
		succeed(tracker, secondPoll, "20% complete");

		expect(inspect(tracker, identified("other-2", "other"))).toBe("soft");
	});

	it("applies a completed outcome after an interleaved call", () => {
		const tracker = createTracker();
		const delayedPoll = identified("poll-1");

		expect(cycle(tracker, "10% complete", identified("baseline"))).toBe("ok");
		expect(inspect(tracker, delayedPoll)).toBe("soft");
		expect(cycle(tracker, "unchanged", identified("other-1", "other"))).toBe(
			"ok",
		);
		succeed(tracker, delayedPoll, "20% complete");

		expect(cycle(tracker, "10% complete", identified("poll-2"))).toBe("ok");
		expect(inspect(tracker, identified("poll-3"))).toBe("ok");
	});

	it("starts a new batch when an older interleaved poll remains pending", () => {
		const tracker = createTracker();

		expect(cycle(tracker, "10% complete", identified("baseline"))).toBe("ok");
		expect(inspect(tracker, identified("stale"))).toBe("soft");
		expect(cycle(tracker, "unchanged", identified("other", "other"))).toBe(
			"ok",
		);
		expect(cycle(tracker, "20% complete", identified("resumed"))).toBe("ok");
		expect(cycle(tracker, "30% complete", identified("next"))).toBe("ok");
		expect(inspect(tracker, identified("after-progress"))).toBe("ok");
	});

	it("ignores an older batch that finishes after a newer outcome", () => {
		const tracker = createTracker();
		const oldPoll = identified("old");

		expect(cycle(tracker, "10% complete", identified("baseline"))).toBe("ok");
		expect(inspect(tracker, oldPoll)).toBe("soft");
		expect(cycle(tracker, "unchanged", identified("other", "other"))).toBe(
			"ok",
		);
		expect(cycle(tracker, "20% complete", identified("new"))).toBe("ok");
		expect(cycle(tracker, "20% complete", identified("repeated"))).toBe("ok");
		succeed(tracker, oldPoll, "30% complete");

		expect(inspect(tracker, identified("after-stale"))).toBe("soft");
	});

	it("retains earlier parallel outcomes across an interleaved call", () => {
		const tracker = createTracker();
		const first = identified("poll-1");
		const second = identified("poll-2");

		expect(cycle(tracker, "10% complete", identified("baseline"))).toBe("ok");
		expect(inspect(tracker, first)).toBe("soft");
		expect(inspect(tracker, identified("other", "other"))).toBe("ok");
		expect(inspect(tracker, second)).toBe("ok");
		succeed(tracker, first, "20% complete");
		succeed(tracker, second, "10% complete");

		expect(cycle(tracker, "10% complete", identified("poll-3"))).toBe("ok");
		expect(inspect(tracker, identified("poll-4"))).toBe("soft");
	});
});
