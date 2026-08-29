import { describe, expect, it } from "vitest";
import {
	resolveHubUpdateRequiredKeyAction,
	shouldWatchManagedHubBuild,
} from "./hub-update-required-helpers";

describe("hub update required dialog", () => {
	it("updates on Enter", () => {
		expect(resolveHubUpdateRequiredKeyAction({ name: "return" })).toBe(
			"update",
		);
		expect(resolveHubUpdateRequiredKeyAction({ name: "enter" })).toBe("update");
	});

	it("dismisses only on Esc", () => {
		expect(resolveHubUpdateRequiredKeyAction({ name: "escape" })).toBe(
			"dismiss",
		);
	});

	it("ignores stray keystrokes so a mid-task keypress cannot lose the prompt", () => {
		expect(resolveHubUpdateRequiredKeyAction({ name: "a" })).toBe("ignore");
		expect(resolveHubUpdateRequiredKeyAction({ name: "space" })).toBe("ignore");
		expect(resolveHubUpdateRequiredKeyAction({ name: "c", ctrl: true })).toBe(
			"ignore",
		);
	});
});

describe("shouldWatchManagedHubBuild", () => {
	it("watches for hub-attached modes", () => {
		expect(shouldWatchManagedHubBuild({ mode: "act", sandbox: false })).toBe(
			true,
		);
		expect(shouldWatchManagedHubBuild({ mode: "plan", sandbox: false })).toBe(
			true,
		);
	});

	it("skips yolo and sandbox sessions, which force the local backend and never attach to the managed Hub", () => {
		expect(shouldWatchManagedHubBuild({ mode: "yolo", sandbox: false })).toBe(
			false,
		);
		expect(shouldWatchManagedHubBuild({ mode: "act", sandbox: true })).toBe(
			false,
		);
	});
});
