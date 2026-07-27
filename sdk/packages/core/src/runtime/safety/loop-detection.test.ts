import { describe, expect, it } from "vitest";
import { type LoopDetectionCall, LoopDetectionTracker } from "./loop-detection";

const createTracker = () =>
	new LoopDetectionTracker({ softThreshold: 2, hardThreshold: 3 });

function call(
	iteration: number,
	name = "poll",
	input: unknown = { command: "status" },
): LoopDetectionCall {
	return { iteration, name, input };
}

function inspect(
	tracker: LoopDetectionTracker,
	iteration: number,
	name?: string,
	input?: unknown,
) {
	return tracker.inspect(call(iteration, name, input)).kind;
}

function completeBatch(
	tracker: LoopDetectionTracker,
	iteration: number,
	outputs: unknown[],
	options: { name?: string; input?: unknown; successful?: boolean } = {},
) {
	const batchCall = call(iteration, options.name, options.input);
	const verdicts = outputs.map(() => tracker.inspect(batchCall).kind);
	for (const output of outputs) {
		tracker.observeOutcome(batchCall, {
			successful: options.successful ?? true,
			output,
		});
	}
	return verdicts;
}

describe("LoopDetectionTracker", () => {
	it("resets the ordinary counter after changed successful output", () => {
		const tracker = createTracker();

		expect(completeBatch(tracker, 1, ["10%"])).toEqual(["ok"]);
		expect(completeBatch(tracker, 2, ["20%"])).toEqual(["soft"]);
		expect(inspect(tracker, 3)).toBe("ok");
	});

	it("escalates unchanged successful output", () => {
		const tracker = createTracker();

		expect(completeBatch(tracker, 1, ["same"])).toEqual(["ok"]);
		expect(completeBatch(tracker, 2, ["same"])).toEqual(["soft"]);
		expect(inspect(tracker, 3)).toBe("hard");
	});

	it("does not treat changing failures as progress", () => {
		const tracker = createTracker();

		expect(
			completeBatch(tracker, 1, ["error 1"], { successful: false }),
		).toEqual(["ok"]);
		expect(
			completeBatch(tracker, 2, ["error 2"], { successful: false }),
		).toEqual(["soft"]);
		expect(inspect(tracker, 3)).toBe("hard");
	});

	it("bounds continually changing output without interpreting it", () => {
		const tracker = createTracker();

		for (let iteration = 1; iteration < 12; iteration++) {
			expect(
				completeBatch(tracker, iteration, [
					{ status: "pending", timestamp: iteration },
				])[0],
			).not.toBe("hard");
		}
		expect(inspect(tracker, 12)).toBe("hard");
	});

	it.each([
		["percentages", (step: number) => `${step}%`],
		["numeric progress fields", (step: number) => ({ progress: step / 100 })],
		["ratios", (step: number) => `${step}/100`],
	] as const)("allows explicit %s beyond the fallback limit", (_name, output) => {
		const tracker = createTracker();

		for (let iteration = 1; iteration <= 15; iteration++) {
			expect(
				completeBatch(tracker, iteration, [output(iteration)])[0],
			).not.toBe("hard");
		}
	});

	it("keeps the absolute limit across interleaved signatures", () => {
		const tracker = createTracker();

		for (let iteration = 1; iteration < 12; iteration++) {
			expect(
				completeBatch(tracker, iteration, [`poll ${iteration}`])[0],
			).not.toBe("hard");
			completeBatch(tracker, iteration, ["other"], { name: "other" });
		}
		expect(inspect(tracker, 12)).toBe("hard");
	});

	it("treats parallel outcomes as one order-independent batch", () => {
		const tracker = createTracker();

		expect(completeBatch(tracker, 1, ["10%", "20%"])).toEqual(["ok", "ok"]);
		expect(completeBatch(tracker, 2, ["20%", "10%"])).toEqual(["soft", "ok"]);
		expect(inspect(tracker, 3)).toBe("hard");
	});

	it("retains progress from every parallel outcome", () => {
		const tracker = createTracker();

		expect(completeBatch(tracker, 1, ["10%", "10%"])).toEqual(["ok", "ok"]);
		expect(completeBatch(tracker, 2, ["20%", "10%"])).toEqual(["soft", "ok"]);
		expect(inspect(tracker, 3)).toBe("ok");
	});

	it("bounds a parallel batch whose calls never finish", () => {
		const tracker = createTracker();

		for (let callIndex = 1; callIndex < 12; callIndex++) {
			expect(inspect(tracker, 1)).not.toBe("hard");
		}
		expect(inspect(tracker, 1)).toBe("hard");
	});

	it("drops unfinished batches between runtime invocations", () => {
		const tracker = createTracker();

		expect(inspect(tracker, 1)).toBe("ok");
		expect(inspect(tracker, 1)).toBe("ok");
		tracker.clearPendingCalls();

		expect(inspect(tracker, 1)).toBe("soft");
	});

	it("uses stable object fingerprints", () => {
		const tracker = createTracker();

		completeBatch(tracker, 1, [{ first: 1, second: 2 }]);
		expect(completeBatch(tracker, 2, [{ second: 2, first: 1 }])).toEqual([
			"soft",
		]);
		expect(inspect(tracker, 3)).toBe("hard");
	});
});
