import { describe, expect, it } from "vitest";
import { pendingWhatsNew } from "./whats-new";
import { WHATS_NEW_RELEASES } from "./whats-new-content";

describe("pendingWhatsNew", () => {
	const latest = WHATS_NEW_RELEASES[0];

	it("returns the latest catch-up for users who have not seen it", () => {
		expect(pendingWhatsNew(null)).toBe(latest);
		expect(pendingWhatsNew("2020-01-older")).toBe(latest);
	});

	it("returns nothing once the latest catch-up was seen", () => {
		expect(pendingWhatsNew(latest.id)).toBeNull();
	});

	it("keeps catch-up ids unique so seen-tracking cannot collide", () => {
		const ids = WHATS_NEW_RELEASES.map((release) => release.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
