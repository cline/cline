import TurndownService from "turndown"

/**
 * Convert cleaned page HTML to Markdown.
 *
 * Turndown has no table support of its own, so a `<table>` would be flattened
 * into one paragraph per cell: a value ends up several blank lines away from
 * the row it belongs to, and nothing records which column it came from. The
 * rules below give the conversion the table back.
 */
export function htmlToMarkdown(html: string): string {
	const turndownService = new TurndownService()

	turndownService.addRule("tableCell", {
		filter: ["th", "td"],
		replacement: (content) => ` ${cellText(content)} |`,
	})

	turndownService.addRule("tableRow", {
		filter: "tr",
		replacement: (content, node) => {
			const row = `|${content}`
			if (!isFirstRow(node)) {
				return `\n${row}`
			}
			// A GFM table has to open with a header row, so the first row becomes
			// one. On a page written without <th> that is what it is anyway.
			const columns = node.querySelectorAll("th, td").length
			return `\n${row}\n|${" --- |".repeat(columns)}`
		},
	})

	// A section wrapper must not put a blank line between the header row and the
	// body, because a blank line ends the table.
	turndownService.addRule("tableSection", {
		filter: ["thead", "tbody", "tfoot"],
		replacement: (content) => content,
	})

	turndownService.addRule("tableCaption", {
		filter: "caption",
		replacement: (content) => (content.trim() ? `${content.trim()}\n\n` : ""),
	})

	turndownService.addRule("table", {
		filter: "table",
		replacement: (content) => `\n\n${content.trim()}\n\n`,
	})

	return turndownService.turndown(html)
}

/** Turndown has already escaped the cell's backslashes, so only the pipe is left. */
function cellText(content: string): string {
	// Turndown writes a <br> as two spaces and a newline; the whole break folds
	// into one space, because a newline would end the row halfway through.
	return content
		.replace(/[^\S\r\n]*\r?\n[^\S\r\n]*/g, " ")
		.replace(/\|/g, "\\|")
		.trim()
}

function isFirstRow(node: HTMLElement): boolean {
	let table: Node | null = node.parentNode
	while (table && table.nodeName !== "TABLE") {
		table = table.parentNode
	}
	return !!table && (table as HTMLElement).querySelector("tr") === node
}
