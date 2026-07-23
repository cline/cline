import { describe, expect, it } from "vitest";
import { LoopDetectionTracker } from "./loop-detection";

describe("LoopDetectionTracker", () => {
	const call = { name: "poll", input: { command: "status" } };

	it("resets repeated-call counting when successful output changes", () => {
		const tracker = new LoopDetectionTracker({
			softThreshold: 2,
			hardThreshold: 3,
		});

		expect(tracker.inspect(call).kind).toBe("ok");
		tracker.observeSuccessfulOutcome(call, "10% complete");
		expect(tracker.inspect(call).kind).toBe("soft");
		tracker.observeSuccessfulOutcome(call, "20% complete");

		expect(tracker.inspect(call).kind).toBe("ok");
	});

	it("still escalates identical calls with identical successful output", () => {
		const tracker = new LoopDetectionTracker({
			softThreshold: 2,
			hardThreshold: 3,
		});

		expect(tracker.inspect(call).kind).toBe("ok");
		tracker.observeSuccessfulOutcome(call, "still running");
		expect(tracker.inspect(call).kind).toBe("soft");
		tracker.observeSuccessfulOutcome(call, "still running");

		expect(tracker.inspect(call).kind).toBe("hard");
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
		tracker.observeSuccessfulOutcome(firstPoll, "10% complete");
		expect(tracker.inspect(secondPoll).kind).toBe("soft");
		expect(tracker.inspect(otherCall).kind).toBe("ok");

		tracker.observeSuccessfulOutcome(secondPoll, "20% complete");

		expect(tracker.inspect({ ...otherCall, id: "other-2" }).kind).toBe("soft");
	});
});
