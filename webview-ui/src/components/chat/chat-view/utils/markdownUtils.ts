/**
 * Utility functions for handling markdown conversions and cleanup
 */

import { unified } from "unified"
import remarkStringify from "remark-stringify"
import rehypeRemark from "rehype-remark"
import rehypeParse from "rehype-parse"

/**
 * Clean up markdown escape characters
 */
export function cleanupMarkdownEscapes(markdown: string): string {
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
 * Convert HTML to Markdown
 */
export async function convertHtmlToMarkdown(html: string): Promise<string> {
	// Process the HTML to Markdown
	const result = await unified()
		.use(rehypeParse as any, { fragment: true }) // Parse HTML fragments
		.use(rehypeRemark as any) // Convert HTML to Markdown AST
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
