import { factoryStampRequirement } from "@cline/shared/browser";
import { describe, expect, it } from "vitest";
import { HANDS_OFF_PRESET_CONFIG } from "./factory-presets";

describe("built-in Hands-off workflow", () => {
	it("stops each card after $10 and chooses reviewers by impact", () => {
		expect(HANDS_OFF_PRESET_CONFIG).toMatchObject({
			autonomy: "hands_off",
			approval: "automatic",
			reviewMode: "adaptive",
			maxCostUsd: 10,
		});
	});

	it("relies on adaptive review: by-risk review without a recorded impact always waits for the user", () => {
		expect(HANDS_OFF_PRESET_CONFIG.humanStamp).toBeUndefined();
		expect(
			factoryStampRequirement(HANDS_OFF_PRESET_CONFIG, {
				reviewSelection: undefined,
				reviewEscalation: undefined,
			}),
		).toEqual({ required: true, reason: "impact unknown" });
	});
});
