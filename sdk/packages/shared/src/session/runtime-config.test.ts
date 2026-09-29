import { describe, expect, it } from "vitest";
import { resolveNonInteractiveMode } from "./runtime-config";

describe("resolveNonInteractiveMode", () => {
	it("promotes an unset mode to yolo for non-interactive auto-approve", () => {
		expect(
			resolveNonInteractiveMode({ interactive: false, autoApprove: true }),
		).toBe("yolo");
	});

	it("leaves the mode unset when interactive or not auto-approving", () => {
		expect(
			resolveNonInteractiveMode({ interactive: true, autoApprove: true }),
		).toBeUndefined();
		expect(
			resolveNonInteractiveMode({ interactive: false, autoApprove: false }),
		).toBeUndefined();
	});

	it("never overrides an explicit mode", () => {
		for (const mode of ["act", "plan", "zen"] as const) {
			expect(
				resolveNonInteractiveMode({
					mode,
					interactive: false,
					autoApprove: true,
				}),
			).toBe(mode);
		}
	});
});
