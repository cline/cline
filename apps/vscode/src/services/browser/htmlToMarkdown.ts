import TurndownService from "turndown"

// HTML clamps colspan to 1..1000, and a rowspan never reaches past its table.
const MAX_COLSPAN = 1000

// A span attribute on a fetched page must not be able to make the output, or
// the conversion, much larger than the page. So a table is padded out to a
// full grid only while the grid stays within a few cells per real cell, and
// never past MAX_GRID_CELLS; a table past that is written row by row, one
// column per cell, as if it had no spans.
const GRID_CELLS_PER_CELL = 8
const MIN_GRID_CELLS = 64
const MAX_GRID_CELLS = 40_000

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
			const before = " |".repeat(grid.before.get(node) ?? 0)
			const spanned = " |".repeat((grid.colspan.get(node) ?? 1) - 1)
			return `${before} ${cellText(content)} |${spanned}`
		},
	})

	turndownService.addRule("tableRow", {
		filter: "tr",
		replacement: (content, node) => {
			const grid = gridFor(node)
			const row = `|${content}${" |".repeat(grid.after.get(node) ?? 0)}`
			if (node !== grid.header) {
				return `\n${row}`
			}
			// A GFM table has to open with a header row, so the first row that has
			// cells becomes one. On a page written without <th> that is what it is.
			return `\n${row}\n|${" --- |".repeat(grid.headerWidth)}`
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
		// A row with no cells is blank to Turndown, which writes it as a blank
		// line instead of calling the row rule, and a blank line ends the table.
		replacement: (content) => `\n\n${content.trim().replace(/^(\|.*)\n\s*\n(?=\|)/gm, "$1\n")}\n\n`,
	})

	return turndownService.turndown(html)
}

function cellText(content: string): string {
	// Turndown writes a <br> as two spaces and a newline; the whole break folds
	// into one space, because a newline would end the row halfway through. This
	// splits instead of matching `\s*\n\s*`, which backtracks quadratically over
	// a long run of &nbsp; that no newline follows.
	return escapePipes(
		content
			.split(/\r?\n/)
			.map((line) => line.trim())
			.join(" ")
			.trim(),
	)
}

/**
 * A GFM row splits at a pipe preceded by an even number of backslashes, so
 * every pipe is left with an odd number. In text Turndown has already doubled
 * each backslash, so that is always one more; inside a code span it has not,
 * and `a\|b` there already has one.
 */
function escapePipes(text: string): string {
	const parts = text.split("|")
	for (let index = 0; index < parts.length - 1; index++) {
		const part = parts[index]
		let run = 0
		while (run < part.length && part[part.length - 1 - run] === "\\") {
			run++
		}
		if (run % 2 === 0) {
			parts[index] = `${part}\\`
		}
	}
	return parts.join("|")
}

function tableOf(node: Node): HTMLElement | null {
	let parent: Node | null = node.parentNode
	while (parent && parent.nodeName !== "TABLE") {
		parent = parent.parentNode
	}
	return (parent as HTMLElement) ?? null
}

interface TableGrid {
	/** The row the delimiter goes under: the first one that has cells. */
	header: Element | null
	headerWidth: number
	/** Empty cells a cell needs in front of it, because a rowspan holds those columns. */
	before: Map<Element, number>
	/** Columns a cell covers once its colspan is clamped. */
	colspan: Map<Element, number>
	/** Empty cells a row needs at its end, to reach the width of the widest row. */
	after: Map<Element, number>
}

type Layout = Omit<TableGrid, "header" | "headerWidth"> & { width: number }

const NOT_IN_A_TABLE: TableGrid = {
	header: null,
	headerWidth: 0,
	before: new Map(),
	colspan: new Map(),
	after: new Map(),
}

const grids = new WeakMap<Element, TableGrid>()

function gridFor(node: Element): TableGrid {
	const table = tableOf(node)
	if (!table) {
		return NOT_IN_A_TABLE
	}
	let grid = grids.get(table)
	if (!grid) {
		grid = measure(table)
		grids.set(table, grid)
	}
	return grid
}

function measure(table: Element): TableGrid {
	const rows = Array.from(table.querySelectorAll("tr")).filter((row) => tableOf(row) === table)
	const cells = rows.map(cellsOf)
	const headerIndex = cells.findIndex((rowCells) => rowCells.length > 0)
	const header = headerIndex >= 0 ? rows[headerIndex] : null

	const layout = layOut(rows, cells)
	if (layout) {
		return { header, headerWidth: layout.width, ...layout }
	}
	// Past the budget the spans are ignored, so a row is as wide as its own
	// cells. The header still has to reach the widest row, or the cells beyond
	// it fall out of the table. A shorter body row is fine as it is, because GFM
	// fills it with empty cells, and padding every row is exactly the growth the
	// budget exists to prevent.
	const width = cells.reduce((widest, rowCells) => Math.max(widest, rowCells.length), 0)
	const after = new Map<Element, number>()
	if (header) {
		after.set(header, width - cells[headerIndex].length)
	}
	return { header, headerWidth: width, before: new Map(), colspan: new Map(), after }
}

/**
 * Lay the table out on a grid the way a browser does, so spans take their
 * columns. Returns null once the grid would pass the table's budget.
 */
function layOut(rows: Element[], cells: Element[][]): Layout | null {
	const before = new Map<Element, number>()
	const colspan = new Map<Element, number>()
	const widths: number[] = []
	const taken = new Set<string>()
	const groupEnds = lastRowOfGroup(rows)
	let width = 0
	const realCells = cells.reduce((total, rowCells) => total + rowCells.length, 0)
	const budget = Math.min(MAX_GRID_CELLS, MIN_GRID_CELLS + GRID_CELLS_PER_CELL * realCells)

	for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
		let column = 0
		const free = (): number => {
			let skipped = 0
			while (taken.has(`${rowIndex},${column}`)) {
				column++
				skipped++
			}
			return skipped
		}
		for (const cell of cells[rowIndex]) {
			before.set(cell, free())
			const across = spanOf(cell, "colspan", MAX_COLSPAN)
			const down = rowspanOf(cell, groupEnds[rowIndex] - rowIndex + 1, rows.length - rowIndex)
			if (taken.size + across * down > budget) {
				return null
			}
			colspan.set(cell, across)
			for (let r = 0; r < down; r++) {
				for (let c = 0; c < across; c++) {
					taken.add(`${rowIndex + r},${column + c}`)
				}
			}
			column += across
		}
		// `column` is the width the row emits cells for. Trailing slots a rowspan
		// from above still claims widen the table, and become right-side padding.
		widths.push(column)
		free()
		width = Math.max(width, column)
	}

	// A row with no cells is never written, so only the others are padded.
	const writtenRows = cells.filter((rowCells) => rowCells.length > 0).length
	if (width * writtenRows > budget) {
		return null
	}
	const after = new Map<Element, number>()
	rows.forEach((row, index) => after.set(row, width - widths[index]))
	return { width, before, colspan, after }
}

function cellsOf(row: Element): Element[] {
	return Array.from(row.children).filter((child) => child.nodeName === "TH" || child.nodeName === "TD")
}

function spanOf(cell: Element, attribute: "colspan" | "rowspan", max: number): number {
	const value = Number.parseInt(cell.getAttribute(attribute) ?? "", 10)
	return Number.isFinite(value) && value > 0 ? Math.min(value, max) : 1
}

/**
 * `rowspan="0"` is not a span of zero rows: it reaches to the end of the cell's
 * row group, so the cell holds its column in every row left in that group. Any
 * other value is a span of its own, clamped to the rows left in the table.
 */
function rowspanOf(cell: Element, rowsLeftInGroup: number, rowsLeftInTable: number): number {
	// `Object.is`, because a leading "-" makes the value invalid and parsing
	// "-0" gives -0, which `=== 0` would take for a zero.
	if (Object.is(Number.parseInt(cell.getAttribute("rowspan") ?? "", 10), 0)) {
		return rowsLeftInGroup
	}
	return spanOf(cell, "rowspan", rowsLeftInTable)
}

/**
 * For each row, the index of the last row of its row group: its `<thead>`,
 * `<tbody>` or `<tfoot>`, or the table itself when the page wrote no group. The
 * rows of a group are consecutive, so a change of parent starts a new group.
 */
function lastRowOfGroup(rows: Element[]): number[] {
	const ends = new Array<number>(rows.length)
	for (let index = rows.length - 1; index >= 0; index--) {
		const sameGroup = index + 1 < rows.length && rows[index].parentNode === rows[index + 1].parentNode
		ends[index] = sameGroup ? ends[index + 1] : index
	}
	return ends
}
