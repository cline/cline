import { readFile } from "fs/promises"
import Parser, { Point, SyntaxNode, Tree, Query } from "tree-sitter"
import path from "path"
import { loadRequiredLanguageParsers } from "./languageParser"
import { commentRangeAtLine } from "./rangeHelpers" // you already have this
/* -----------------------------------------------------------
   Caching: one entry per absolute file path so repeated
   salvages in the same file don’t parse twice.
----------------------------------------------------------- */
interface CachedParse {
	code: string
	tree: Tree
	query: Query
}
const cache = new Map<string, CachedParse>()

async function getParsed(absPath: string): Promise<CachedParse | undefined> {
	let item = cache.get(absPath)
	if (item) return item

	const code = await readFile(absPath, "utf8")
	const ext = path.extname(absPath).slice(1) // "ts", "py", …

	const { parser, query } = (await loadRequiredLanguageParsers([absPath]))[ext] ?? {}

	if (!parser || !query) {
		console.warn(`[AST-Salvage]  No parser/query for .${ext}`)
		return
	}
	const tree = parser.parse(code)
	// Explicitly cast to Tree/Query via unknown to bridge incompatible types.
	const newItem: CachedParse = { code, tree: tree as unknown as Tree, query: query as unknown as Query }
	cache.set(absPath, newItem)
	return newItem
}

/* -----------------------------------------------------------
   Helper: convert byte index → Point {row,column}
----------------------------------------------------------- */
function byteToPoint(text: string, byteIndex: number): Point {
	const preceding = text.slice(0, byteIndex)
	const rows = preceding.split("\n")
	return { row: rows.length - 1, column: rows.at(-1)!.length }
}

/* -----------------------------------------------------------
   Helper: find nearest definition node around a Point.
   We rely ONLY on query captures whose names start with
   "name.definition" (used consistently across TS, JS, Python,
   Go, Rust, Ruby, PHP, … in GitHub’s tag queries).
----------------------------------------------------------- */
function nearestDefinitionNode(query: Query, tree: Tree, point: Point): SyntaxNode | undefined {
	const captures = query.captures(tree.rootNode)
	let best: SyntaxNode | undefined

	for (const { node, name } of captures) {
		if (!name.startsWith("name.definition")) continue
		const { row: s } = node.startPosition
		const { row: e } = node.endPosition
		if (s <= point.row && e >= point.row) {
			// We are inside this definition. Choose the *smallest* such node.
			if (!best || node.endIndex - node.startIndex < best.endIndex - best.startIndex) {
				best = node.parent ?? node
			}
		}
	}
	return best
}

/* -----------------------------------------------------------
   Extract a useful identifier from a SEARCH block in a
   language-agnostic way: we take the token just before '('
   or '.' or '='.
----------------------------------------------------------- */
function extractIdentifier(search: string): string | undefined {
	const m = search.match(/([a-zA-Z_][a-zA-Z0-9_]{2,})(?=\s*[.(=])/)
	if (!m) return
	const id = m[1]
	// generic keyword blacklist (safe default)
	const stop = new Set([
		"async",
		"await",
		"function",
		"def",
		"func",
		"if",
		"for",
		"while",
		"switch",
		"case",
		"return",
		"this",
		"super",
		"new",
	])
	return stop.has(id) ? undefined : id
}

/* -----------------------------------------------------------
   PUBLIC: generic AST-based salvage.
   Returns [startByte,endByte] or undefined.
----------------------------------------------------------- */
export async function astSalvage(
	absPath: string,
	search: string,
	original: string,
	fromIndex: number,
): Promise<[number, number] | undefined> {
	console.log("[AST-Salvage] start, fromIndex =", fromIndex)

	const parsed = await getParsed(absPath)
	if (!parsed) return
	const { code, tree, query } = parsed

	/* ---------- 1) Comment anchor ---------- */
	if (/^\s*(\/\/|\/\*|#|--|%|\{-[^-]*-})/.test(search)) {
		const trimmed = search.trim()
		const slice = original.slice(fromIndex)
		const relLineIdx = slice.split("\n").findIndex((l) => l.trim() === trimmed)
		if (relLineIdx !== -1) {
			const absoluteLine = original.slice(0, fromIndex).split("\n").length - 1 + relLineIdx
			console.log("[AST-Salvage] comment candidate line =", absoluteLine)
			const rng = await commentRangeAtLine(absPath, absoluteLine)
			if (rng && rng[0] >= fromIndex) {
				console.log("[AST-Salvage] ✓ matched comment anchor", rng)
				return rng
			}
		}
	}

	/* ---------- 2) Identifier / definition anchor ---------- */
	const id = extractIdentifier(search)
	if (id) {
		const pos = original.indexOf(id, fromIndex)
		if (pos !== -1) {
			const point = byteToPoint(original, pos)
			const defNode = nearestDefinitionNode(query, tree, point)
			if (defNode && defNode.startIndex >= fromIndex) {
				console.log("[AST-Salvage] ✓ matched definition anchor", defNode.type, [defNode.startIndex, defNode.endIndex])
				return [defNode.startIndex, defNode.endIndex]
			}
		}
	}

	console.log("[AST-Salvage]  failed to match")
	return
}
