import { describe, expect, it, vi } from "vitest";
import { resolveMigrationNoticeKeyAction } from "./notice-dialog";

vi.mock("@opentui-ui/dialog/react", () => ({
	useDialogKeyboard: () => undefined,
}));

describe("resolveMigrationNoticeKeyAction", () => {
	it("opens the subscription page on Enter", () => {
		expect(resolveMigrationNoticeKeyAction("return")).toBe("open");
		expect(resolveMigrationNoticeKeyAction("enter")).toBe("open");
	});

	it("dismisses on Escape", () => {
		expect(resolveMigrationNoticeKeyAction("escape")).toBe("dismiss");
	});

	it("dismisses on any other key so users are never stuck behind the promo", () => {
		for (const keyName of ["q", "x", "space", "tab", "backspace", "up"]) {
			expect(resolveMigrationNoticeKeyAction(keyName)).toBe("dismiss");
		}
	});
});
