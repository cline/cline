import { describe, expect, it } from "vitest";
import {
	audioConstraintsForMicDevice,
	clampOutputVolume,
	DEFAULT_DRIVE_HARDWARE_PREFS,
	normalizeDriveHardwarePrefs,
} from "./driveHardwarePrefs";

describe("driveHardwarePrefs", () => {
	it("clamps volume into [0, 1]", () => {
		expect(clampOutputVolume(-0.5)).toBe(0);
		expect(clampOutputVolume(0.4)).toBe(0.4);
		expect(clampOutputVolume(2)).toBe(1);
		expect(clampOutputVolume(Number.NaN)).toBe(
			DEFAULT_DRIVE_HARDWARE_PREFS.outputVolume,
		);
	});

	it("normalizes blank mic ids to the browser default", () => {
		expect(
			normalizeDriveHardwarePrefs({
				micDeviceId: "",
				outputVolume: 1.5,
			}),
		).toEqual({
			micDeviceId: undefined,
			outputVolume: 1,
		});
	});

	it("builds ideal device constraints when a mic is selected", () => {
		expect(audioConstraintsForMicDevice(undefined)).toBe(true);
		expect(audioConstraintsForMicDevice("mic-1")).toEqual({
			deviceId: { ideal: "mic-1" },
		});
	});
});
