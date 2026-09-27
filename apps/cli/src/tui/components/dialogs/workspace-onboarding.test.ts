import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import {
	formatDisplayPath,
	ONBOARDING_OPTIONS,
	resolveInheritanceKeyAction,
	resolveOnboardingKeyAction,
} from "./workspace-onboarding-helpers";

describe("workspace-onboarding helpers", () => {
	it("has two onboarding options matching RFC 0001", () => {
		expect(ONBOARDING_OPTIONS).toHaveLength(2);
		expect(ONBOARDING_OPTIONS[0].value).toBe("initialize");
		expect(ONBOARDING_OPTIONS[0].label).toContain(
			"1. Initialize Cline workspace",
		);
		expect(ONBOARDING_OPTIONS[0].recommended).toBe(true);

		expect(ONBOARDING_OPTIONS[1].value).toBe("scratch");
		expect(ONBOARDING_OPTIONS[1].label).toContain(
			"2. Run in temporary scratch session",
		);
	});

	it("formats home paths with ~", () => {
		const home = homedir();
		expect(formatDisplayPath(home)).toBe("~");
		expect(formatDisplayPath(`${home}/Dev/my-monorepo`)).toBe(
			"~/Dev/my-monorepo",
		);
		expect(formatDisplayPath("/tmp/other-path")).toBe("/tmp/other-path");
	});

	it("navigates and selects onboarding options with keyboard", () => {
		// Key 1 resolves "initialize"
		expect(resolveOnboardingKeyAction({ name: "1" }, 1)).toEqual({
			action: "resolve",
			value: "initialize",
		});

		// Key 2 resolves "scratch"
		expect(resolveOnboardingKeyAction({ name: "2" }, 0)).toEqual({
			action: "resolve",
			value: "scratch",
		});

		// Enter resolves current selection
		expect(resolveOnboardingKeyAction({ name: "return" }, 0)).toEqual({
			action: "resolve",
			value: "initialize",
		});
		expect(resolveOnboardingKeyAction({ name: "enter" }, 1)).toEqual({
			action: "resolve",
			value: "scratch",
		});

		// Escape resolves "scratch"
		expect(resolveOnboardingKeyAction({ name: "escape" }, 0)).toEqual({
			action: "resolve",
			value: "scratch",
		});

		// Up/down navigates
		expect(resolveOnboardingKeyAction({ name: "down" }, 0)).toEqual({
			action: "navigate",
			selected: 1,
		});
		expect(resolveOnboardingKeyAction({ name: "up" }, 1)).toEqual({
			action: "navigate",
			selected: 0,
		});
	});

	it("resolves inheritance banner keys", () => {
		// Enter/Return/Escape continue with parent
		expect(resolveInheritanceKeyAction({ name: "return" })).toEqual({
			action: "resolve",
			value: "continue",
		});
		expect(resolveInheritanceKeyAction({ name: "escape" })).toEqual({
			action: "resolve",
			value: "continue",
		});

		// 'c' creates local sub-cline
		expect(resolveInheritanceKeyAction({ name: "c" })).toEqual({
			action: "resolve",
			value: "create-sub-cline",
		});
		expect(resolveInheritanceKeyAction({ name: "c", shift: true })).toEqual({
			action: "resolve",
			value: "create-sub-cline",
		});

		// other keys are ignored
		expect(resolveInheritanceKeyAction({ name: "x" })).toEqual({
			action: "ignore",
		});
	});
});
