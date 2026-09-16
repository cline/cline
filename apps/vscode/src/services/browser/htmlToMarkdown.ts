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
		replacement: (content, node) => {
			const grid = gridFor(node)
			// Markdown has no merged cells, so a span becomes the empty cells the
			// columns it covers would otherwise be missing.
			const before = " |".repeat(grid?.before.get(node) ?? 0)
			const spanned = " |".repeat(spanOf(node, "colspan") - 1)
			return `${before} ${cellText(content)} |${spanned}`
		},
	})

	turndownService.addRule("tableRow", {
		filter: "tr",
		replacement: (content, node) => {
			const grid = gridFor(node)
			const after = " |".repeat(grid?.after.get(node) ?? 0)
			const row = `|${content}${after}`
			if (!isFirstRow(node)) {
				return `\n${row}`
			}
			// A GFM table has to open with a header row, so the first row becomes
			// one. On a page written without <th> that is what it is anyway.
			const columns = grid?.width ?? node.querySelectorAll("th, td").length
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
	const table = tableOf(node)
	return !!table && table.querySelector("tr") === node
}

function tableOf(node: Node): HTMLElement | null {
	let parent: Node | null = node.parentNode
	while (parent && parent.nodeName !== "TABLE") {
		parent = parent.parentNode
	}
	return (parent as HTMLElement) ?? null
}

interface TableGrid {
	width: number
	/** Empty cells a cell needs in front of it, because a rowspan holds those columns. */
	before: Map<Element, number>
	/** Empty cells a row needs at its end, to reach the width of the widest row. */
	after: Map<Element, number>
}

const grids = new WeakMap<Element, TableGrid>()

function gridFor(node: Element): TableGrid | null {
	const table = tableOf(node)
	if (!table) {
		return null
	}
	let grid = grids.get(table)
	if (!grid) {
		grid = measure(table)
		grids.set(table, grid)
	}
	return grid
}

/** Lay the table out on a grid the way a browser does, so spans take their columns. */
function measure(table: Element): TableGrid {
	const before = new Map<Element, number>()
	const after = new Map<Element, number>()
	const taken = new Set<string>()
	const rows = Array.from(table.querySelectorAll("tr")).filter((row) => tableOf(row) === table)
	let width = 0

	rows.forEach((row, rowIndex) => {
		let column = 0
		const free = (): number => {
			let skipped = 0
			while (taken.has(`${rowIndex},${column}`)) {
				column++
				skipped++
			}
			return skipped
		}
		for (const cell of cellsOf(row)) {
			before.set(cell, free())
			const colspan = spanOf(cell, "colspan")
			const rowspan = spanOf(cell, "rowspan")
			for (let r = 0; r < rowspan; r++) {
				for (let c = 0; c < colspan; c++) {
					taken.add(`${rowIndex + r},${column + c}`)
				}
			}
			column += colspan
		}
		free()
		after.set(row, column)
		width = Math.max(width, column)
	})

	// `after` held each row's own width while measuring; turn it into the padding.
	for (const row of rows) {
		after.set(row, width - (after.get(row) ?? width))
	}
	return { width, before, after }
}

function cellsOf(row: Element): Element[] {
	return Array.from(row.children).filter((child) => child.nodeName === "TH" || child.nodeName === "TD")
}

function spanOf(cell: Element, attribute: "colspan" | "rowspan"): number {
	const value = Number.parseInt(cell.getAttribute(attribute) ?? "", 10)
	return Number.isFinite(value) && value > 0 ? value : 1
}
