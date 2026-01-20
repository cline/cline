/**
 * Markdown Renderer
 *
 * Handles converting markdown text to terminal-formatted output
 * using the marked library with terminal-specific styling.
 */

import chalk from "chalk"
import { type MarkedExtension, marked } from "marked"
import { markedTerminal } from "marked-terminal"

// Configure marked with terminal renderer
// Note: @types/marked-terminal is outdated and returns wrong type, cast to MarkedExtension
marked.use(
	markedTerminal({
		heading: chalk.cyan.bold,
		firstHeading: chalk.magenta.bold.underline,
		strong: chalk.yellow.bold,
		em: chalk.blue.italic,
		codespan: chalk.greenBright,
	}) as unknown as MarkedExtension,
)

/**
 * Render markdown text to terminal-formatted output
 *
 * @param text - Markdown text to render
 * @returns Terminal-formatted string
 */
export function renderMarkdown(text: string): string {
	try {
		const rendered = marked.parse(text)
		// marked.parse returns string | Promise<string>, we only use sync mode
		return (typeof rendered === "string" ? rendered : text).trim()
	} catch {
		return text
	}
}
