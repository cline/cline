import { describe, expect, it } from "bun:test";
import {
	buildXmlToolDocs,
	coerceToolInput,
	formatToolResultText,
	parseAssistantXml,
	serializeToolCallXml,
	toXmlToolSpecs,
	XML_TOOL_CALLING_RULE,
	type XmlToolDefinition,
} from "./xml-format.ts";

const TOOLS: XmlToolDefinition[] = [
	{
		name: "read_file",
		description: "Read a file from disk.",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Relative file path." },
			},
			required: ["path"],
		},
	},
	{
		name: "write_to_file",
		description: "Create or overwrite a file.",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string" },
				content: { type: "string" },
			},
			required: ["path", "content"],
		},
	},
	{
		name: "run_commands",
		description: "Run shell commands.",
		inputSchema: {
			type: "object",
			properties: {
				commands: { type: "array", items: { type: "string" } },
				timeout_secs: {
					anyOf: [{ type: "integer" }, { type: "null" }],
				},
				background: { type: "boolean" },
			},
			required: ["commands"],
		},
	},
	{
		name: "attempt_completion",
		description: "Present the final result.",
		inputSchema: {
			type: "object",
			properties: { result: { type: "string" } },
			required: ["result"],
		},
		lifecycle: { completesRun: true },
	},
];

const specs = toXmlToolSpecs(TOOLS);

describe("parseAssistantXml", () => {
	it("parses a single tool use with surrounding text", () => {
		const blocks = parseAssistantXml(
			"Let me read that file.\n<read_file>\n<path>src/main.ts</path>\n</read_file>",
			specs,
		);
		expect(blocks).toEqual([
			{ type: "text", text: "Let me read that file." },
			{
				type: "tool_use",
				name: "read_file",
				params: { path: "src/main.ts" },
				partial: false,
				raw: "<read_file>\n<path>src/main.ts</path>\n</read_file>",
			},
		]);
	});

	it("parses multiple parameters", () => {
		const blocks = parseAssistantXml(
			"<write_to_file>\n<path>a.txt</path>\n<content>hello world</content>\n</write_to_file>",
			specs,
		);
		expect(blocks).toHaveLength(1);
		const tool = blocks[0];
		if (tool?.type !== "tool_use") throw new Error("expected tool_use");
		expect(tool.params).toEqual({ path: "a.txt", content: "hello world" });
		expect(tool.partial).toBe(false);
	});

	it("preserves meaningful parameter whitespace", () => {
		const blocks = parseAssistantXml(
			"<write_to_file>\n<path>a.txt</path>\n<content>\n\n  indented\n\n</content>\n</write_to_file>",
			specs,
		);
		const tool = blocks[0];
		if (tool?.type !== "tool_use") throw new Error("expected tool_use");
		expect(tool.params.content).toBe("\n  indented\n");
	});

	it("recovers content values containing their own closing tag", () => {
		const content =
			"<note>first</note>\nliteral </content> inside\n<note>second</note>";
		const blocks = parseAssistantXml(
			`<write_to_file>\n<path>notes.xml</path>\n<content>\n${content}\n</content>\n</write_to_file>`,
			specs,
		);
		const tool = blocks[0];
		if (tool?.type !== "tool_use") throw new Error("expected tool_use");
		expect(tool.params.path).toBe("notes.xml");
		expect(tool.params.content).toBe(content);
	});

	it("marks an unclosed tool use as partial and keeps its raw source", () => {
		const text = "Working on it.\n<read_file>\n<path>src/main.ts";
		const blocks = parseAssistantXml(text, specs);
		expect(blocks).toEqual([
			{ type: "text", text: "Working on it." },
			{
				type: "tool_use",
				name: "read_file",
				params: { path: "src/main.ts" },
				partial: true,
				raw: "<read_file>\n<path>src/main.ts",
			},
		]);
	});

	it("treats unknown tags as plain text", () => {
		const blocks = parseAssistantXml(
			"<thinking>hmm</thinking> just text <unknown_tool><path>x</path></unknown_tool>",
			specs,
		);
		expect(blocks).toEqual([
			{
				type: "text",
				text: "<thinking>hmm</thinking> just text <unknown_tool><path>x</path></unknown_tool>",
			},
		]);
	});

	it("parses multiple tool uses in one message", () => {
		const blocks = parseAssistantXml(
			"<read_file><path>a.ts</path></read_file>then<read_file><path>b.ts</path></read_file>",
			specs,
		);
		expect(
			blocks.map((block) =>
				block.type === "tool_use" ? block.params.path : block.text,
			),
		).toEqual(["a.ts", "then", "b.ts"]);
	});

	it("returns a single text block when no tools are present", () => {
		expect(parseAssistantXml("All done!", specs)).toEqual([
			{ type: "text", text: "All done!" },
		]);
	});
});

describe("coerceToolInput", () => {
	const runCommandsSpec = specs.get("run_commands");
	if (!runCommandsSpec) throw new Error("missing spec");

	it("coerces schema-typed params from strings", () => {
		expect(
			coerceToolInput(
				{
					commands: '["ls", "pwd"]',
					timeout_secs: "30",
					background: "true",
				},
				runCommandsSpec,
			),
		).toEqual({ commands: ["ls", "pwd"], timeout_secs: 30, background: true });
	});

	it("passes through values that fail coercion for the tool to validate", () => {
		expect(
			coerceToolInput(
				{ commands: "not json", timeout_secs: "soon", background: "maybe" },
				runCommandsSpec,
			),
		).toEqual({
			commands: "not json",
			timeout_secs: "soon",
			background: "maybe",
		});
	});

	it("keeps string params verbatim", () => {
		const readSpec = specs.get("read_file");
		if (!readSpec) throw new Error("missing spec");
		expect(coerceToolInput({ path: "42" }, readSpec)).toEqual({ path: "42" });
	});
});

describe("prompt content", () => {
	const docs = buildXmlToolDocs(specs);

	it("keeps the static rule free of tool-specific content", () => {
		expect(XML_TOOL_CALLING_RULE).toContain("TOOL USE");
		expect(XML_TOOL_CALLING_RULE).toContain("<tool_name>");
		for (const tool of TOOLS) {
			expect(XML_TOOL_CALLING_RULE).not.toContain(tool.name);
		}
	});

	it("documents every tool with usage skeletons", () => {
		expect(docs).toContain("TOOL DOCUMENTATION");
		for (const tool of TOOLS) {
			expect(docs).toContain(`## ${tool.name}`);
			expect(docs).toContain(`<${tool.name}>`);
			expect(docs).toContain(`</${tool.name}>`);
		}
		expect(docs).toContain("- path: (required, text)");
		expect(docs).toContain("- commands: (required, JSON array)");
		expect(docs).toContain("- background: (optional, true or false)");
	});

	it("points at completion tools when present", () => {
		expect(docs).toContain("`attempt_completion`");
	});

	it("falls back to plain-text completion guidance without completion tools", () => {
		const withoutCompletion = buildXmlToolDocs(
			toXmlToolSpecs(TOOLS.filter((tool) => !tool.lifecycle?.completesRun)),
		);
		expect(withoutCompletion).toContain("reply in plain text");
	});
});

describe("serialization round trip", () => {
	it("serializes tool calls back into parseable XML", () => {
		const xml = serializeToolCallXml("run_commands", {
			commands: ["ls", "pwd"],
			timeout_secs: 30,
			background: false,
		});
		const blocks = parseAssistantXml(xml, specs);
		expect(blocks).toHaveLength(1);
		const tool = blocks[0];
		if (tool?.type !== "tool_use") throw new Error("expected tool_use");
		const runCommandsSpec = specs.get("run_commands");
		if (!runCommandsSpec) throw new Error("missing spec");
		expect(coerceToolInput(tool.params, runCommandsSpec)).toEqual({
			commands: ["ls", "pwd"],
			timeout_secs: 30,
			background: false,
		});
	});

	it("formats string and structured tool results", () => {
		expect(formatToolResultText("read_file", "file body", undefined)).toBe(
			"[read_file] Result:\nfile body",
		);
		expect(formatToolResultText("run_commands", { code: 1 }, true)).toBe(
			`[run_commands] Error:\n${JSON.stringify({ code: 1 }, null, 2)}`,
		);
	});
});
