import { describe, expect, it } from "vitest";
import { reasoningFromMetadata, reasoningUpdates } from "./reasoning";
import { readSessionModel } from "./schemas";

describe("reasoning metadata", () => {
	it("reads the server setting and preserves disabled thinking", () => {
		expect(
			readSessionModel({
				sessionId: "s",
				model: "m",
				metadata: { thinking: true, reasoningEffort: "high" },
			})?.reasoning,
		).toBe("high");
		expect(
			reasoningFromMetadata({ thinking: false, reasoningEffort: "high" }),
		).toBe("none");
	});
	it("does not invent a setting for an unknown or custom budget", () => {
		expect(reasoningFromMetadata({})).toBeUndefined();
		expect(
			reasoningFromMetadata({ reasoningEffort: "invalid" }),
		).toBeUndefined();
		expect(
			reasoningFromMetadata({
				reasoningEffort: "high",
				thinkingBudgetTokens: 4096,
			}),
		).toBeUndefined();
	});
	it("clears the previous budget for both explicit effort and None", () => {
		expect(reasoningUpdates("xhigh")).toEqual({
			thinking: true,
			reasoningEffort: "xhigh",
			thinkingBudgetTokens: null,
		});
		expect(reasoningUpdates("none")).toEqual({
			thinking: false,
			reasoningEffort: null,
			thinkingBudgetTokens: null,
		});
	});
});
