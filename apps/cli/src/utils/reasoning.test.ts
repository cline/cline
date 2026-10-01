import { describe, expect, it } from "vitest";
import { resolveCliReasoning } from "./reasoning";

describe("resolveCliReasoning", () => {
	it.each(["minimal", "max"] as const)("restores saved %s effort", (effort) => {
		expect(
			resolveCliReasoning({
				thinking: false,
				persistedReasoning: { enabled: true, effort },
			}),
		).toEqual({ thinking: true, reasoningEffort: effort });
	});
	it("leaves reasoning unset when neither CLI nor persisted settings specify it", () => {
		expect(
			resolveCliReasoning({
				thinking: false,
			}),
		).toEqual({
			thinking: undefined,
			reasoningEffort: undefined,
		});
	});

	it("preserves explicit --thinking none as disabled reasoning", () => {
		expect(
			resolveCliReasoning({
				thinking: false,
				thinkingExplicitlySet: true,
			}),
		).toEqual({
			thinking: false,
			reasoningEffort: undefined,
		});
	});

	it("prefers explicit --thinking over persisted reasoning settings", () => {
		expect(
			resolveCliReasoning({
				thinking: true,
				thinkingExplicitlySet: true,
				reasoningEffort: "low",
				persistedReasoning: { enabled: false },
			}),
		).toEqual({
			thinking: true,
			reasoningEffort: "low",
		});
	});

	it("uses persisted disabled reasoning when --thinking is unset", () => {
		expect(
			resolveCliReasoning({
				thinking: false,
				persistedReasoning: { enabled: false },
			}),
		).toEqual({
			thinking: false,
			reasoningEffort: undefined,
		});
	});

	it("uses persisted effort none as disabled reasoning when --thinking is unset", () => {
		expect(
			resolveCliReasoning({
				thinking: false,
				persistedReasoning: { effort: "none" },
			}),
		).toEqual({
			thinking: false,
			reasoningEffort: undefined,
		});
	});

	it("uses persisted active effort when --thinking is unset", () => {
		expect(
			resolveCliReasoning({
				thinking: false,
				persistedReasoning: { enabled: true, effort: "high" },
			}),
		).toEqual({
			thinking: true,
			reasoningEffort: "high",
		});
	});

	it("preserves enabled reasoning without inventing an effort", () => {
		expect(
			resolveCliReasoning({
				thinking: false,
				persistedReasoning: { enabled: true },
			}),
		).toEqual({
			thinking: true,
			reasoningEffort: undefined,
		});
	});
});
