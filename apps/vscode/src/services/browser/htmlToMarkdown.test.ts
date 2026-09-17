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

	it("pads the columns a colspan covers", () => {
		// One cell for three columns left the row two cells short of the header.
		const html =
			"<table><tr><th>A</th><th>B</th><th>C</th></tr>" +
			'<tr><td colspan="3">total</td></tr>' +
			'<tr><td>1</td><td colspan="2">rest</td></tr></table>'

		expect(tableRows(htmlToMarkdown(html))).toEqual([
			["A", "B", "C"],
			["---", "---", "---"],
			["total", "", ""],
			["1", "rest", ""],
		])
	})

	it("holds the column a rowspan covers open in the rows below it", () => {
		// Without the placeholder, "9 EUR" moved left into the Product column.
		const html =
			"<table><tr><th>Product</th><th>Variant</th><th>Price</th></tr>" +
			'<tr><td rowspan="2">Cable</td><td>1 m</td><td>9 EUR</td></tr>' +
			"<tr><td>2 m</td><td>12 EUR</td></tr></table>"

		expect(tableRows(htmlToMarkdown(html))).toEqual([
			["Product", "Variant", "Price"],
			["---", "---", "---"],
			["Cable", "1 m", "9 EUR"],
			["", "2 m", "12 EUR"],
		])
	})

	it("counts the header columns by their spans", () => {
		const html =
			'<table><tr><th colspan="2">Size</th><th>Price</th></tr>' + "<tr><td>S</td><td>M</td><td>9 EUR</td></tr></table>"

		expect(tableRows(htmlToMarkdown(html))).toEqual([
			["Size", "", "Price"],
			["---", "---", "---"],
			["S", "M", "9 EUR"],
		])
	})

	it("pads a row that is short of the widest row", () => {
		const html = "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td></tr></table>"

		expect(tableRows(htmlToMarkdown(html))).toEqual([
			["A", "B"],
			["---", "---"],
			["1", ""],
		])
	})

	it("writes a header row and its body with no blank line between them", () => {
		const html =
			"<table><thead><tr><th>Plan</th><th>Price</th></tr></thead>" +
			"<tbody><tr><td>Starter</td><td>9 EUR</td></tr><tr><td>Pro</td><td>29 EUR</td></tr></tbody></table>"

		expect(htmlToMarkdown(html)).toBe("| Plan | Price |\n| --- | --- |\n| Starter | 9 EUR |\n| Pro | 29 EUR |")
	})

	it("holds a rowspan open when it covers the row's last columns", () => {
		// No later cell forces the placeholder, so it has to come from the row's right-side padding.
		const html =
			"<table><tr><th>A</th><th>B</th></tr>" + '<tr><td>1</td><td rowspan="2">x</td></tr>' + "<tr><td>2</td></tr></table>"

		expect(tableRows(htmlToMarkdown(html))).toEqual([
			["A", "B"],
			["---", "---"],
			["1", "x"],
			["2", ""],
		])
	})

	it("does not let a span attribute grow the output", () => {
		// colspan="1000000" produced ten million characters from a few bytes of page.
		const page = (span: number) => `<table><tr><td colspan="${span}">x</td></tr><tr><td>a</td></tr></table><p>after</p>`
		const huge = htmlToMarkdown(page(1_000_000))

		expect(huge).toBe(htmlToMarkdown(page(1000)))
		expect(huge.length).toBeLessThan(100)
		expect(huge).toContain("after")
	})

	it("survives spans that would cover millions of grid cells", () => {
		// Tracking that many slots threw "RangeError: Set maximum size exceeded".
		const html = `<table>${'<tr><td rowspan="65534" colspan="1000">x</td></tr>'.repeat(3)}</table>`

		expect(() => htmlToMarkdown(html)).not.toThrow()
	})

	it("keeps the widest row inside the table when the spans are over budget", () => {
		// Past the budget the delimiter counted only the header's own cells, so
		// the third cell of the last row fell outside the table.
		const html =
			"<table><tr><th>A</th><th>B</th></tr>" +
			'<tr><td colspan="1000">wide</td></tr>' +
			"<tr><td>1</td><td>2</td><td>3</td></tr></table>"

		expect(htmlToMarkdown(html)).toBe("| A | B | |\n| --- | --- | --- |\n| wide |\n| 1 | 2 | 3 |")
	})

	it("pads only the header when padding every row would outgrow the budget", () => {
		// GFM fills a short body row with empty cells itself. Padding every row
		// instead grows with the square of the table: one wide row under many
		// narrow ones.
		const width = 2000
		const html = "<table>" + "<tr><td>h</td></tr>".repeat(width) + `<tr>${"<td>w</td>".repeat(width)}</tr></table>`

		const markdown = htmlToMarkdown(html)
		const lines = markdown.split("\n")

		expect(lines[1]).toBe(`|${" --- |".repeat(width)}`)
		expect(lines[lines.length - 1]).toBe(`|${" w |".repeat(width)}`)
		expect(markdown.length).toBeLessThan(40 * width)
	})

	it("keeps the table whole around a row that has no cells", () => {
		// Turndown writes a cell-less row as a blank line, which ended the table.
		const html = "<table><tr><th>A</th><th>B</th></tr><tr></tr><tr><td>1</td><td>2</td></tr></table>"

		expect(htmlToMarkdown(html)).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |")
	})

	it("puts the delimiter under the first row that has cells", () => {
		const html = "<table><tr></tr><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>"

		expect(htmlToMarkdown(html)).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |")
	})

	it(
		"folds a long run of non-breaking spaces without backtracking",
		() => {
			// A `\s*\n\s*` fold took 4.7 s for 80,000 of them and grows with the square of the run.
			const html = `<table><tr><th>A</th></tr><tr><td>x${"\u00a0".repeat(200_000)}</td></tr></table>`

			expect(tableRows(htmlToMarkdown(html))[2]).toEqual(["x"])
		},
		{ timeout: 5_000 },
	)

	it("keeps a pipe inside a code span from splitting the cell", () => {
		// The code span already has one backslash; a second made an even run, which GFM splits at.
		const html = "<table><tr><th>Regex</th><th>Use</th></tr><tr><td><code>a\\|b</code></td><td>alt</td></tr></table>"

		expect(htmlToMarkdown(html).split("\n")[2]).toBe("| `a\\|b` | alt |")
	})

	it("leaves markup without a table alone", () => {
		const html = "<p>hello</p><ul><li>a</li><li>b</li></ul>"

		expect(htmlToMarkdown(html)).toBe(new TurndownService().turndown(html))
	})
})
