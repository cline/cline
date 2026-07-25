import { describe, expect, it } from "vitest";
import {
	DEFAULT_DRIVE_MODE,
	IllegalDriveModeTransitionError,
	transitionDriveMode,
} from "./driveMode";

describe("transitionDriveMode", () => {
	it("activates and deactivates", () => {
		const active = transitionDriveMode(DEFAULT_DRIVE_MODE, {
			type: "activate",
			subMode: "act",
		});
		expect(active).toEqual({ active: true, subMode: "act" });
		expect(
			transitionDriveMode(active, { type: "deactivate" }),
		).toEqual({ active: false, subMode: "act" });
	});

	it("sets sub-mode while active", () => {
		const active = transitionDriveMode(DEFAULT_DRIVE_MODE, {
			type: "activate",
		});
		expect(
			transitionDriveMode(active, {
				type: "setSubMode",
				subMode: "debug",
			}).subMode,
		).toBe("debug");
	});

	it("rejects setSubMode while inactive", () => {
		expect(() =>
			transitionDriveMode(DEFAULT_DRIVE_MODE, {
				type: "setSubMode",
				subMode: "ask",
			}),
		).toThrow(IllegalDriveModeTransitionError);
	});
});
