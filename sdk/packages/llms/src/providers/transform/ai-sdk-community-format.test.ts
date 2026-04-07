import { describe, expect, it } from "vitest";
import type { Message } from "../types/messages";
import { toAiSdkMessages } from "./ai-sdk-community-format";

describe("ai sdk community format conversion", () => {
	it("converts file content to text and serializes tool_result file blocks", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [
					{ type: "file", path: "/repo/readme.md", content: "hello file body" },
				],
			},
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "call_1",
						name: "run_commands",
						input: ["ls -la", "pwd"] as unknown as Record<string, unknown>,
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call_1",
						content: [
							{
								type: "file",
								path: "/repo/readme.md",
								content: "hello file body",
							},
						],
					},
				],
			},
		];

		const converted = toAiSdkMessages("system", messages);
		expect(converted[0]).toMatchObject({ role: "system", content: "system" });
		expect(converted[1]).toMatchObject({
			role: "user",
			content: [
				{
					type: "text",
					text: '<file_content path="/repo/readme.md">\nhello file body\n</file_content>',
				},
			],
		});
		const assistantParts = Array.isArray(converted[2]?.content)
			? converted[2].content
			: [];
		expect(assistantParts[0]).toMatchObject({
			input: { commands: ["ls -la", "pwd"] },
		});
		expect(converted[3]).toMatchObject({
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId: "call_1",
					toolName: "run_commands",
					output: {
						type: "text",
						value:
							'<file_content path="/repo/readme.md">\nhello file body\n</file_content>',
					},
				},
			],
		});
	});

	it("preserves assistant thinking blocks as reasoning parts before tool calls", () => {
		const messages: Message[] = [
			{ role: "user", content: "weather?" },
			{
				role: "assistant",
				content: [
					{
						type: "thinking",
						thinking: "Need weather data before answering.",
					},
					{
						type: "tool_use",
						id: "call_1",
						name: "get_weather",
						input: { city: "Boston" },
					},
				],
			},
		];

		const converted = toAiSdkMessages("system", messages);
		expect(converted[2]).toMatchObject({
			role: "assistant",
			content: [
				{
					type: "reasoning",
					text: "Need weather data before answering.",
				},
				{
					type: "tool-call",
					toolCallId: "call_1",
					toolName: "get_weather",
					input: { city: "Boston" },
				},
			],
		});
	});
});
