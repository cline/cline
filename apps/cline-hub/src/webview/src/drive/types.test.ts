import { describe, expect, it } from "vitest";
import {
	DEFAULT_DRIVE_UI,
	drivePersonaSystemHint,
	fromSharedDriveSubMode,
	toNativeMode,
	toSharedDriveSubMode,
} from "./types";

describe("toNativeMode", () => {
	it("maps Drive sub-modes onto plan|act", () => {
		expect(toNativeMode("plan")).toBe("plan");
		expect(toNativeMode("ask")).toBe("plan");
		expect(toNativeMode("agent")).toBe("act");
		expect(toNativeMode("debug")).toBe("act");
	});
});

describe("toSharedDriveSubMode", () => {
	it("maps agent UI mode to shared act", () => {
		expect(toSharedDriveSubMode("agent")).toBe("act");
		expect(fromSharedDriveSubMode("act")).toBe("agent");
	});
});

describe("drivePersonaSystemHint", () => {
	it("is empty when Drive is off", () => {
		expect(drivePersonaSystemHint(DEFAULT_DRIVE_UI)).toBe("");
	});

	it("includes partner and sub-mode when Drive is on", () => {
		const hint = drivePersonaSystemHint({
			...DEFAULT_DRIVE_UI,
			active: true,
			subMode: "ask",
			partnerName: "Ada",
		});
		expect(hint).toContain("Ada");
		expect(hint).toContain("ask");
		expect(hint).toContain("plan");
	});
});
