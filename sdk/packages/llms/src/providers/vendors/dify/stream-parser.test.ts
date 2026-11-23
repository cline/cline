import type { LanguageModelV2CallOptions } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import {
	formatToolsPrompt,
	parseToolCalls,
	ThinkTagParser,
} from "./stream-parser";

// Mock genId for parseToolCalls
const mockGenId = () => "test-id";

// Mock tools for formatToolsPrompt
const mockTools: LanguageModelV2CallOptions["tools"] = [
	{
		type: "function",
		name: "test-tool",
		description: "A test tool",
		inputSchema: {
			type: "object",
			properties: {
				param1: { type: "string" },
				param2: { type: "number" },
				nested: {
					type: "object",
					properties: { inner: { type: "boolean" } },
				},
				array: {
					type: "array",
					items: { type: "string" },
				},
			},
		},
	},
];

describe("ThinkTagParser", () => {
	it("handles plain text", () => {
		const parser = new ThinkTagParser();
		const segments = parser.feed("Hello world");
		expect(segments).toEqual([{ type: "text", content: "Hello world" }]);
	});

	it("starts with whitespace ignored", () => {
		const parser = new ThinkTagParser();
		let segments = parser.feed("   ");
		expect(segments).toEqual([]);
		segments = parser.feed("Hello");
		expect(segments).toEqual([{ type: "text", content: "Hello" }]);
	});

	it("consumes <think> tag and starts reasoning", () => {
		const parser = new ThinkTagParser();
		expect(parser.feed("<think>")).toEqual([]);
		expect(parser.feed("reason")).toEqual([
			{ type: "reasoning", content: "reason" },
		]);
	});

	it("parses complete think block", () => {
		const parser = new ThinkTagParser();
		parser.feed("Text before <think>reasoning here</think> text after");
		expect(parser.getTextWithoutThink()).toBe("Text before  text after");
	});

	it("merges consecutive same-type segments within feed", () => {
		const parser = new ThinkTagParser();
		const segments = parser.feed("text<think>reason</think>more");
		expect(segments).toEqual([
			{ type: "text", content: "text" },
			{ type: "reasoning", content: "reason" },
			{ type: "text", content: "more" },
		]);
	});

	it("treats second think as text after first close", () => {
		const parser = new ThinkTagParser();
		parser.feed("<think>first</think>");
		const segments = parser.feed("<think>second</think>");
		expect(segments[0]).toHaveProperty("type", "text");
		expect(segments[0].content).toContain("<think>");
	});

	it("flush outputs remaining buffer", () => {
		const parser = new ThinkTagParser();
		parser.feed("text <thin");
		expect(parser.flush()).toEqual([{ type: "text", content: "<thin" }]);
	});

	it("reset works", () => {
		const parser = new ThinkTagParser();
		parser.feed("<think>foo");
		parser.reset("new text");
		expect(parser.getTextWithoutThink()).toBe("new text");
	});

	it("getTextWithoutThink removes only first block", () => {
		const parser = new ThinkTagParser();
		parser.reset("<think>first</think> middle <think>second</think>");
		expect(parser.getTextWithoutThink()).toBe("middle <think>second</think>");
	});

	it("getTextWithoutThink handles unclosed think", () => {
		const parser = new ThinkTagParser();
		parser.reset("<think>unclosed");
		expect(parser.getTextWithoutThink()).toBe("");
	});

	it("does not treat <think> inside double-quoted string (e.g. tool args) as think tag", () => {
		const parser = new ThinkTagParser();
		const jsonLike =
			'{"name":"my_tool","arguments":{"prompt":"Use <think> tag in your reply"}}';
		const segments = parser.feed(jsonLike);
		expect(segments.every((s) => s.type === "text")).toBe(true);
		expect(parser.getTextWithoutThink()).toBe(jsonLike);
	});

	it("does not treat </think> inside JSON string as think close", () => {
		const parser = new ThinkTagParser();
		parser.feed('<think>real think</think> text {"note":"</think> here"} more');
		expect(parser.getTextWithoutThink()).toBe(
			'text {"note":"</think> here"} more',
		);
	});
});

describe("parseToolCalls", () => {
	const toolNames = ["test-tool"];

	it("no tools", () => {
		const { toolCalls, cleanText } = parseToolCalls("hello", [], mockGenId);
		expect(toolCalls).toEqual([]);
		expect(cleanText).toBe("hello");
	});

	it("parses valid tool call", () => {
		const text =
			'Response {"name": "test-tool", "arguments": {"param": "value"}}';
		const { toolCalls, cleanText } = parseToolCalls(text, toolNames, mockGenId);
		expect(toolCalls).toHaveLength(1);
		expect(toolCalls[0].name).toBe("test-tool");
		expect(toolCalls[0].input).toBe('{"param":"value"}');
		expect(cleanText).toBe("Response");
	});

	it("ignores JSON inside strings", () => {
		const text = '"{"name": "test-tool"}" normal text';
		const { toolCalls } = parseToolCalls(text, toolNames, mockGenId);
		expect(toolCalls).toEqual([]);
	});

	it("ignores invalid JSON", () => {
		const text = "{ invalid json ";
		const { toolCalls } = parseToolCalls(text, toolNames, mockGenId);
		expect(toolCalls).toEqual([]);
	});

	it("handles escaped quotes", () => {
		const text = '{"name": "test-tool", "arguments": {"param": "val\\"ue"}}';
		const { toolCalls } = parseToolCalls(text, toolNames, mockGenId);
		expect(toolCalls).toHaveLength(1);
	});

	it("multiple tool calls", () => {
		const toolCall1 = JSON.stringify({
			name: "test-tool",
			arguments: { a: 1 },
		});
		const toolCall2 = JSON.stringify({
			name: "test-tool",
			arguments: { b: 2 },
		});
		const text = `Call1 ${toolCall1} Call2 ${toolCall2}`;
		const { toolCalls } = parseToolCalls(text, toolNames, mockGenId);
		expect(toolCalls).toHaveLength(2);
	});

	it("case insensitive tool name", () => {
		const text = JSON.stringify({ name: "TEST-TOOL", arguments: { p: "v" } });
		const { toolCalls } = parseToolCalls(text, ["test-tool"], mockGenId);
		expect(toolCalls).toHaveLength(1);
		expect(toolCalls[0].name).toBe("test-tool");
	});

	it("parses tool call when arguments value contains <think> (simulating ThinkTagParser output)", () => {
		const toolJson =
			'{"name": "test-tool", "arguments": {"prompt": "Use <think> tag"}}';
		const parser = new ThinkTagParser();
		parser.feed(toolJson);
		const textWithoutThink = parser.getTextWithoutThink();
		const { toolCalls } = parseToolCalls(
			textWithoutThink,
			toolNames,
			mockGenId,
		);
		expect(toolCalls).toHaveLength(1);
		expect(toolCalls[0].input).toBe('{"prompt":"Use <think> tag"}');
	});
});

describe("formatToolsPrompt", () => {
	it("no tools", () => {
		const { prompt, toolNames } = formatToolsPrompt([]);
		expect(prompt).toBe("");
		expect(toolNames).toEqual([]);
	});

	it("formats tools with schema", () => {
		const { prompt } = formatToolsPrompt(mockTools);
		expect(prompt).toContain("test-tool: A test tool");
		expect(prompt).toContain(
			'{"name": "test-tool", "arguments": {"param1": "...", "param2": 0, "nested": {"inner": true}',
		);
	});

	it("uses short descriptions from map", () => {
		const toolsWithBash = [
			{
				type: "function",
				name: "bash",
				description: "long desc",
				inputSchema: {},
			},
		] as any;
		const { prompt } = formatToolsPrompt(toolsWithBash);
		expect(prompt).toContain("bash: Execute a bash command");
	});

	it("truncates long descriptions", () => {
		const longDesc =
			"Very long description that should be truncated to 60 chars. ";
		const tools = [
			{
				type: "function",
				name: "tool",
				description: longDesc.repeat(2),
				inputSchema: {},
			},
		] as any;
		const { prompt } = formatToolsPrompt(tools);
		expect(prompt.length).toBeLessThan(200); // Rough check
	});
});
