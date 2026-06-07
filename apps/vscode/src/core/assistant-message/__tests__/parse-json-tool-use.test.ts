import { ClineDefaultTool } from "@shared/tools"
import { expect } from "chai"
import { describe, it } from "mocha"
import type { ToolUse } from ".."
import { parseAssistantMessageV2 } from "../parse-assistant-message"
import { findJsonToolSpans, mergeJsonToolUsesFallback, stripJsonToolPayloadsFromDisplayText } from "../parse-json-tool-use"

function toolUses(blocks: ReturnType<typeof parseAssistantMessageV2>): ToolUse[] {
	return blocks.filter((block): block is ToolUse => block.type === "tool_use")
}

describe("parseAssistantMessageV2 JSON fallback", () => {
	it("parses a direct Qwen-style JSON tool call into tool_use", () => {
		const message =
			'I will create the file.\n{"name":"write_to_file","arguments":{"path":"src/foo.ts","content":"export const x = 1\\n"}}'

		const blocks = parseAssistantMessageV2(message)
		const tools = toolUses(blocks)

		expect(tools).to.have.length(1)
		expect(tools[0].name).to.equal("write_to_file")
		expect(tools[0].params.path).to.equal("src/foo.ts")
		expect(tools[0].params.content).to.equal("export const x = 1\n")
		expect(tools[0].partial).to.equal(false)
		expect(tools[0].isNativeToolCall).to.equal(false)

		const textBlocks = blocks.filter((b) => b.type === "text")
		expect(textBlocks).to.have.length(1)
		expect(textBlocks[0].content).to.equal("I will create the file.")
	})

	it("accepts parameters alias instead of arguments", () => {
		const message = '{"name":"read_file","parameters":{"path":"README.md"}}'

		const tools = toolUses(parseAssistantMessageV2(message))

		expect(tools).to.have.length(1)
		expect(tools[0].name).to.equal("read_file")
		expect(tools[0].params.path).to.equal("README.md")
	})

	it("parses OpenAI function wrapper shape with stringified arguments", () => {
		const message =
			'{"function":{"name":"execute_command","arguments":"{\\"command\\":\\"npm test\\",\\"requires_approval\\":false}"}}'

		const tools = toolUses(parseAssistantMessageV2(message))

		expect(tools).to.have.length(1)
		expect(tools[0].name).to.equal("execute_command")
		expect(tools[0].params.command).to.equal("npm test")
		expect(tools[0].params.requires_approval).to.equal("false")
	})

	it("parses tool_calls array into multiple tool_use blocks", () => {
		const message =
			'{"tool_calls":[{"function":{"name":"read_file","arguments":{"path":"a.ts"}}},{"function":{"name":"list_files","arguments":{"path":"src"}}}]}'

		const blocks = parseAssistantMessageV2(message)
		const tools = toolUses(blocks)

		expect(tools).to.have.length(2)
		expect(tools[0].name).to.equal("read_file")
		expect(tools[0].params.path).to.equal("a.ts")
		expect(tools[1].name).to.equal("list_files")
		expect(tools[1].params.path).to.equal("src")
	})

	it("parses JSON inside markdown fences", () => {
		const message = `Here is the call:

\`\`\`json
{"name":"write_to_file","arguments":{"path":"bar.ts","content":"hello"}}
\`\`\`
`

		const blocks = parseAssistantMessageV2(message)
		const tools = toolUses(blocks)

		expect(tools).to.have.length(1)
		expect(tools[0].params.path).to.equal("bar.ts")
		expect(tools[0].params.content).to.equal("hello")

		const textBlocks = blocks.filter((b) => b.type === "text")
		const textContent = textBlocks.map((b) => (b.type === "text" ? b.content : "")).join("")
		expect(textContent).to.not.include("```")
	})

	it("ignores invalid tool names and leaves content as text", () => {
		const message = '{"name":"not_a_real_cline_tool","arguments":{"path":"x"}}'

		const blocks = parseAssistantMessageV2(message)

		expect(toolUses(blocks)).to.have.length(0)
		expect(blocks).to.have.length(1)
		expect(blocks[0].type).to.equal("text")
	})

	it("leaves incomplete JSON as text during streaming", () => {
		const message = 'Working on it {"name":"write_to_file","arguments":{"path":"partial.ts"'

		const blocks = parseAssistantMessageV2(message)

		expect(toolUses(blocks)).to.have.length(0)
		const textBlocks = blocks.filter((b) => b.type === "text")
		expect(textBlocks).to.have.length(1)
		expect(textBlocks[0].content).to.include('{"name":"write_to_file"')
	})

	it("prefers XML when both XML and JSON are present", () => {
		const message = `<write_to_file>
<path>xml-path.ts</path>
<content>from xml</content>
</write_to_file>
{"name":"write_to_file","arguments":{"path":"json-path.ts","content":"from json"}}`

		const tools = toolUses(parseAssistantMessageV2(message))

		expect(tools).to.have.length(1)
		expect(tools[0].params.path).to.equal("xml-path.ts")
		expect(tools[0].params.content).to.equal("from xml")
	})

	it("preserves existing XML parsing for standard tool tags", () => {
		const message = `<read_file>
<path>src/index.ts</path>
</read_file>`

		const tools = toolUses(parseAssistantMessageV2(message))

		expect(tools).to.have.length(1)
		expect(tools[0].name).to.equal("read_file")
		expect(tools[0].params.path).to.equal("src/index.ts")
		expect(tools[0].partial).to.equal(false)
	})

	it("does not run JSON fallback when XML produced a partial tool_use", () => {
		const xmlBlocks = [
			{
				type: "tool_use" as const,
				name: ClineDefaultTool.FILE_NEW,
				params: { path: "partial.ts" },
				partial: true,
				call_id: "test",
				isNativeToolCall: false,
			},
		]
		const message = '{"name":"read_file","arguments":{"path":"ignored.ts"}}'

		const merged = mergeJsonToolUsesFallback(message, xmlBlocks)

		expect(merged).to.equal(xmlBlocks)
		expect(toolUses(merged)).to.have.length(1)
		expect(toolUses(merged)[0].params.path).to.equal("partial.ts")
	})
})

describe("stripJsonToolPayloadsFromDisplayText", () => {
	it("removes fenced JSON tool blocks including fence markers from display text", () => {
		const text = `Here is the call:\n\`\`\`json\n{"name":"read_file","arguments":{"path":"a.ts"}}\n\`\`\``

		expect(stripJsonToolPayloadsFromDisplayText(text)).to.equal("Here is the call:")
	})

	it("removes a complete JSON tool object from display text", () => {
		const json = '{"name":"read_file","arguments":{"path":"hello_test.py"}}'
		const text = `I will read the file.\n${json}\nThanks.`

		expect(stripJsonToolPayloadsFromDisplayText(text)).to.equal("I will read the file.\n\nThanks.")
	})

	it("removes trailing incomplete JSON during streaming", () => {
		const text = 'Working on it {"name":"read_file","arguments":{"path":"hello_test.py"'

		expect(stripJsonToolPayloadsFromDisplayText(text)).to.equal("Working on it")
	})

	it("removes trailing incomplete JSON when text ends with whitespace", () => {
		const text = 'Working on it {"name":"read_file","arguments":{"path":"hello_test.py"\n'

		expect(stripJsonToolPayloadsFromDisplayText(text)).to.equal("Working on it")
	})

	it("leaves non-tool JSON prose unchanged", () => {
		const text = 'Example: {"foo": "bar"} is not a tool call.'

		expect(stripJsonToolPayloadsFromDisplayText(text)).to.equal(text)
	})

	it("removes standalone task_progress JSON from display text", () => {
		const json = '{"task_progress": "- [x] Read hello_test.py\\n- [ ] Write file"}'
		const text = `Editing now.\n${json}`

		expect(stripJsonToolPayloadsFromDisplayText(text)).to.equal("Editing now.")
	})

	it("removes trailing incomplete task_progress JSON during streaming", () => {
		const text = 'Updating checklist {"task_progress": "- [x] done'

		expect(stripJsonToolPayloadsFromDisplayText(text)).to.equal("Updating checklist")
	})

	it("removes task_progress XML blocks from display text", () => {
		const text = "Done.<task_progress>\n- [x] a\n</task_progress>"

		expect(stripJsonToolPayloadsFromDisplayText(text)).to.equal("Done.")
	})
})

describe("findJsonToolSpans", () => {
	it("returns no spans for prose without JSON tools", () => {
		expect(findJsonToolSpans("Hello, no tools here.")).to.deep.equal([])
	})

	it("finds span boundaries for a complete object", () => {
		const json = '{"name":"read_file","arguments":{"path":"a.ts"}}'
		const spans = findJsonToolSpans(`prefix ${json} suffix`)

		expect(spans).to.have.length(1)
		expect(spans[0].tools).to.have.length(1)
		expect(spans[0].tools[0].name).to.equal("read_file")
		expect(json).to.equal(`prefix ${json} suffix`.slice(spans[0].start, spans[0].end))
	})
})
