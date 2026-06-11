import type { Message, ToolResultContent } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { buildMessageSizeReport } from "./message-size-report";

describe("buildMessageSizeReport", () => {
	it("reports the provider payload shrinking after buildForApi", () => {
		const hugeResult = "x".repeat(500_000);
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "call_1",
						name: "run_commands",
						input: { commands: ["cat big.log"] },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call_1",
						name: "run_commands",
						content: [
							{ query: "cat big.log", result: hugeResult, success: true },
						] as unknown as ToolResultContent["content"],
					},
				],
			},
		];

		const report = buildMessageSizeReport(messages);

		expect(report.rawTranscriptBytes).toBeGreaterThan(500_000);
		expect(report.builtTranscriptBytes).toBeLessThan(120_000);
		expect(report.rawProviderPayloadBytes).toBeGreaterThan(500_000);
		expect(report.builtProviderPayloadBytes).toBeLessThan(120_000);
		expect(report.largestToolResultStringBeforeBytes).toBe(500_000);
		expect(report.largestToolResultStringAfterBytes).toBeLessThanOrEqual(
			50_000,
		);
		expect(report.providerPayloadPercentReduction).toBeGreaterThan(75);
	});
});
