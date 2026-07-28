import { describe, expect, it } from "vitest";
import {
	applyBankSnapshot,
	applySubModeIntent,
	canMutateWorkspace,
	clearPostureOverride,
	DEFAULT_DRIVE_UI,
	drivePersonaSystemHint,
	fromSharedDriveSubMode,
	syncDrivePostureFromBank,
	toNativeMode,
	toSharedDriveSubMode,
	type DriveUiState,
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

	it("includes partner and bank guidance when Drive is on", () => {
		const hint = drivePersonaSystemHint({
			...DEFAULT_DRIVE_UI,
			active: true,
			subMode: "ask",
			postureOverride: "ask",
			partnerName: "Ada",
		});
		expect(hint).toContain("Ada");
		expect(hint).toContain("ask");
		expect(hint).toContain("plan");
		expect(hint).toContain(".drive/bank");
		expect(hint).toContain("override");
	});
});

describe("bank-derived posture", () => {
	it("derives Agent when open tasks exist", () => {
		const state = applyBankSnapshot(
			{ ...DEFAULT_DRIVE_UI, active: true },
			{
				activePlanId: "p1",
				openTaskIds: ["t1"],
				nowTaskId: "t1",
				nextTaskId: null,
				nowTitle: "One",
				nextTitle: null,
			},
		);
		expect(state.subMode).toBe("agent");
		expect(canMutateWorkspace(state)).toBe(true);
	});

	it("derives Plan when bank is empty", () => {
		const state = syncDrivePostureFromBank({
			...DEFAULT_DRIVE_UI,
			active: true,
			subMode: "agent",
		});
		expect(state.subMode).toBe("plan");
		expect(canMutateWorkspace(state)).toBe(false);
	});

	it("keeps Ask override until explicit clear", () => {
		let state: DriveUiState = {
			...DEFAULT_DRIVE_UI,
			active: true,
			bankSnapshot: {
				activePlanId: "p1",
				openTaskIds: ["t1"],
				nowTaskId: "t1",
				nextTaskId: null,
				nowTitle: "One",
				nextTitle: null,
			},
		};
		state = applySubModeIntent(state, "ask");
		expect(state.subMode).toBe("ask");
		expect(canMutateWorkspace(state)).toBe(false);
		state = applySubModeIntent(state, "agent");
		expect(state.subMode).toBe("ask");
		state = clearPostureOverride(state);
		expect(state.subMode).toBe("agent");
		expect(state.postureOverride).toBeNull();
	});
});
