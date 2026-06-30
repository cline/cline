import { describe, expect, it } from "vitest";
import { TextDeltaToolCallParser } from "./text-delta-tool-call-parser";

function makeUid(prefix = "tool"): () => string {
	let n = 0;
	return () => `${prefix}_${++n}`;
}

describe("TextDeltaToolCallParser", () => {
	it("passes plain prose straight through as text", () => {
		const parser = new TextDeltaToolCallParser(makeUid());

		const events = parser.consume("I'll read the file and check the contents.");

		expect(events).toEqual([
			{ kind: "text", text: "I'll read the file and check the contents." },
		]);
	});

	it("parses an <invoke> block that arrives in a single delta", () => {
		const parser = new TextDeltaToolCallParser(makeUid());

		const events = parser.consume(
			'<invoke name="read_file"><parameter name="path">/tmp/a.txt</parameter></invoke>',
		);

		expect(events).toEqual([
			{
				kind: "tool-call",
				toolCallId: "tool_1",
				toolName: "read_file",
				input: { path: "/tmp/a.txt" },
			},
		]);
	});

	it("emits prose before and after an <invoke> block", () => {
		const parser = new TextDeltaToolCallParser(makeUid());

		const events = parser.consume(
			'Let me check that. <invoke name="list_files"><parameter name="path">.</parameter></invoke> Done.',
		);

		expect(events).toEqual([
			{ kind: "text", text: "Let me check that. " },
			{
				kind: "tool-call",
				toolCallId: "tool_1",
				toolName: "list_files",
				input: { path: "." },
			},
			{ kind: "text", text: " Done." },
		]);
	});

	it("parses multiple <invoke> blocks in sequence", () => {
		const parser = new TextDeltaToolCallParser(makeUid());

		const events = parser.consume(
			'<invoke name="a"><parameter name="x">1</parameter></invoke>' +
				'<invoke name="b"><parameter name="y">2</parameter></invoke>',
		);

		expect(events).toEqual([
			{
				kind: "tool-call",
				toolCallId: "tool_1",
				toolName: "a",
				input: { x: "1" },
			},
			{
				kind: "tool-call",
				toolCallId: "tool_2",
				toolName: "b",
				input: { y: "2" },
			},
		]);
	});

	it("reassembles an <invoke> block split across multiple deltas", () => {
		const parser = new TextDeltaToolCallParser(makeUid());

		const deltas = [
			'<invoke name="rea',
			"d_file",
			'"><parameter name="pat',
			'h">/tmp/a.txt</parameter>',
			"</invoke>",
		];

		const events = deltas.flatMap((d) => parser.consume(d));

		expect(events).toEqual([
			{
				kind: "tool-call",
				toolCallId: "tool_1",
				toolName: "read_file",
				input: { path: "/tmp/a.txt" },
			},
		]);
	});

	it("buffers a partial opening tag and emits it as text once flushed", () => {
		const parser = new TextDeltaToolCallParser(makeUid());

		const events = parser.consume("Hello <inv");
		// "Hello " has no '<' anywhere in its tail, so it's safe to emit.
		// "<inv" stays buffered because it could be the start of an
		// <invoke> opening tag that has not finished arriving.
		expect(events).toEqual([{ kind: "text", text: "Hello " }]);

		const flushed = parser.flush();
		expect(flushed).toEqual([{ kind: "text", text: "<inv" }]);
	});

	it("passes malformed XML through as text without throwing", () => {
		const parser = new TextDeltaToolCallParser(makeUid());

		const consumed = parser.consume("<invoke>nope no name attribute</invoke>");
		const flushed = parser.flush();

		expect([...consumed, ...flushed]).toEqual([
			{ kind: "text", text: "<invoke>" },
			{ kind: "text", text: "nope no name attribute" },
			{ kind: "text", text: "</invoke>" },
		]);
	});

	it("emits prose interleaved with tool calls across streamed deltas", () => {
		const parser = new TextDeltaToolCallParser(makeUid());

		const deltas = [
			"Looking at ",
			"the ",
			"directory. ",
			'<invoke name="ls">',
			'<parameter name="p">.</parameter>',
			"</invoke>",
			" Got 3 files.",
		];

		const events: Array<
			| { kind: "text"; text: string }
			| {
					kind: "tool-call";
					toolCallId: string;
					toolName: string;
					input: Record<string, unknown>;
			  }
		> = [];
		for (const d of deltas) {
			events.push(...parser.consume(d));
		}
		events.push(...parser.flush());

		// After flush, the prose collapses into a single run with a single
		// tool call embedded in it.
		expect(events).toEqual([
			{ kind: "text", text: "Looking at " },
			{ kind: "text", text: "the " },
			{ kind: "text", text: "directory. " },
			{
				kind: "tool-call",
				toolCallId: "tool_1",
				toolName: "ls",
				input: { p: "." },
			},
			{ kind: "text", text: " Got 3 files." },
		]);
	});

	it("treats JSON-like text with curly braces as plain text", () => {
		// Regression guard: the parser must not accidentally consume JSON.
		const parser = new TextDeltaToolCallParser(makeUid());

		const events = parser.consume('{"key": "value", "items": [1, 2, 3]}');

		expect(events).toEqual([
			{ kind: "text", text: '{"key": "value", "items": [1, 2, 3]}' },
		]);
	});

	it("handles parameter values containing angle brackets", () => {
		const parser = new TextDeltaToolCallParser(makeUid());

		// The parameter body can contain raw '<' and '>' — the regex uses
		// [\s\S]*? (any character) and only stops at the explicit
		// </parameter> closer. HTML entity decoding is not the parser's job.
		const events = parser.consume(
			'<invoke name="run"><parameter name="code">if (x < 10) { y > 0 }</parameter></invoke>',
		);

		expect(events).toEqual([
			{
				kind: "tool-call",
				toolCallId: "tool_1",
				toolName: "run",
				input: { code: "if (x < 10) { y > 0 }" },
			},
		]);
	});

	it("skips parameters with no name attribute and keeps the rest", () => {
		const parser = new TextDeltaToolCallParser(makeUid());

		const events = parser.consume(
			'<invoke name="x"><parameter>orphan</parameter><parameter name="k">v</parameter></invoke>',
		);

		expect(events).toEqual([
			{
				kind: "tool-call",
				toolCallId: "tool_1",
				toolName: "x",
				input: { k: "v" },
			},
		]);
	});

	it("caps buffer size and flushes everything as text when exceeded", () => {
		const parser = new TextDeltaToolCallParser(makeUid());

		// 64 KiB buffer limit. Feed a single 128 KiB chunk with no <invoke>.
		const huge = "x".repeat(128 * 1024);
		const events = parser.consume(huge);

		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe("text");
		if (events[0].kind === "text") {
			expect(events[0].text.length).toBeGreaterThanOrEqual(128 * 1024);
		}
	});

	it("flush returns empty when there is no buffered text", () => {
		const parser = new TextDeltaToolCallParser(makeUid());

		expect(parser.flush()).toEqual([]);
	});

	it("treats </invoke> inside a parameter body as content, not a close tag", () => {
		// Regression: a parameter value that documents the very format we
		// parse must not be mistaken for the block's closing tag.
		const parser = new TextDeltaToolCallParser(makeUid());

		const events = parser.consume(
			'<invoke name="write_file"><parameter name="content">end: </invoke></parameter></invoke>',
		);

		expect(events).toEqual([
			{
				kind: "tool-call",
				toolCallId: "tool_1",
				toolName: "write_file",
				input: { content: "end: </invoke>" },
			},
		]);
	});

	it("handles </invoke> embedded in a later parameter of a multi-parameter block", () => {
		const parser = new TextDeltaToolCallParser(makeUid());

		const events = parser.consume(
			'<invoke name="a"><parameter name="x">safe</parameter><parameter name="y">has </invoke> here</parameter></invoke>',
		);

		expect(events).toEqual([
			{
				kind: "tool-call",
				toolCallId: "tool_1",
				toolName: "a",
				input: { x: "safe", y: "has </invoke> here" },
			},
		]);
	});

	it("handles a self-closing <parameter> tag", () => {
		const parser = new TextDeltaToolCallParser(makeUid());

		const events = parser.consume(
			'<invoke name="x"><parameter name="k"/></invoke>',
		);

		expect(events).toEqual([
			{
				kind: "tool-call",
				toolCallId: "tool_1",
				toolName: "x",
				input: { k: "" },
			},
		]);
	});
});
