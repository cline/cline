import { describe, expect, it } from "bun:test"
import TurndownService from "turndown"
import { htmlToMarkdown } from "./htmlToMarkdown"

/** Read the markdown table back the way a reader does. */
function tableRows(markdown: string): string[][] {
	return markdown
		.split("\n")
		.filter((line) => line.trim().startsWith("|"))
		.map((line) =>
			line
				.trim()
				.replace(/^\||\|$/g, "")
				.split(/(?<!\\)\|/)
				.map((cell) => cell.replace(/\\(.)/g, "$1").trim()),
		)
}

describe("htmlToMarkdown", () => {
	it("keeps a value in the row and the column it belongs to", () => {
		// Turndown ships no table rules, so every cell came out as a paragraph
		// of its own and a value lost the row it belonged to.
		const markdown = htmlToMarkdown(
			"<h1>Parameters</h1>" +
				"<table><thead><tr><th>Name</th><th>Type</th></tr></thead>" +
				"<tbody><tr><td>limit</td><td>integer</td></tr>" +
				"<tr><td>cursor</td><td>string</td></tr></tbody></table>" +
				"<p>after</p>",
		)

		expect(tableRows(markdown)).toEqual([
			["Name", "Type"],
			["---", "---"],
			["limit", "integer"],
			["cursor", "string"],
		])
		// The table has to be a block of its own, or it is read as prose.
		expect(markdown).toBe(
			"Parameters\n==========\n\n| Name | Type |\n| --- | --- |\n| limit | integer |\n| cursor | string |\n\nafter",
		)
	})

	it("uses the first row as the header when the page wrote no th", () => {
		const markdown = htmlToMarkdown(
			"<table><tr><td>Name</td><td>Type</td></tr><tr><td>limit</td><td>integer</td></tr></table>",
		)

		expect(tableRows(markdown)).toEqual([
			["Name", "Type"],
			["---", "---"],
			["limit", "integer"],
		])
	})

	it("keeps a pipe inside the cell that holds it", () => {
		const markdown = htmlToMarkdown(
			"<table><tr><th>Name</th><th>Type</th></tr><tr><td>mode</td><td>fast|slow</td></tr></table>",
		)

		expect(tableRows(markdown)[2]).toEqual(["mode", "fast|slow"])
	})

	it("keeps a cell's own backslash next to a pipe", () => {
		const markdown = htmlToMarkdown("<table><tr><th>Pattern</th></tr><tr><td>a\\|b</td></tr></table>")

		expect(tableRows(markdown)[2]).toEqual(["a\\|b"])
	})

	it("keeps the inline markup inside a cell", () => {
		const markdown = htmlToMarkdown(
			'<table><tr><th>Name</th></tr><tr><td><code>limit</code>, see <a href="https://example.com/d">docs</a></td></tr></table>',
		)

		expect(tableRows(markdown)[2]).toEqual(["`limit`, see [docs](https://example.com/d)"])
	})

	it("folds a line break inside a cell into a space", () => {
		expect(tableRows(htmlToMarkdown("<table><tr><th>Note</th></tr><tr><td>one<br>two</td></tr></table>"))[2]).toEqual([
			"one two",
		])
	})

	it("puts a caption in its own paragraph above the table", () => {
		expect(htmlToMarkdown("<table><caption>Parameters</caption><tr><th>A</th></tr><tr><td>1</td></tr></table>")).toBe(
			"Parameters\n\n| A |\n| --- |\n| 1 |",
		)
	})

	it("leaves markup without a table alone", () => {
		const html = "<p>hello</p><ul><li>a</li><li>b</li></ul>"

		expect(htmlToMarkdown(html)).toBe(new TurndownService().turndown(html))
	})
})
