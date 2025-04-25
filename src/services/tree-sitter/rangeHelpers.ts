import { readFile } from "fs/promises"
// Corrected import to use the installed web-tree-sitter package
import Parser, { Point, SyntaxNode, Tree } from "web-tree-sitter"
import { loadRequiredLanguageParsers } from "./languageParser"

/**
 * Represents a start and end byte offset within a file.
 */
export type ByteRange = [number, number]

// Optional: Cache for parsed trees to improve performance on repeated calls for the same file
const treeCache = new Map<string, { parser: Parser; tree: Tree }>()

/**
 * Finds the byte range [startIndex, endIndex] of the smallest enclosing function
 * or method definition that contains the given source code position.
 *
 * @param absPath Absolute path to the file.
 * @param pos The position (row, column) within the file.
 * @returns A Promise resolving to the ByteRange [startIndex, endIndex] or undefined if not found or parser unavailable.
 */
export async function enclosingFunctionRange(absPath: string, pos: Point): Promise<ByteRange | undefined> {
	const code = await readFile(absPath, "utf8")
	const ext = absPath.split(".").pop()!
	const { parser } = (await loadRequiredLanguageParsers([absPath]))[ext] ?? {}
	if (!parser) return undefined // Return if no parser is available for the language

	// Optional: Use cached tree if available
	// let tree = treeCache.get(absPath)?.tree;
	// if (!tree || tree.getText() !== code) { // Re-parse if code changed or not cached
	//   tree = parser.parse(code);
	//   treeCache.set(absPath, { parser, tree });
	// }
	const tree = parser.parse(code) // Using direct parse for simplicity based on provided snippet

	// Find the deepest node at the given position
	let node: SyntaxNode | null = tree.rootNode.descendantForPosition(pos)

	// Traverse up the tree until a function-like node type is found
	while (node && !isFunc(node.type)) {
		node = node.parent
	}

	// Return the start and end byte indices of the found function node
	return node ? [node.startIndex, node.endIndex] : undefined
}

/**
 * Helper function to check if a Tree-sitter node type corresponds to a
 * function or method definition across common languages.
 *
 * @param nodeType The string type of the SyntaxNode.
 * @returns True if the type represents a function or method, false otherwise.
 */
function isFunc(nodeType: string): boolean {
	// Common node types representing functions/methods in various languages
	return [
		"function", // JS/TS arrow function, Go func
		"function_declaration", // JS/TS, C, C++, Java, PHP
		"function_definition", // C, C++
		"method_definition", // JS/TS, Python, Ruby, Java
		"arrow_function", // JS/TS
		"function_signature", // Sometimes used in type definitions or interfaces
		"function_item", // Rust
		"lambda_expression", // Java, C#
	].includes(nodeType)
}

/**
 * Finds the byte range [startIndex, endIndex] of a comment node that
 * fully contains the specified zero-based line number.
 *
 * @param absPath Absolute path to the file.
 * @param zeroBasedLine The zero-based line number to check for a comment.
 * @returns A Promise resolving to the ByteRange [startIndex, endIndex] of the comment or undefined if not found.
 */
export async function commentRangeAtLine(absPath: string, zeroBasedLine: number): Promise<ByteRange | undefined> {
	const code = await readFile(absPath, "utf8")
	const ext = absPath.split(".").pop()!
	const { parser } = (await loadRequiredLanguageParsers([absPath]))[ext] ?? {}
	if (!parser) return undefined

	// Optional: Use cached tree
	// let tree = treeCache.get(absPath)?.tree;
	// if (!tree || tree.getText() !== code) {
	//   tree = parser.parse(code);
	//   treeCache.set(absPath, { parser, tree });
	// }
	const tree = parser.parse(code)

	// Target a point at the beginning of the specified line
	const linePoint: Point = { row: zeroBasedLine, column: 0 }
	// Find the node that covers the start of the line
	const node = tree.rootNode.descendantForPosition(linePoint, linePoint) // Find node containing the start point
	if (!node) return undefined

	// Traverse up from the found node to find an enclosing comment node
	let commentNode: SyntaxNode | null = node
	while (commentNode && commentNode.type !== "comment") {
		commentNode = commentNode.parent
	}

	// Return the start and end byte indices of the found comment node
	return commentNode ? [commentNode.startIndex, commentNode.endIndex] : undefined
}

/**
 * Converts a zero-based byte index within a text string into a
 * Tree-sitter Point {row, column}.
 *
 * @param text The text content.
 * @param byteIndex The zero-based byte index.
 * @returns A Point object {row: number, column: number}.
 */
export function byteIndexToPoint(text: string, byteIndex: number): Point {
	// Get the portion of the text before the index
	const textBeforeIndex = text.slice(0, byteIndex)
	// Split into lines
	const lines = textBeforeIndex.split("\n")
	// Row is the number of lines minus 1 (zero-based)
	const row = lines.length - 1
	// Column is the length of the last line
	const column = lines[row].length
	return { row, column }
}
