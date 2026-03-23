import { describe, expect, it } from "vitest";
import type { Message } from "../types/messages";
import {
	convertToAnthropicMessages,
	convertToGeminiMessages,
	convertToOpenAIMessages,
	convertToolsToAnthropic,
	convertToolsToGemini,
	convertToolsToOpenAI,
	convertToR1Messages,
} from "./index";

describe("format conversion", () => {
	it("converts file content blocks to text for user and tool_result payloads", () => {
		const fileText =
			'<file_content path="/repo/README.md">\nhello from file\n</file_content>';
		const messages: Message[] = [
			{
				role: "user",
				content: [
					{ type: "file", path: "/repo/README.md", content: "hello from file" },
				],
			},
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "call_1",
						name: "read_file",
						input: { path: "/repo/README.md" },
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
								path: "/repo/README.md",
								content: "hello from file",
							},
						],
					},
				],
			},
		];

		const openai = convertToOpenAIMessages(messages) as any[];
		expect(openai[0]).toMatchObject({ role: "user", content: fileText });
		expect(openai[2]).toMatchObject({ role: "tool", content: fileText });

		const gemini = convertToGeminiMessages(messages) as any[];
		expect(gemini[0]?.parts?.[0]?.text).toBe(fileText);
		expect(gemini[1]?.parts?.[0]?.functionCall?.id).toBe("call_1");
		expect(gemini[2]?.parts?.[0]?.functionResponse?.response?.result).toBe(
			fileText,
		);
		expect(gemini[2]?.parts?.[0]?.functionResponse?.id).toBe("call_1");
		expect(gemini[2]?.parts?.[0]?.functionResponse?.name).toBe("read_file");

		const anthropic = convertToAnthropicMessages(messages) as any[];
		expect(anthropic[0]?.content?.[0]).toMatchObject({
			type: "text",
			text: fileText,
		});
		expect(anthropic[2]?.content?.[0]).toMatchObject({
			type: "tool_result",
			content: [{ type: "text", text: fileText }],
		});

		const r1 = convertToR1Messages(messages) as any[];
		expect(r1[0]).toMatchObject({ role: "user", content: fileText });
		expect(r1[2]).toMatchObject({ role: "tool", content: fileText });
	});

	it("replays gemini thought signatures on text/tool_use/thinking parts", () => {
		const messages: Message[] = [
			{ role: "user", content: "start" },
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "call_1",
						name: "run_commands",
						input: { command: "echo hi" },
						signature: "sig-a",
					},
					{ type: "thinking", thinking: "need to run", signature: "sig-think" },
					{ type: "text", text: "done", signature: "sig-text" },
				],
			},
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "run_commands", content: "ok" },
				],
			},
		];

		const gemini = convertToGeminiMessages(messages);
		const assistant = gemini[1] as any;
		expect(assistant.role).toBe("model");
		expect(assistant.parts[0].functionCall.name).toBe("run_commands");
		expect(assistant.parts[0].functionCall.id).toBe("call_1");
		expect(assistant.parts[0].thoughtSignature).toBe("sig-a");
		expect(assistant.parts[1].thought).toBe(true);
		expect(assistant.parts[1].thoughtSignature).toBe("sig-think");
		expect(assistant.parts[2].text).toBe("done");
		expect(assistant.parts[2].thoughtSignature).toBe("sig-text");
	});

	it("maps out-of-order gemini tool results by call id", () => {
		const messages: Message[] = [
			{ role: "user", content: "check both" },
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "call_1",
						name: "read_file",
						input: { path: "a.ts" },
					},
					{
						type: "tool_use",
						id: "call_2",
						name: "search_files",
						input: { query: "TODO" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call_2",
						content: '{"matches":1}',
					},
					{
						type: "tool_result",
						tool_use_id: "call_1",
						content: '{"text":"ok"}',
					},
				],
			},
		];

		const gemini = convertToGeminiMessages(messages) as any[];
		expect(gemini[2]?.parts?.[0]?.functionResponse).toMatchObject({
			id: "call_2",
			name: "search_files",
			response: { result: { matches: 1 } },
		});
		expect(gemini[2]?.parts?.[1]?.functionResponse).toMatchObject({
			id: "call_1",
			name: "read_file",
			response: { result: { text: "ok" } },
		});
	});

	it("converts multiple tool_result blocks for openai without dropping any", () => {
		const messages: Message[] = [
			{ role: "user", content: "check both" },
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "call_1",
						name: "get_weather",
						input: { city: "Paris" },
						signature: "sig1",
					},
					{
						type: "tool_use",
						id: "call_2",
						name: "get_weather",
						input: { city: "London" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call_1",
						content: '{"temp":"15C"}',
					},
					{
						type: "tool_result",
						tool_use_id: "call_2",
						content: '{"temp":"12C"}',
					},
					{ type: "text", text: "summarize now" },
				],
			},
		];

		const openai = convertToOpenAIMessages(messages) as any[];
		expect(openai).toHaveLength(5);
		expect(openai[1].role).toBe("assistant");
		expect(openai[1].tool_calls).toHaveLength(2);
		expect(openai[1].tool_calls[0].function.name).toBe("get_weather");
		expect(openai[2]).toMatchObject({ role: "tool", tool_call_id: "call_1" });
		expect(openai[3]).toMatchObject({ role: "tool", tool_call_id: "call_2" });
		expect(openai[4]).toMatchObject({ role: "user", content: "summarize now" });
		// Ensure Gemini-specific signature metadata does not leak into OpenAI messages.
		expect(openai[1].tool_calls[0].extra_content).toBeUndefined();
	});

	it("applies OpenAI cache markers only to the final user message", () => {
		const messages: Message[] = [
			{ role: "user", content: "first prompt" },
			{ role: "assistant", content: "intermediate response" },
			{ role: "user", content: "second prompt" },
		];

		const openai = convertToOpenAIMessages(messages, true) as any[];
		expect(openai[0]).toMatchObject({ role: "user", content: "first prompt" });
		expect(openai[2].role).toBe("user");
		expect(openai[2].content).toMatchObject([
			{
				type: "text",
				text: "second prompt",
				cache_control: { type: "ephemeral" },
			},
		]);

		const cacheMarkerCount = openai
			.flatMap((message) =>
				Array.isArray(message.content) ? message.content : [],
			)
			.filter((part) => part?.cache_control?.type === "ephemeral").length;
		expect(cacheMarkerCount).toBe(1);
	});

	it("normalizes array-shaped tool_use input for openai replay", () => {
		const messages: Message[] = [
			{ role: "user", content: "run these" },
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
		];

		const openai = convertToOpenAIMessages(messages) as any[];
		expect(openai[1]?.tool_calls?.[0]).toMatchObject({
			id: "call_1",
			type: "function",
			function: {
				name: "run_commands",
				arguments: JSON.stringify({ commands: ["ls -la", "pwd"] }),
			},
		});
	});

	it("keeps anthropic thinking signature and cache marker behavior", () => {
		const messages: Message[] = [
			{ role: "user", content: "hello" },
			{
				role: "assistant",
				content: [
					{
						type: "thinking",
						thinking: "reasoning",
						signature: "anthropic-sig",
					},
				],
			},
		];

		const anthropic = convertToAnthropicMessages(messages, true) as any[];
		expect(anthropic[1].content[0].type).toBe("thinking");
		expect(anthropic[1].content[0].signature).toBe("anthropic-sig");
	});

	it("normalizes array-shaped tool_use input for anthropic replay", () => {
		const messages: Message[] = [
			{ role: "user", content: "run these" },
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
		];

		const anthropic = convertToAnthropicMessages(messages) as any[];
		expect(anthropic[1]?.content?.[0]).toMatchObject({
			type: "tool_use",
			id: "call_1",
			name: "run_commands",
			input: {
				commands: ["ls -la", "pwd"],
			},
		});
	});

	it("handles R1 interchange with tool results and reasoning_content", () => {
		const messages: Message[] = [
			{ role: "user", content: "check weather" },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "need both cities" },
					{
						type: "tool_use",
						id: "call_1",
						name: "get_weather",
						input: { city: "Paris" },
					},
					{
						type: "tool_use",
						id: "call_2",
						name: "get_weather",
						input: { city: "London" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call_1",
						content: '{"temp":"15C"}',
					},
					{
						type: "tool_result",
						tool_use_id: "call_2",
						content: '{"temp":"12C"}',
					},
				],
			},
		];

		const r1 = convertToR1Messages(messages) as any[];
		expect(r1[1].role).toBe("assistant");
		expect(r1[1].tool_calls).toHaveLength(2);
		expect(r1[1].reasoning_content).toBe("need both cities");
		expect(r1[2]).toMatchObject({ role: "tool", tool_call_id: "call_1" });
		expect(r1[3]).toMatchObject({ role: "tool", tool_call_id: "call_2" });
	});

	it("converts tools for all providers", () => {
		const tools = [
			{
				name: "read_file",
				description: "Read file",
				inputSchema: {
					type: "object",
					properties: { path: { type: "string" } },
				},
			},
		];

		expect(convertToolsToOpenAI(tools)[0]).toMatchObject({
			type: "function",
			function: { name: "read_file", strict: true },
		});
		expect(convertToolsToOpenAI(tools, { strict: false })[0]).toMatchObject({
			type: "function",
			function: { name: "read_file", strict: false },
		});
		expect(convertToolsToAnthropic(tools)[0]).toMatchObject({
			name: "read_file",
		});
		expect(convertToolsToGemini(tools)[0]).toMatchObject({ name: "read_file" });
	});
});
