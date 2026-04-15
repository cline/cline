/**
 * Structured chat message rendering for the interactive TUI.
 *
 * Renders agent conversation entries using the Claude Code style:
 *   ❯  user messages
 *   ⏺  assistant text / tool calls (with spinner while streaming)
 *   ⎿  tool results / indented detail rows
 */

import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import React from "react";
import { formatToolInput, formatToolOutput } from "../../utils/helpers";

// ---------------------------------------------------------------------------
// ChatEntry — discriminated union of all renderable message types
// ---------------------------------------------------------------------------

export type ChatEntry =
	| { kind: "user"; text: string }
	| { kind: "assistant_text"; text: string; streaming: boolean }
	| { kind: "reasoning"; text: string; streaming: boolean }
	| {
			kind: "tool_start";
			toolName: string;
			inputSummary: string;
			streaming: boolean;
	  }
	| { kind: "tool_end"; outputSummary: string; error?: string }
	| { kind: "error"; text: string }
	| { kind: "status"; text: string }
	| { kind: "team"; text: string }
	| { kind: "user_submitted"; text: string; delivery?: "queue" | "steer" }
	| {
			kind: "done";
			tokens: number;
			cost: number;
			elapsed: string;
			iterations: number;
	  };

// ---------------------------------------------------------------------------
// Helper layout components
// ---------------------------------------------------------------------------

/**
 * Two-column row with a leading ⏺ bullet (or spinner while streaming).
 */
function DotRow(
	props: React.PropsWithChildren<{ color?: string; spinning?: boolean }>,
): React.ReactElement {
	const { children, color, spinning = false } = props;
	return React.createElement(
		Box,
		{ flexDirection: "row" },
		React.createElement(
			Box,
			{ width: 2 },
			spinning
				? React.createElement(
						Text,
						{ color },
						React.createElement(Spinner, { type: "toggle8" }),
					)
				: React.createElement(Text, { color }, "⏺"),
		),
		React.createElement(Box, { flexGrow: 1 }, children),
	);
}

/**
 * Two-column row with a leading ⎿ for the first result line,
 * or two spaces for continuation lines.
 */
function ResultRow(
	props: React.PropsWithChildren<{ isFirst?: boolean }>,
): React.ReactElement {
	const { children, isFirst } = props;
	return React.createElement(
		Box,
		{ flexDirection: "row" },
		React.createElement(
			Box,
			{ width: 3 },
			React.createElement(Text, { color: "gray" }, isFirst ? "⎿ " : "  "),
		),
		React.createElement(Box, { flexGrow: 1 }, children),
	);
}

// ---------------------------------------------------------------------------
// Truncate multi-line output to at most N lines
// ---------------------------------------------------------------------------

function formatLines(text: string, maxLines = 5): string[] {
	const lines = text.split("\n");
	if (lines.length <= maxLines) return lines;
	return [
		...lines.slice(0, maxLines),
		`... ${lines.length - maxLines} more lines`,
	];
}

// ---------------------------------------------------------------------------
// ChatEntryView — renders a single ChatEntry
// ---------------------------------------------------------------------------

export const ChatEntryView: React.FC<{ entry: ChatEntry }> = ({ entry }) => {
	switch (entry.kind) {
		// ── User prompt (submitted) ──────────────────────────────────────────
		case "user_submitted": {
			const prefix =
				entry.delivery === "steer"
					? React.createElement(Text, { color: "yellow" }, "[steer] ")
					: entry.delivery === "queue"
						? React.createElement(
								Text,
								{ color: "gray", dimColor: true },
								"[queued] ",
							)
						: null;
			return React.createElement(
				Box,
				{ flexDirection: "row", marginBottom: 1 },
				React.createElement(Text, { color: "green" }, "❯ "),
				prefix,
				React.createElement(Text, null, entry.text),
			);
		}

		// ── User message in history (e.g. loaded from session) ──────────────
		case "user": {
			return React.createElement(
				Box,
				{ flexDirection: "row", marginBottom: 1 },
				React.createElement(Text, { color: "green" }, "❯ "),
				React.createElement(Text, null, entry.text),
			);
		}

		// ── Assistant text stream ────────────────────────────────────────────
		case "assistant_text": {
			if (!entry.text.trim()) return null;
			return React.createElement(
				Box,
				{ flexDirection: "column", marginBottom: 1, width: "100%" },
				React.createElement(
					DotRow,
					{ spinning: entry.streaming },
					React.createElement(Text, { wrap: "wrap" }, entry.text),
				),
			);
		}

		// ── Reasoning / thinking ────────────────────────────────────────────
		case "reasoning": {
			if (!entry.text.trim()) return null;
			return React.createElement(
				Box,
				{ flexDirection: "column", marginBottom: 1, width: "100%" },
				React.createElement(
					DotRow,
					{ color: "gray", spinning: entry.streaming },
					React.createElement(
						Text,
						{ color: "gray", dimColor: true, wrap: "wrap" },
						`[thinking] ${entry.text}`,
					),
				),
			);
		}

		// ── Tool call in progress ────────────────────────────────────────────
		case "tool_start": {
			return React.createElement(
				Box,
				{ flexDirection: "column", marginBottom: 1, width: "100%" },
				React.createElement(
					DotRow,
					{ color: "cyan", spinning: entry.streaming },
					React.createElement(
						Text,
						null,
						React.createElement(Text, { color: "cyan" }, `[${entry.toolName}]`),
						entry.inputSummary
							? React.createElement(Text, null, ` ${entry.inputSummary}`)
							: null,
					),
				),
			);
		}

		// ── Tool result ──────────────────────────────────────────────────────
		case "tool_end": {
			if (entry.error) {
				return React.createElement(
					Box,
					{
						flexDirection: "column",
						marginBottom: 1,
						paddingLeft: 2,
						width: "100%",
					},
					React.createElement(
						ResultRow,
						{ isFirst: true },
						React.createElement(
							Text,
							{ color: "red" },
							`error: ${entry.error}`,
						),
					),
				);
			}
			if (!entry.outputSummary) {
				return React.createElement(
					Box,
					{
						flexDirection: "column",
						marginBottom: 1,
						paddingLeft: 2,
						width: "100%",
					},
					React.createElement(
						ResultRow,
						{ isFirst: true },
						React.createElement(Text, { color: "green" }, "ok"),
					),
				);
			}
			const lines = formatLines(entry.outputSummary, 5);
			return React.createElement(
				Box,
				{
					flexDirection: "column",
					marginBottom: 1,
					paddingLeft: 2,
					width: "100%",
				},
				...lines.map((line, idx) =>
					React.createElement(
						ResultRow,
						{ key: idx, isFirst: idx === 0 },
						React.createElement(Text, { color: "gray" }, line),
					),
				),
			);
		}

		// ── Error ────────────────────────────────────────────────────────────
		case "error": {
			return React.createElement(
				Box,
				{ flexDirection: "column", marginBottom: 1, width: "100%" },
				React.createElement(
					DotRow,
					{ color: "red" },
					React.createElement(
						Text,
						{ color: "red", wrap: "wrap" },
						React.createElement(Text, { bold: true }, "Error"),
						`: ${entry.text}`,
					),
				),
			);
		}

		// ── Status / notice ──────────────────────────────────────────────────
		case "status": {
			return React.createElement(
				Box,
				{ flexDirection: "column", marginBottom: 1, width: "100%" },
				React.createElement(
					DotRow,
					{ color: "gray" },
					React.createElement(
						Text,
						{ color: "gray", dimColor: true },
						`[status] ${entry.text}`,
					),
				),
			);
		}

		// ── Team event ───────────────────────────────────────────────────────
		case "team": {
			return React.createElement(
				Box,
				{ flexDirection: "column", marginBottom: 1, width: "100%" },
				React.createElement(
					DotRow,
					{ color: "gray" },
					React.createElement(
						Text,
						{ color: "gray", dimColor: true },
						entry.text,
					),
				),
			);
		}

		// ── Turn summary (done) ──────────────────────────────────────────────
		case "done": {
			const parts: string[] = [];
			if (entry.elapsed) parts.push(`${entry.elapsed}s`);
			if (entry.tokens > 0)
				parts.push(`${entry.tokens.toLocaleString()} tokens`);
			if (entry.cost > 0) parts.push(`$${entry.cost.toFixed(3)} est. cost`);
			if (entry.iterations > 1) parts.push(`${entry.iterations} iterations`);
			if (parts.length === 0) return null;
			return React.createElement(
				Box,
				{ flexDirection: "column", marginBottom: 1, width: "100%" },
				React.createElement(
					Box,
					{ flexDirection: "row" },
					React.createElement(Box, { width: 2 }),
					React.createElement(
						Text,
						{ color: "gray", dimColor: true },
						`[${parts.join(" | ")}]`,
					),
				),
			);
		}

		default:
			return null;
	}
};

// ---------------------------------------------------------------------------
// ChatMessageList — renders a list of ChatEntry objects
// ---------------------------------------------------------------------------

export const ChatMessageList: React.FC<{
	entries: ChatEntry[];
	maxVisible?: number;
}> = ({ entries, maxVisible }) => {
	const visible = maxVisible ? entries.slice(-maxVisible) : entries;
	return React.createElement(
		Box,
		{ flexDirection: "column" },
		...visible.map((entry, idx) =>
			React.createElement(ChatEntryView, { key: idx, entry }),
		),
	);
};

// ---------------------------------------------------------------------------
// Helpers for building ChatEntry objects from AgentEvent data
// ---------------------------------------------------------------------------

export function makeToolStartEntry(
	toolName: string,
	input: unknown,
	streaming: boolean,
): ChatEntry {
	return {
		kind: "tool_start",
		toolName,
		inputSummary: formatToolInput(toolName, input),
		streaming,
	};
}

export function makeToolEndEntry(output: unknown, error?: string): ChatEntry {
	if (error) {
		return { kind: "tool_end", outputSummary: "", error };
	}
	return { kind: "tool_end", outputSummary: formatToolOutput(output) };
}
