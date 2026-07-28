import { describe, expect, it } from "vitest";
import {
	allowWorkspaceMutation,
	clearPostureOverride,
	resolveDriveLoop,
	setPostureOverride,
} from "./driveLoop.js";
import type { BankSnapshot } from "@cline/shared";

const empty: BankSnapshot = {
	activePlanId: null,
	openTaskIds: [],
	nowTaskId: null,
	nextTaskId: null,
	nowTitle: null,
	nextTitle: null,
};

const withTask: BankSnapshot = {
	activePlanId: "p1",
	openTaskIds: ["t1", "t2"],
	nowTaskId: "t1",
	nextTaskId: "t2",
	nowTitle: "One",
	nextTitle: "Two",
};

describe("resolveDriveLoop", () => {
	it("uses Plan when bank is empty", () => {
		const loop = resolveDriveLoop({
			driveActive: true,
			snapshot: empty,
			override: null,
		});
		expect(loop.posture).toBe("plan");
		expect(loop.boundTaskId).toBeNull();
	});

	it("uses Agent bound to now task when open tasks exist", () => {
		const loop = resolveDriveLoop({
			driveActive: true,
			snapshot: withTask,
			override: null,
		});
		expect(loop.posture).toBe("agent");
		expect(loop.boundTaskId).toBe("t1");
	});

	it("honours Ask/Debug overrides", () => {
		expect(
			resolveDriveLoop({
				driveActive: true,
				snapshot: withTask,
				override: "ask",
			}).posture,
		).toBe("ask");
		expect(
			resolveDriveLoop({
				driveActive: true,
				snapshot: withTask,
				override: "debug",
			}).posture,
		).toBe("debug");
	});
});

describe("allowWorkspaceMutation", () => {
	it("refuses Ask and unbound Plan", () => {
		const ask = resolveDriveLoop({
			driveActive: true,
			snapshot: withTask,
			override: "ask",
		});
		expect(allowWorkspaceMutation(ask).allowed).toBe(false);

		const plan = resolveDriveLoop({
			driveActive: true,
			snapshot: empty,
			override: null,
		});
		expect(allowWorkspaceMutation(plan).allowed).toBe(false);
	});

	it("allows Agent with bound task", () => {
		const agent = resolveDriveLoop({
			driveActive: true,
			snapshot: withTask,
			override: null,
		});
		expect(allowWorkspaceMutation(agent)).toEqual({ allowed: true });
	});
});

describe("override helpers", () => {
	it("set and clear are explicit", () => {
		expect(setPostureOverride("ask")).toBe("ask");
		expect(clearPostureOverride()).toBeNull();
	});
});
