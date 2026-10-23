import { describe, expect, it } from "vitest";
import {
	formatMessageDay,
	formatMessageRelativeTime,
	startsNewMessageDay,
} from "./time";

describe("chat timestamps", () => {
	const now = new Date(2026, 7, 7, 12).getTime();

	it("formats relative times with Intl", () => {
		expect(formatMessageRelativeTime(now - 30_000, now)).toBe("just now");
		expect(formatMessageRelativeTime(now - 2 * 60_000, now)).toMatch(
			/2 minutes ago/,
		);
	});

	it("inserts separators only when the local calendar day changes", () => {
		expect(formatMessageDay(now, now)).toBe("Today");
		expect(formatMessageDay(now - 24 * 60 * 60_000, now)).toBe("Yesterday");
		expect(startsNewMessageDay(now, now - 60_000)).toBe(false);
		expect(startsNewMessageDay(now, now - 24 * 60 * 60_000)).toBe(true);
	});
});
