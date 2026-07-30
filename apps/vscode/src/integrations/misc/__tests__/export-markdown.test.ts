import { describe, it } from "bun:test"
import "should"
import type { ContentBlock } from "@cline/llms"
import { formatContentBlockToMarkdown } from "../export-markdown"

describe("formatContentBlockToMarkdown", () => {
	it("returns text content as-is", () => {
		formatContentBlockToMarkdown({ type: "text", text: "hello" }).should.equal("hello")
	})

	it("formats image and file blocks as placeholders", () => {
		formatContentBlockToMarkdown({ type: "image", data: "abc", mediaType: "image/png" }).should.equal("[Image]")
		formatContentBlockToMarkdown({ type: "file", content: "x", path: "/tmp/a.txt" }).should.equal("[File: /tmp/a.txt]")
	})

	it("formats thinking blocks", () => {
		formatContentBlockToMarkdown({ type: "thinking", thinking: "pondering" }).should.equal("[Thinking]\npondering")
		formatContentBlockToMarkdown({ type: "redacted_thinking", data: "x" }).should.equal("[Thinking (Redacted)]")
	})

	it("formats tool use with primitive and object inputs", () => {
		const result = formatContentBlockToMarkdown({
			type: "tool_use",
			id: "1",
			name: "read_files",
			input: { path: "/tmp/a.txt", files: ["a", "b"] },
		})
		result.should.startWith("[Tool Use: read_files]")
		result.should.containEql("Path: /tmp/a.txt")
		result.should.containEql('Files: [\n  "a",\n  "b"\n]')
	})

	it("formats string and typed-array tool results", () => {
		formatContentBlockToMarkdown({
			type: "tool_result",
			tool_use_id: "1",
			name: "t",
			content: "done",
		}).should.equal("[Tool]\ndone")

		formatContentBlockToMarkdown({
			type: "tool_result",
			tool_use_id: "1",
			name: "t",
			content: "failed",
			is_error: true,
		}).should.equal("[Tool (Error)]\nfailed")

		formatContentBlockToMarkdown({
			type: "tool_result",
			tool_use_id: "1",
			name: "t",
			content: [{ type: "text", text: "inner" }],
		}).should.equal("[Tool]\ninner")
	})

	it("renders untyped executor-output objects inside tool results as JSON", () => {
		const result = formatContentBlockToMarkdown({
			type: "tool_result",
			tool_use_id: "1",
			name: "run_commands",
			content: [{ query: "echo hi", result: "hi", success: true } as unknown as ContentBlock],
		} as ContentBlock)
		result.should.containEql('"query": "echo hi"')
		result.should.containEql('"result": "hi"')
		result.should.not.containEql("[Unexpected content type]")
	})
})
