import { LinearScrollAccel } from "@opentui/core";
import { describe, expect, it } from "vitest";
import {
	createTranscriptScrollAcceleration,
	TRANSCRIPT_SCROLL_ACCELERATION,
} from "./transcript-scroll";

const START_MS = 10_000;
const BURST_TICKS = 8;
const BURST_INTERVAL_MS = 20;
const PAUSE_MS = 1_000;
const DUPLICATE_EVENT_GAP_MS = 4;
const SLOW_NOTCHES = 4;
const SLOW_NOTCH_INTERVAL_MS = 300;

function tickBurst(
	accel: { tick(now: number): number },
	start: number,
	count: number,
	intervalMs: number,
): number[] {
	return Array.from({ length: count }, (_, i) =>
		accel.tick(start + i * intervalMs),
	);
}

describe("transcript scroll acceleration", () => {
	it("keeps a single wheel notch precise", () => {
		const accel = createTranscriptScrollAcceleration();

		expect(accel.tick(START_MS)).toBe(1);
		expect(accel.tick(START_MS + PAUSE_MS)).toBe(1);
		expect(accel.tick(START_MS + 2 * PAUSE_MS)).toBe(1);
	});

	it("speeds up a burst of notches, capped by the configured maximum", () => {
		const multipliers = tickBurst(
			createTranscriptScrollAcceleration(),
			START_MS,
			BURST_TICKS,
			BURST_INTERVAL_MS,
		);

		expect(multipliers[0]).toBe(1);
		for (const multiplier of multipliers.slice(1)) {
			expect(multiplier).toBeGreaterThan(1);
			expect(multiplier).toBeLessThanOrEqual(
				TRANSCRIPT_SCROLL_ACCELERATION.maxMultiplier,
			);
		}
	});

	it("covers more rows in a burst than the linear default did", () => {
		const accelerated = tickBurst(
			createTranscriptScrollAcceleration(),
			START_MS,
			BURST_TICKS,
			BURST_INTERVAL_MS,
		).reduce((total, multiplier) => total + multiplier, 0);
		const linear = tickBurst(
			new LinearScrollAccel(),
			START_MS,
			BURST_TICKS,
			BURST_INTERVAL_MS,
		).reduce((total, multiplier) => total + multiplier, 0);

		expect(linear).toBe(BURST_TICKS);
		expect(accelerated).toBeGreaterThan(2 * linear);
	});

	it("does not treat the event pairs some terminals send per notch as a burst", () => {
		const accel = createTranscriptScrollAcceleration();
		const multipliers = Array.from({ length: SLOW_NOTCHES }, (_, notch) => {
			const at = START_MS + notch * SLOW_NOTCH_INTERVAL_MS;
			return [accel.tick(at), accel.tick(at + DUPLICATE_EVENT_GAP_MS)];
		}).flat();

		expect(multipliers).toEqual(Array(2 * SLOW_NOTCHES).fill(1));
	});

	it("returns to single rows after a pause", () => {
		const accel = createTranscriptScrollAcceleration();
		tickBurst(accel, START_MS, BURST_TICKS, BURST_INTERVAL_MS);

		const afterPause = START_MS + BURST_TICKS * BURST_INTERVAL_MS + PAUSE_MS;
		expect(accel.tick(afterPause)).toBe(1);
	});

	it("gives each transcript its own velocity history", () => {
		const first = createTranscriptScrollAcceleration();
		const second = createTranscriptScrollAcceleration();
		tickBurst(first, START_MS, BURST_TICKS, BURST_INTERVAL_MS);

		expect(second.tick(START_MS + BURST_TICKS * BURST_INTERVAL_MS)).toBe(1);
	});
});
