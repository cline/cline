/**
 * Utility functions for handling markdown conversions and cleanup
 */

import { gfmStrikethroughToMarkdown } from "mdast-util-gfm-strikethrough"
import { gfmTableToMarkdown } from "mdast-util-gfm-table"
import { gfmTaskListItemToMarkdown } from "mdast-util-gfm-task-list-item"
import rehypeParse from "rehype-parse"
import rehypeRemark from "rehype-remark"
import remarkStringify from "remark-stringify"
import { unified } from "unified"

/**
 * Clean up markdown escape characters
 */
function cleanupMarkdownEscapes(markdown: string): string {
	return (
		markdown
			// Handle underscores and asterisks (single or multiple)
			.replace(/\\([_*]+)/g, "$1")

			// Handle angle brackets (for generics and XML)
			.replace(/\\([<>])/g, "$1")

			// Handle backticks (for code)
			.replace(/\\(`)/g, "$1")

			// Handle other common markdown special characters
			.replace(/\\([[\]()#.!])/g, "$1")

			// Fix multiple consecutive backslashes
			.replace(/\\{2,}([_*`<>[\]()#.!])/g, "$1")
	)
}

/**
 * rehype-remark emits GFM mdast nodes — `table` for <table>, `delete` for
 * <del>/<s>, `checked` list items for checkboxes — which the core
 * remark-stringify serializer has no handlers for, so copying such content
 * threw "Cannot handle unknown node `table`" (cline/cline#12832).
 *
 * This registers only the GFM node HANDLERS rather than the full remark-gfm
 * plugin: remark-gfm's serializer also adds escaping rules that would mangle
 * plain text commonly copied from chat (`user@example.com` ->
 * `user\@example.com`, `https://` -> `https\://`, `~/path` -> `\~/path`).
 * The strikethrough extension's `~` escaping rule is dropped for the same
 * reason; gfmTableToMarkdown's pipe escaping is kept because it is scoped to
 * table cells and required to produce valid tables.
 */
function gfmSerializers(this: any) {
	const data = this.data()
	const extensions = (data.toMarkdownExtensions = data.toMarkdownExtensions || [])
	extensions.push(gfmTableToMarkdown(), { handlers: gfmStrikethroughToMarkdown().handlers }, gfmTaskListItemToMarkdown())
}

/**
 * Convert HTML to Markdown
 */
export async function convertHtmlToMarkdown(html: string): Promise<string> {
	// Process the HTML to Markdown
	const result = await unified()
		.use(rehypeParse as any, { fragment: true }) // Parse HTML fragments
		.use(rehypeRemark as any) // Convert HTML to Markdown AST
		.use(gfmSerializers) // Serialize GFM nodes (tables, strikethrough, task lists)
		.use(remarkStringify as any, {
			// Convert Markdown AST to text
			bullet: "-", // Use - for unordered lists
			emphasis: "*", // Use * for emphasis
			strong: "_", // Use _ for strong
			listItemIndent: "one", // Use one space for list indentation
			rule: "-", // Use - for horizontal rules
			ruleSpaces: false, // No spaces in horizontal rules
			fences: true,
			escape: false,
			entities: false,
		})
		.process(html)

	const md = String(result)
	// Apply comprehensive cleanup of escape characters
	return cleanupMarkdownEscapes(md)
}
