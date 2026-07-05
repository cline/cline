import { describe, expect, it } from "vitest";
import { createMistakeLimitDecisionResolver } from "./mistakes";

describe("createMistakeLimitDecisionResolver", () => {
	it("stops immediately when auto-approve is enabled", async () => {
		const decide = createMistakeLimitDecisionResolver({
			autoApproveAllRef: { current: true },
			askQuestionRef: { current: null },
		});

		await expect(
			decide({
				iteration: 1,
				consecutiveMistakes: 3,
				maxConsecutiveMistakes: 3,
				reason: "api_error",
			}),
		).resolves.toMatchObject({
			action: "stop",
		});
	});

	it("continues with retry guidance for the default answer", async () => {
		const decide = createMistakeLimitDecisionResolver({
			autoApproveAllRef: { current: false },
			askQuestionRef: { current: null },
		});

		await expect(
			decide({
				iteration: 4,
				consecutiveMistakes: 2,
				maxConsecutiveMistakes: 3,
				reason: "tool_execution_failed",
				details: "bad args",
			}),
		).resolves.toMatchObject({
			action: "continue",
			guidance: expect.stringContaining("retry with a different approach"),
		});
	});

	it("honors an explicit stop answer", async () => {
		const decide = createMistakeLimitDecisionResolver({
			autoApproveAllRef: { current: false },
			askQuestionRef: { current: async () => "Stop this run" },
		});

		await expect(
			decide({
				iteration: 4,
				consecutiveMistakes: 2,
				maxConsecutiveMistakes: 3,
				reason: "invalid_tool_call",
			}),
		).resolves.toMatchObject({
			action: "stop",
		});
	});
});
