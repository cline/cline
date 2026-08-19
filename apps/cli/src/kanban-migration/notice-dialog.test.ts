import { describe, expect, it, vi } from "vitest";
import { resolveMigrationNoticeKeyAction } from "./notice-dialog";

vi.mock("@opentui-ui/dialog/react", () => ({
	useDialogKeyboard: () => undefined,
}));

describe("resolveMigrationNoticeKeyAction", () => {
	it("opens the subscription page on Enter", () => {
		expect(resolveMigrationNoticeKeyAction({ name: "return" })).toBe("open");
		expect(resolveMigrationNoticeKeyAction({ name: "enter" })).toBe("open");
	});

	it("dismisses on Escape", () => {
		expect(resolveMigrationNoticeKeyAction({ name: "escape" })).toBe("dismiss");
	});

	it("dismisses on any other unmodified key so users are never stuck behind the promo", () => {
		for (const name of ["q", "x", "space", "tab", "backspace", "up"]) {
			expect(resolveMigrationNoticeKeyAction({ name })).toBe("dismiss");
		}
	});

	it("ignores modifier-held keys so holding Cmd/Ctrl to click the link never dismisses", () => {
		expect(resolveMigrationNoticeKeyAction({ name: "c", ctrl: true })).toBe(
			"ignore",
		);
		expect(resolveMigrationNoticeKeyAction({ name: "x", meta: true })).toBe(
			"ignore",
		);
		expect(resolveMigrationNoticeKeyAction({ name: "x", super: true })).toBe(
			"ignore",
		);
		// A bare modifier press (empty name) is ignored, not a dismiss.
		expect(resolveMigrationNoticeKeyAction({ name: "" })).toBe("ignore");
	});
});
