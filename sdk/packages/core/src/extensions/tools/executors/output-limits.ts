/**
 * Shared caps for how much tool output may enter the conversation. Every
 * character returned by an executor is re-sent to the model on each
 * subsequent request, so oversized outputs cost quadratically over the
 * remaining run. Limits are measured in characters (UTF-16 code units),
 * which tracks token cost more closely than bytes and is what JS strings
 * measure exactly. Executors enforce these caps; tool descriptions
 * reference them so the model pages or narrows instead of retrying.
 *
 * Truncation notices always live in the preserved head/tail of an entry,
 * never in the elided middle, so they survive a later cut. Provider-request
 * building keeps its own backstop (session/services/message-builder.ts) above
 * these budgets, so an executor's own sizing stands.
 */

import { DEFAULT_CONTEXT_LIMITS } from "../../../settings/context-limits";

/**
 * Compile-time defaults. Each executor takes its effective cap from resolved
 * options at construction; these remain for callers that build an executor
 * without configuring one.
 */

/** Max characters of command output kept; beyond this the middle is elided. */
export const MAX_COMMAND_OUTPUT_CHARS =
	DEFAULT_CONTEXT_LIMITS.tool.commandOutputChars;

export function truncateCommandOutput(
	text: string,
	options: { maxChars?: number; totalChars?: number } = {},
): string {
	const maxChars = options.maxChars ?? MAX_COMMAND_OUTPUT_CHARS;
	const totalChars = options.totalChars ?? text.length;
	if (text.length <= maxChars && totalChars <= maxChars) {
		return text;
	}

	const headLimit = Math.ceil(maxChars / 2);
	const tailLimit = Math.max(1, maxChars - headLimit);
	return (
		`${text.slice(0, headLimit)}\n` +
		`[... output truncated: ${totalChars} chars total. ` +
		"Refine the command (grep, head, tail) to view the elided middle ...]\n" +
		text.slice(-tailLimit)
	);
}

/** Max lines returned per file read when the range is larger or absent. */
export const MAX_READ_LINES = DEFAULT_CONTEXT_LIMITS.tool.readLines;

/** Max characters kept per line in file reads (defangs minified files). */
export const MAX_LINE_CHARS = DEFAULT_CONTEXT_LIMITS.tool.lineChars;

/** Max characters returned per file read window. */
export const MAX_READ_OUTPUT_CHARS =
	DEFAULT_CONTEXT_LIMITS.tool.readOutputChars;

/** Max characters returned per search query; beyond this the middle is elided. */
export const MAX_SEARCH_OUTPUT_CHARS =
	DEFAULT_CONTEXT_LIMITS.tool.searchOutputChars;
