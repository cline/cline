import { describe, expect, it } from "vitest";
import { formatMessagesForAiSdk } from "./ai-sdk-format";

describe("formatMessagesForAiSdk", () => {
	it("emits tool results as tool-role messages", () => {
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [{ type: "text", text: "hey" }],
			},
			{
				role: "assistant",
				content: [
					{ type: "text", text: "I'll inspect that." },
					{
						type: "tool-call",
						toolCallId: "call_1",
						toolName: "run_commands",
						input: { commands: ["pwd"] },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "run_commands",
						output: { ok: true },
					},
				],
			},
		]);

		expect(messages).toEqual([
			{
				role: "user",
				content: [{ type: "text", text: "hey" }],
			},
			{
				role: "assistant",
				content: [
					{ type: "text", text: "I'll inspect that." },
					{
						type: "tool-call",
						toolCallId: "call_1",
						toolName: "run_commands",
						input: { commands: ["pwd"] },
					},
				],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "run_commands",
						output: { type: "json", value: { ok: true } },
					},
				],
			},
		]);
	});

	it("splits mixed user text and tool results into valid messages", () => {
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [
					{ type: "text", text: "Here is the tool output." },
					{
						type: "tool-result",
						toolCallId: "call_2",
						toolName: "read_file",
						output: "contents",
					},
				],
			},
		]);

		expect(messages).toEqual([
			{
				role: "user",
				content: [{ type: "text", text: "Here is the tool output." }],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_2",
						toolName: "read_file",
						output: { type: "text", value: "contents" },
					},
				],
			},
		]);
	});

	it("preserves providerOptions on reasoning parts", () => {
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "assistant",
				content: [
					{
						type: "reasoning",
						text: "thinking",
						providerOptions: {
							anthropic: {
								signature: "sig_123",
							},
						},
					},
				],
			},
		]);

		expect(messages).toEqual([
			{
				role: "assistant",
				content: [
					{
						type: "reasoning",
						text: "thinking",
						providerOptions: {
							anthropic: {
								signature: "sig_123",
							},
						},
					},
				],
			},
		]);
	});
});
