import { describe, expect, it } from "vitest"
import { convertHtmlToMarkdown } from "./markdownUtils"

describe("convertHtmlToMarkdown", () => {
	it("converts basic HTML to markdown", async () => {
		const md = await convertHtmlToMarkdown("<p>Hello <strong>world</strong></p>")
		expect(md.trim()).toBe("Hello __world__")
	})

	// Regression test for https://github.com/cline/cline/issues/12832 —
	// copying a rendered markdown table threw "Cannot handle unknown node `table`"
	// because the stringify pipeline lacked the GFM serializers.
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

	it("converts other GFM constructs emitted by rehype-remark", async () => {
		const md = await convertHtmlToMarkdown(
			'<p><del>gone</del></p><ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> todo</li></ul>',
		)
		expect(md).toContain("~~gone~~")
		expect(md).toContain("- [x] done")
		expect(md).toContain("- [ ] todo")
	})

	it("converts code blocks with fences", async () => {
		const md = await convertHtmlToMarkdown("<pre><code>const x = 1</code></pre>")
		expect(md).toContain("```\nconst x = 1\n```")
	})
})
