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
});
