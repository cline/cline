import type { GlobalSettings } from "@cline/core";
import { describe, expect, it } from "vitest";
import {
	resolveNonInteractiveMode,
	resolveStartupCompactionMode,
	resolveStartupMode,
	resolveStartupToolAutoApprove,
} from "./startup-settings";

function makeSettings(overrides: Partial<GlobalSettings> = {}): GlobalSettings {
	return {
		autoUpdateEnabled: true,
		telemetryOptOut: false,
		...overrides,
	};
}

describe("resolveStartupMode", () => {
	it("uses the parsed default when nothing is persisted", () => {
		expect(
			resolveStartupMode(
				{ mode: "act", modeExplicitlySet: false },
				makeSettings(),
			),
		).toBe("act");
	});

	it("restores the persisted plan/act mode when no mode flag is provided", () => {
		expect(
			resolveStartupMode(
				{ mode: "act", modeExplicitlySet: false },
				makeSettings({ planActMode: "plan" }),
			),
		).toBe("plan");
	});

	it("prefers an explicit mode flag over the persisted mode", () => {
		expect(
			resolveStartupMode(
				{ mode: "act", modeExplicitlySet: true },
				makeSettings({ planActMode: "plan" }),
			),
		).toBe("act");
		expect(
			resolveStartupMode(
				{ mode: "yolo", modeExplicitlySet: true },
				makeSettings({ planActMode: "plan" }),
			),
		).toBe("yolo");
	});
});

describe("resolveStartupToolAutoApprove", () => {
	it("falls back to the built-in default when nothing is persisted", () => {
		expect(resolveStartupToolAutoApprove({}, makeSettings(), true)).toBe(true);
	});

	it("restores the persisted auto-approve setting", () => {
		expect(
			resolveStartupToolAutoApprove(
				{},
				makeSettings({ toolAutoApprove: false }),
				true,
			),
		).toBe(false);
	});

	it("prefers an explicit --auto-approve flag over the persisted setting", () => {
		expect(
			resolveStartupToolAutoApprove(
				{ autoApproveOverride: true },
				makeSettings({ toolAutoApprove: false }),
				true,
			),
		).toBe(true);
		expect(
			resolveStartupToolAutoApprove(
				{ autoApproveOverride: false },
				makeSettings({ toolAutoApprove: true }),
				true,
			),
		).toBe(false);
	});
});

describe("resolveStartupCompactionMode", () => {
	it("returns undefined so Core's default applies when nothing is persisted", () => {
		expect(resolveStartupCompactionMode({}, makeSettings())).toBeUndefined();
	});

	it("restores the persisted strategy", () => {
		expect(
			resolveStartupCompactionMode(
				{},
				makeSettings({ compactionEnabled: true, compactionStrategy: "basic" }),
			),
		).toBe("basic");
	});

	it("restores the off state even when a strategy is retained on disk", () => {
		expect(
			resolveStartupCompactionMode(
				{},
				makeSettings({ compactionEnabled: false, compactionStrategy: "basic" }),
			),
		).toBe("off");
	});

	it("prefers an explicit --compaction flag over the persisted mode", () => {
		expect(
			resolveStartupCompactionMode(
				{ compactionMode: "agentic" },
				makeSettings({ compactionEnabled: false }),
			),
		).toBe("agentic");
	});
});

describe("resolveNonInteractiveMode", () => {
	const headless = { interactive: false, autoApprove: true };

	it("promotes implicit act to yolo when non-interactive with auto-approve", () => {
		expect(
			resolveNonInteractiveMode({ modeExplicitlySet: false }, "act", headless),
		).toBe("yolo");
	});

	it("keeps act when interactive or auto-approve is off", () => {
		expect(
			resolveNonInteractiveMode({ modeExplicitlySet: false }, "act", {
				interactive: true,
				autoApprove: true,
			}),
		).toBe("act");
		expect(
			resolveNonInteractiveMode({ modeExplicitlySet: false }, "act", {
				interactive: false,
				autoApprove: false,
			}),
		).toBe("act");
	});

	it("respects an explicit mode flag and non-act modes", () => {
		expect(
			resolveNonInteractiveMode({ modeExplicitlySet: true }, "act", headless),
		).toBe("act");
		expect(
			resolveNonInteractiveMode({ modeExplicitlySet: false }, "plan", headless),
		).toBe("plan");
	});
});
