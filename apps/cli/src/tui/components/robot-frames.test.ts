import { describe, expect, it } from "vitest";
import encodedFrames from "./robot-frames.generated.json";

interface EncodedRobotFrames {
	schema: number;
	width: number;
	height: number;
	palette: string[];
	frames: [rows: string[], colorRuns: number[]][];
}

const robotFrames = encodedFrames as EncodedRobotFrames;

describe("robot frames", () => {
	it("preserves the animation contract", () => {
		expect(robotFrames).toMatchObject({
			schema: 1,
			width: 34,
			height: 12,
			palette: ["black", "whiteBright", "gray"],
		});
		expect(robotFrames.frames).toHaveLength(192);
		expect(robotFrames.frames.every(([rows]) => rows.length === 12)).toBe(true);
		expect(
			robotFrames.frames.every(([rows]) =>
				rows.every((row) => row.length === 34),
			),
		).toBe(true);
	});

	it("centers the eyes at rest and moves them at both tracking extremes", () => {
		const rowsAt = (frameIndex: number) => robotFrames.frames[frameIndex]?.[0];

		expect(rowsAt(0)).toEqual(rowsAt(96));
		expect(rowsAt(64)).not.toEqual(rowsAt(96));
		expect(rowsAt(128)).not.toEqual(rowsAt(96));
		expect(rowsAt(191)).toEqual(rowsAt(96));
	});

	it("encodes exactly one palette value per cell", () => {
		for (const [, colorRuns] of robotFrames.frames) {
			let cellCount = 0;
			for (let index = 0; index < colorRuns.length; index += 2) {
				cellCount += colorRuns[index] ?? 0;
				expect(colorRuns[index + 1]).toBeGreaterThanOrEqual(0);
				expect(colorRuns[index + 1]).toBeLessThan(robotFrames.palette.length);
			}
			expect(cellCount).toBe(34 * 12);
		}
	});
});
