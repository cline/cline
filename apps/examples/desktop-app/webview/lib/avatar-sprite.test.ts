import { describe, expect, it } from "vitest";
import {
	AVATAR_IDLE_DURATIONS_MS,
	AVATAR_WAVE_DURATIONS_MS,
	avatarFrameBackgroundPosition,
} from "./avatar-sprite";

describe("avatar sprite atlas", () => {
	it("maps atlas cells to background offsets", () => {
		expect(avatarFrameBackgroundPosition(0, 0)).toBe("0px 0px");
		expect(avatarFrameBackgroundPosition(2, 3)).toBe("-576px -416px");
		expect(avatarFrameBackgroundPosition(10, 7)).toBe("-1344px -2080px");
		expect(avatarFrameBackgroundPosition(4, 2, 0.75)).toBe("-288px -624px");
	});

	it("defines the idle and standard four-frame entrance wave", () => {
		expect(AVATAR_IDLE_DURATIONS_MS).toEqual([280, 110, 110, 140, 140, 320]);
		expect(AVATAR_WAVE_DURATIONS_MS).toEqual([140, 140, 140, 280]);
	});

	it("rejects cells outside the v2 atlas", () => {
		expect(() => avatarFrameBackgroundPosition(11, 0)).toThrow(RangeError);
		expect(() => avatarFrameBackgroundPosition(0, 8)).toThrow(RangeError);
		expect(() => avatarFrameBackgroundPosition(0, 0, 0)).toThrow(RangeError);
	});
});
