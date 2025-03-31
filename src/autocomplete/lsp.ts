import { AutocompleteLanguageInfo } from "./constants/AutocompleteLanguageInfo"
import { getAst, getTreePathAtCursor } from "./util/ast"
import * as vscode from "vscode"

import type Parser from "web-tree-sitter"
import { GetLspDefinitionsFunction, RangeInFile, RangeInFileWithContents, Range } from "./types"
import { AutocompleteCodeSnippet, AutocompleteSnippetType } from "./snippets/types"
import * as URI from "uri-js"
import { readFile, readRangeInFile } from "../utils/vscode"
import { intersection } from "../utils/ranges"

type GotoProviderName =
	| "vscode.executeDefinitionProvider"
	| "vscode.executeTypeDefinitionProvider"
	| "vscode.executeDeclarationProvider"
	| "vscode.executeImplementationProvider"
	| "vscode.executeReferenceProvider"

interface GotoInput {
	uri: vscode.Uri
	line: number
	character: number
	name: GotoProviderName
}
function gotoInputKey(input: GotoInput) {
	return `${input.name}${input.uri.toString()}${input.line}${input.character}`
}

const FUNCTION_BLOCK_NODE_TYPES = ["block", "statement_block"]
const FUNCTION_DECLARATION_NODE_TYPEs = [
	"method_definition",
	"function_definition",
	"function_item",
	"function_declaration",
	"method_declaration",
]

const MAX_CACHE_SIZE = 500
const gotoCache = new Map<string, RangeInFile[]>()

export async function executeGotoProvider(input: GotoInput): Promise<RangeInFile[]> {
	const cacheKey = gotoInputKey(input)
	const cached = gotoCache.get(cacheKey)
	if (cached) {
		return cached
	}

	try {
		const definitions = (await vscode.commands.executeCommand(
			input.name,
			input.uri,
			new vscode.Position(input.line, input.character),
		)) as any

		const results = definitions
			.filter((d: any) => (d.targetUri || d.uri) && (d.targetRange || d.range))
			.map((d: any) => ({
				filepath: (d.targetUri || d.uri).toString(),
				range: d.targetRange || d.range,
			}))

		// Add to cache
		if (gotoCache.size >= MAX_CACHE_SIZE) {
			// Remove the oldest item from the cache
			const oldestKey = gotoCache.keys().next().value
			if (oldestKey) {
				gotoCache.delete(oldestKey)
			}
		}
		gotoCache.set(cacheKey, results)

		return results
	} catch (e) {
		console.warn(`Error executing ${input.name}:`, e)
		return []
	}
}

function isRifWithContents(rif: RangeInFile | RangeInFileWithContents): rif is RangeInFileWithContents {
	return typeof (rif as any).contents === "string"
}

function findChildren(
	node: Parser.SyntaxNode,
	predicate: (n: Parser.SyntaxNode) => boolean,
	firstN?: number,
): Parser.SyntaxNode[] {
	let matchingNodes: Parser.SyntaxNode[] = []

	if (firstN && firstN <= 0) {
		return []
	}

	// Check if the current node's type is in the list of types we're interested in
	if (predicate(node)) {
		matchingNodes.push(node)
	}

	// Recursively search for matching types in all children of the current node
	for (const child of node.children) {
		matchingNodes = matchingNodes.concat(findChildren(child, predicate, firstN ? firstN - matchingNodes.length : undefined))
	}

	return matchingNodes
}

function findTypeIdentifiers(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
	return findChildren(
		node,
		(childNode) =>
			childNode.type === "type_identifier" ||
			(["ERROR"].includes(childNode.parent?.type ?? "") &&
				childNode.type === "identifier" &&
				childNode.text[0].toUpperCase() === childNode.text[0]),
	)
}

async function crawlTypes(
	rif: RangeInFile | RangeInFileWithContents,
	depth: number = 1,
	results: RangeInFileWithContents[] = [],
	searchedLabels: Set<string> = new Set(),
): Promise<RangeInFileWithContents[]> {
	// Get the file contents if not already attached
	const contents = isRifWithContents(rif) ? rif.contents : await readFile(rif.filepath)

	// Parse AST
	const ast = await getAst(rif.filepath, contents)
	if (!ast) {
		return results
	}
	const astLineCount = ast.rootNode.text.split("\n").length

	// Find type identifiers
	const identifierNodes = findTypeIdentifiers(ast.rootNode).filter((node) => !searchedLabels.has(node.text))
	// Don't search for the same type definition more than once
	// We deduplicate below to be sure, but this saves calls to the LSP
	identifierNodes.forEach((node) => searchedLabels.add(node.text))

	// Use LSP to get the definitions of those types
	const definitions = []

	for (const node of identifierNodes) {
		const [typeDef] = await executeGotoProvider({
			uri: vscode.Uri.parse(rif.filepath),
			// TODO: tree-sitter is zero-indexed, but there seems to be an off-by-one
			// error at least with the .ts parser sometimes
			line: rif.range.start.line + Math.min(node.startPosition.row, astLineCount - 1),
			character: rif.range.start.character + node.startPosition.column,
			name: "vscode.executeDefinitionProvider",
		})

		if (!typeDef) {
			definitions.push(undefined)
			continue
		}

		const contents = await readRangeInFile(typeDef.filepath, typeDef.range)

		definitions.push({
			...typeDef,
			contents,
		})
	}

	// TODO: Filter out if not in our code?

	// Filter out duplicates
	for (const definition of definitions) {
		if (
			!definition ||
			results.some(
				(result) =>
					URI.equal(result.filepath, definition.filepath) && intersection(result.range, definition.range) !== null,
			)
		) {
			continue // ;)
		}
		results.push(definition)
	}

	// Recurse
	if (depth > 0) {
		for (const result of [...results]) {
			await crawlTypes(result, depth - 1, results, searchedLabels)
		}
	}

	return results
}

export async function getDefinitionsForNode(
	uri: vscode.Uri,
	node: Parser.SyntaxNode,
	lang: AutocompleteLanguageInfo,
): Promise<RangeInFileWithContents[]> {
	const ranges: (RangeInFile | RangeInFileWithContents)[] = []
	switch (node.type) {
		case "call_expression": {
			// function call -> function definition
			const [funDef] = await executeGotoProvider({
				uri,
				line: node.startPosition.row,
				character: node.startPosition.column,
				name: "vscode.executeDefinitionProvider",
			})
			if (!funDef) {
				return []
			}

			// Don't display a function of more than 15 lines
			// We can of course do something smarter here eventually
			let funcText = await readRangeInFile(funDef.filepath, funDef.range)
			if (funcText.split("\n").length > 15) {
				let truncated = false
				const funRootAst = await getAst(funDef.filepath, funcText)
				if (funRootAst) {
					const [funNode] = findChildren(
						funRootAst?.rootNode,
						(node) => FUNCTION_DECLARATION_NODE_TYPEs.includes(node.type),
						1,
					)
					if (funNode) {
						const [statementBlockNode] = findChildren(
							funNode,
							(node) => FUNCTION_BLOCK_NODE_TYPES.includes(node.type),
							1,
						)
						if (statementBlockNode) {
							funcText = funRootAst.rootNode.text.slice(0, statementBlockNode.startIndex).trim()
							truncated = true
						}
					}
				}
				if (!truncated) {
					funcText = funcText.split("\n")[0]
				}
			}

			ranges.push(funDef)

			const typeDefs = await crawlTypes({
				...funDef,
				contents: funcText,
			})
			ranges.push(...typeDefs)
			break
		}
		case "variable_declarator":
			// variable assignment -> variable definition/type
			// usages of the var that appear after the declaration
			break
		case "impl_item":
			// impl of trait -> trait definition
			break
		case "new_expression":
			// In 'new MyClass(...)', "MyClass" is the classNameNode
			const classNameNode = node.children.find((child) => child.type === "identifier")
			const [classDef] = await executeGotoProvider({
				uri,
				line: (classNameNode ?? node).endPosition.row,
				character: (classNameNode ?? node).endPosition.column,
				name: "vscode.executeDefinitionProvider",
			})
			if (!classDef) {
				break
			}
			const contents = await readRangeInFile(classDef.filepath, classDef.range)

			ranges.push({
				...classDef,
				contents: `${classNameNode?.text ? `${lang.singleLineComment} ${classNameNode.text}:\n` : ""}${contents.trim()}`,
			})

			const definitions = await crawlTypes({ ...classDef, contents })
			ranges.push(...definitions.filter(Boolean))

			break
		case "":
			// function definition -> implementations?
			break
	}
	return await Promise.all(
		ranges.map(async (rif) => {
			// Convert the VS Code Range type to ours
			const range: Range = {
				start: {
					line: rif.range.start.line,
					character: rif.range.start.character,
				},
				end: {
					line: rif.range.end.line,
					character: rif.range.end.character,
				},
			}
			rif.range = range

			if (!isRifWithContents(rif)) {
				return {
					...rif,
					contents: await readRangeInFile(rif.filepath, rif.range),
				}
			}
			return rif
		}),
	)
}

/**
 * and other stuff not directly on the path:
 * - variables defined on line above
 * ...etc...
 */

export const getDefinitionsFromLsp: GetLspDefinitionsFunction = async (
	filepath: string,
	contents: string,
	cursorIndex: number,
	lang: AutocompleteLanguageInfo,
): Promise<AutocompleteCodeSnippet[]> => {
	try {
		const ast = await getAst(filepath, contents)
		if (!ast) {
			return []
		}

		const treePath = await getTreePathAtCursor(ast, cursorIndex)
		if (!treePath) {
			return []
		}

		const results: RangeInFileWithContents[] = []
		for (const node of treePath.reverse()) {
			const definitions = await getDefinitionsForNode(vscode.Uri.parse(filepath), node, lang)
			results.push(...definitions)
		}

		return results.map((result) => ({
			filepath: result.filepath,
			content: result.contents,
			type: AutocompleteSnippetType.Code,
		}))
	} catch (e) {
		console.warn("Error getting definitions from LSP: ", e)
		return []
	}
}
