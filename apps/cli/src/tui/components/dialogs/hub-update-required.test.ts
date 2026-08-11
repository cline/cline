import { describe, expect, it } from "vitest";
import { resolveHubUpdateRequiredKeyAction } from "./hub-update-required-helpers";

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
