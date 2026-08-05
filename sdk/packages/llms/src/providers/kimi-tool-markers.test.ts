import { describe, expect, it } from "vitest";
import {
	KIMI_TOOL_CALL_ARGUMENT_BEGIN,
	KIMI_TOOL_CALL_BEGIN,
	KIMI_TOOL_CALL_END,
	KIMI_TOOL_SECTION_BEGIN,
	KIMI_TOOL_SECTION_END,
	KimiToolMarkerTranslator,
	longestPartialMarkerSuffix,
	parseKimiToolCallBody,
	toolNameFromKimiToolId,
} from "./kimi-tool-markers";

function sectionWithCall(toolId: string, args: string): string {
	return (
		KIMI_TOOL_SECTION_BEGIN +
		KIMI_TOOL_CALL_BEGIN +
		toolId +
		KIMI_TOOL_CALL_ARGUMENT_BEGIN +
		args +
		KIMI_TOOL_CALL_END +
		KIMI_TOOL_SECTION_END
	);
}

function collect(translator: KimiToolMarkerTranslator, chunks: string[]) {
	const events = [];
	for (const chunk of chunks) {
		for (const event of translator.push(chunk)) {
			events.push(event);
		}
	}
	for (const event of translator.flush()) {
		events.push(event);
	}
	return events;
}

describe("kimi-tool-markers helpers", () => {
	it("extracts the function name from a Kimi tool id", () => {
		expect(toolNameFromKimiToolId("functions.read_file:0")).toBe("read_file");
		expect(toolNameFromKimiToolId("functions.list_files:12")).toBe("list_files");
		expect(toolNameFromKimiToolId("read_file:0")).toBe("read_file");
	});

	it("parses a tool-call body into name + arguments", () => {
		const parsed = parseKimiToolCallBody(
			`functions.read_file:0${KIMI_TOOL_CALL_ARGUMENT_BEGIN}{"path":"a.ts"}`,
		);
		expect(parsed).toEqual({
			toolCallId: "functions.read_file:0",
			toolName: "read_file",
			inputText: '{"path":"a.ts"}',
			input: { path: "a.ts" },
		});
	});

	it("holds a partial marker suffix so mid-token chunks do not leak", () => {
		expect(longestPartialMarkerSuffix("hello")).toBe(0);
		expect(longestPartialMarkerSuffix("say <|")).toBe(2);
		expect(longestPartialMarkerSuffix("say <|tool_call_")).toBe(
			"<|tool_call_".length,
		);
	});
});

describe("KimiToolMarkerTranslator", () => {
	it("passes plain text through unchanged", () => {
		const events = collect(new KimiToolMarkerTranslator(), [
			"Hello ",
			"world",
		]);
		const text = events
			.filter((e) => e.type === "text")
			.map((e) => (e.type === "text" ? e.text : ""))
			.join("");
		expect(text).toBe("Hello world");
		expect(events.every((e) => e.type === "text")).toBe(true);
	});

	it("converts a complete marker section into a tool call and drops markers", () => {
		const events = collect(new KimiToolMarkerTranslator(), [
			"Before\n" +
				sectionWithCall("functions.read_file:0", '{"path":"foo.ts"}') +
				"\nAfter",
		]);
		expect(events).toEqual([
			{ type: "text", text: "Before\n" },
			{
				type: "tool-call",
				toolCallId: "functions.read_file:0",
				toolName: "read_file",
				inputText: '{"path":"foo.ts"}',
				input: { path: "foo.ts" },
			},
			{ type: "text", text: "\nAfter" },
		]);
	});

	it("handles markers split across many tiny stream chunks", () => {
		const full = sectionWithCall(
			"functions.list_files:1",
			'{"path":"."}',
		);
		const chunks = full.split("").map((c) => c);
		const events = collect(new KimiToolMarkerTranslator(), chunks);
		expect(events).toEqual([
			{
				type: "tool-call",
				toolCallId: "functions.list_files:1",
				toolName: "list_files",
				inputText: '{"path":"."}',
				input: { path: "." },
			},
		]);
	});

	it("supports multiple tool calls in one section", () => {
		const text =
			KIMI_TOOL_SECTION_BEGIN +
			KIMI_TOOL_CALL_BEGIN +
			"functions.a:0" +
			KIMI_TOOL_CALL_ARGUMENT_BEGIN +
			'{"x":1}' +
			KIMI_TOOL_CALL_END +
			KIMI_TOOL_CALL_BEGIN +
			"functions.b:1" +
			KIMI_TOOL_CALL_ARGUMENT_BEGIN +
			'{"y":2}' +
			KIMI_TOOL_CALL_END +
			KIMI_TOOL_SECTION_END;
		const events = collect(new KimiToolMarkerTranslator(), [text]);
		expect(events.map((e) => (e.type === "tool-call" ? e.toolName : e))).toEqual([
			"a",
			"b",
		]);
	});

	it("does not emit raw marker text when the stream ends mid-section", () => {
		const events = collect(new KimiToolMarkerTranslator(), [
			`${KIMI_TOOL_SECTION_BEGIN}${KIMI_TOOL_CALL_BEGIN}functions.x:0`,
		]);
		expect(events).toEqual([]);
	});
});
