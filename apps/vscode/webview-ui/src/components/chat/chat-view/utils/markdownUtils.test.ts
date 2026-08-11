import { describe, expect, it } from "vitest"
import { convertHtmlToMarkdown } from "./markdownUtils"

describe("convertHtmlToMarkdown", () => {
	it("converts basic HTML to markdown", async () => {
		const md = await convertHtmlToMarkdown("<p>Hello <strong>world</strong></p>")
		expect(md.trim()).toBe("Hello __world__")
	})

	// Regression tests for https://github.com/cline/cline/issues/12832 —
	// copying chat content containing GFM constructs threw
	// "Cannot handle unknown node `table`" (or `delete`) because the
	// stringify pipeline had no handlers for the GFM mdast nodes that
	// rehype-remark emits.
	it("converts an HTML table to a GFM markdown table instead of throwing", async () => {
		const html =
			"<table><thead><tr><th>Name</th><th>Value</th></tr></thead>" +
			"<tbody><tr><td>a</td><td>1</td></tr><tr><td>b</td><td>2</td></tr></tbody></table>"
		const md = await convertHtmlToMarkdown(html)
		const lines = md.trim().split("\n")
		expect(lines[0]).toMatch(/^\| Name\s+\| Value\s+\|$/)
		expect(lines[1]).toMatch(/^\| -+\s*\| -+\s*\|$/)
		expect(lines[2]).toMatch(/^\| a\s+\| 1\s+\|$/)
		expect(lines[3]).toMatch(/^\| b\s+\| 2\s+\|$/)
	})

	it("converts strikethrough and task lists instead of throwing", async () => {
		const md = await convertHtmlToMarkdown(
			'<p><del>gone</del> and <s>also gone</s></p><ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> todo</li></ul>',
		)
		expect(md).toContain("~~gone~~")
		expect(md).toContain("~~also gone~~")
		expect(md).toContain("- [x] done")
		expect(md).toContain("- [ ] todo")
	})

	// Guard against the escaping rules that the full remark-gfm serializer
	// would introduce: emails, bare URLs, and tildes in plain text must
	// round-trip without backslash escapes (`user\@example.com`,
	// `https\://`, `\~/path`).
	it("does not add backslash escapes to emails, URLs, or tildes in plain text", async () => {
		const md = await convertHtmlToMarkdown(
			"<p>Email user@example.com, see https://example.com/docs, edit ~/app/src/index.ts, takes 5~10s</p>",
		)
		expect(md).toContain("user@example.com")
		expect(md).toContain("https://example.com/docs")
		expect(md).toContain("~/app/src/index.ts")
		expect(md).toContain("5~10s")
		expect(md).not.toContain("\\")
	})

	it("escapes pipes inside table cells only, not in plain text", async () => {
		const table = await convertHtmlToMarkdown("<table><tr><th>Cmd</th></tr><tr><td><code>a | b</code></td></tr></table>")
		expect(table).toContain("`a \\| b`")
		const text = await convertHtmlToMarkdown("<p>Use a | b syntax</p>")
		expect(text).toContain("a | b")
		expect(text).not.toContain("\\|")
	})

	it("converts code blocks with fences", async () => {
		const md = await convertHtmlToMarkdown("<pre><code>const x = 1</code></pre>")
		expect(md).toContain("```\nconst x = 1\n```")
	})
})
