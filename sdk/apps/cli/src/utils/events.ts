import type { AgentEvent, TeamEvent } from "@clinebot/core";
import { formatToolInput, formatToolOutput, truncate } from "./helpers";
import {
	c,
	emitJsonLine,
	formatUsd,
	getCurrentOutputMode,
	write,
	writeErr,
} from "./output";
import type { Config } from "./types";

// =============================================================================
// Inline stream state
// =============================================================================

let activeInlineStream: "text" | "reasoning" | undefined;
let inlineStreamHasOutput = false;
let shouldPrefixNextTextWithBlankLine = false;
const TEAM_RUN_ACTIVE_SUFFIX = `${c.dim} ...${c.reset}`;

export function resolveStatusNoticeLabel(
	event: AgentEvent,
): string | undefined {
	if (event.type !== "notice" || event.displayRole !== "status") {
		return undefined;
	}
	if (event.reason === "auto_compaction") {
		return "auto-compacting";
	}
	return event.message.trim() || undefined;
}

export function closeInlineStreamIfNeeded(): void {
	if (!inlineStreamHasOutput) {
		return;
	}
	write("\n");
	activeInlineStream = undefined;
	inlineStreamHasOutput = false;
}

// =============================================================================
// Agent event handler
// =============================================================================

// Prefix for assistant/tool dot rows: "⏺ "
const DOT = "⏺";
// Prefix for result rows
const HOOK = "⎿ ";

function formatResultLines(text: string, maxLines = 5): string[] {
	const lines = text.split("\n");
	if (lines.length <= maxLines) return lines;
	return [
		...lines.slice(0, maxLines),
		`... ${lines.length - maxLines} more lines`,
	];
}

export function handleEvent(event: AgentEvent, config: Config): void {
	if (getCurrentOutputMode() === "json") {
		emitJsonLine("stdout", { type: "agent_event", event });
		return;
	}

	switch (event.type) {
		case "iteration_start":
			closeInlineStreamIfNeeded();
			break;

		case "iteration_end":
			closeInlineStreamIfNeeded();
			break;

		case "content_start":
			switch (event.contentType) {
				case "text":
					if (activeInlineStream !== "text") {
						closeInlineStreamIfNeeded();
						if (shouldPrefixNextTextWithBlankLine) {
							write("\n");
							shouldPrefixNextTextWithBlankLine = false;
						}
						write(`${DOT} `);
						activeInlineStream = "text";
					}
					write(event.text ?? "");
					inlineStreamHasOutput = true;
					break;
				case "reasoning":
					if (activeInlineStream !== "reasoning") {
						closeInlineStreamIfNeeded();
						write(`${c.dim}${DOT} [thinking] ${c.reset}`);
						activeInlineStream = "reasoning";
						inlineStreamHasOutput = true;
					}
					if (event.redacted && !event.reasoning) {
						write(`${c.dim}[redacted]${c.reset}`);
						inlineStreamHasOutput = true;
						break;
					}
					write(`${c.dim}${event.reasoning ?? ""}${c.reset}`);
					inlineStreamHasOutput = true;
					break;
				case "tool": {
					closeInlineStreamIfNeeded();
					const toolName = event.toolName ?? "unknown_tool";
					const inputStr = formatToolInput(toolName, event.input);
					write(
						`${c.cyan}${DOT} [${toolName}]${c.reset}${inputStr ? ` ${inputStr}` : ""}\n`,
					);
					break;
				}
			}
			break;

		case "content_end":
			switch (event.contentType) {
				case "text":
				case "reasoning":
					closeInlineStreamIfNeeded();
					break;
				case "tool":
					closeInlineStreamIfNeeded();
					if (event.error) {
						write(
							`   ${c.gray}${HOOK}${c.reset}${c.red}error: ${event.error}${c.reset}\n`,
						);
					} else {
						const outputStr = formatToolOutput(event.output);
						if (outputStr) {
							const lines = formatResultLines(outputStr);
							for (let i = 0; i < lines.length; i++) {
								const prefix = i === 0 ? HOOK : "  ";
								write(
									`   ${c.gray}${prefix}${c.reset}${c.dim}${lines[i]}${c.reset}\n`,
								);
							}
						} else {
							write(`   ${c.gray}${HOOK}${c.reset}${c.green}ok${c.reset}\n`);
						}
					}
					shouldPrefixNextTextWithBlankLine = false;
					break;
			}
			break;

		case "done": {
			closeInlineStreamIfNeeded();
			if (config.verbose) {
				const iterations = event.iterations;
				const usage = event.usage;
				const isAborted = event.reason === "aborted";
				if (usage) {
					const costStr = formatUsd(usage.totalCost ?? 0);
					write(
						`\n${c.dim}── ${isAborted ? "aborted" : "finished"} in ${iterations} turns | ${costStr} | ${usage.inputTokens}/${usage.outputTokens} tokens used ──${c.reset}`,
					);
				} else {
					write(
						`\n${c.dim}── ${isAborted ? "aborted" : "finished"}: ${event.reason} (${iterations} iterations) ──${c.reset}`,
					);
				}
			}
			activeInlineStream = undefined;
			inlineStreamHasOutput = false;
			shouldPrefixNextTextWithBlankLine = false;
			break;
		}
		case "error":
			closeInlineStreamIfNeeded();
			if (!event.recoverable || config.verbose) {
				writeErr(event.error.message);
			}
			break;
		case "notice":
			if (event.displayRole === "status") {
				closeInlineStreamIfNeeded();
				const label = resolveStatusNoticeLabel(event);
				if (label) {
					write(`\n${c.dim}[status]${c.reset} ${label}\n`);
				}
			}
			break;
	}
}

// =============================================================================
// Team event handler
// =============================================================================

export function handleTeamEvent(event: TeamEvent): void {
	if (getCurrentOutputMode() === "json") {
		emitJsonLine("stdout", { type: "team_event", event });
		return;
	}
	// Skip heartbeat events to avoid cluttering the CLI with too many messages,
	// since they can be emitted frequently during long-running tasks.
	if (event.type === "run_progress" && event.message === "heartbeat") {
		return;
	}

	closeInlineStreamIfNeeded();

	switch (event.type) {
		case "teammate_spawned":
			write(
				`${c.dim}[team] teammate spawned:${c.reset} ${c.cyan}${event.agentId}${c.reset}\n`,
			);
			break;
		case "teammate_shutdown":
			write(
				`${c.dim}[team] teammate shutdown:${c.reset} ${c.cyan}${event.agentId}${c.reset}\n`,
			);
			break;
		case "team_task_updated":
			write(
				`${c.dim}[team task]${c.reset} ${c.cyan}${event.task.id}${c.reset} -> ${event.task.status}\n`,
			);
			break;
		case "team_message":
			write(
				`${c.dim}[mailbox]${c.reset} ${event.message.fromAgentId} -> ${event.message.toAgentId}: ${event.message.subject}\n`,
			);
			break;
		case "team_mission_log":
			write(
				`${c.dim}[mission]${c.reset} ${event.entry.agentId}: ${truncate(event.entry.summary, 90)}\n`,
			);
			break;
		case "run_queued":
			write(
				`${c.dim}[team run]${c.reset} queued ${c.cyan}${event.run.id}${c.reset} -> ${event.run.agentId}${TEAM_RUN_ACTIVE_SUFFIX}\n`,
			);
			break;
		case "run_started":
			write(
				`${c.dim}[team run]${c.reset} started ${c.cyan}${event.run.id}${c.reset} -> ${event.run.agentId}${TEAM_RUN_ACTIVE_SUFFIX}\n`,
			);
			break;
		case "run_progress":
			write(
				`${c.dim}[team run]${c.reset} progress ${c.cyan}${event.run.id}${c.reset}: ${event.message}\n`,
			);
			break;
		case "run_completed":
			write(
				`${c.dim}[team run]${c.reset} completed ${c.cyan}${event.run.id}${c.reset}\n`,
			);
			break;
		case "run_failed":
			write(
				`${c.dim}[team run]${c.reset} failed ${c.cyan}${event.run.id}${c.reset}: ${event.run.error ?? "unknown error"}\n`,
			);
			break;
		case "run_cancelled":
			write(
				`${c.dim}[team run]${c.reset} cancelled ${c.cyan}${event.run.id}${c.reset}\n`,
			);
			break;
		case "run_interrupted":
			write(
				`${c.dim}[team run]${c.reset} interrupted ${c.cyan}${event.run.id}${c.reset}\n`,
			);
			break;
		case "outcome_created":
			write(
				`${c.dim}[team outcome]${c.reset} created ${c.cyan}${event.outcome.id}${c.reset}: ${event.outcome.title}\n`,
			);
			break;
		case "outcome_fragment_attached":
			write(
				`${c.dim}[team outcome]${c.reset} fragment ${c.cyan}${event.fragment.id}${c.reset} attached to ${event.fragment.section}\n`,
			);
			break;
		case "outcome_fragment_reviewed":
			write(
				`${c.dim}[team outcome]${c.reset} fragment ${c.cyan}${event.fragment.id}${c.reset} -> ${event.fragment.status}\n`,
			);
			break;
		case "outcome_finalized":
			write(
				`${c.dim}[team outcome]${c.reset} finalized ${c.cyan}${event.outcome.id}${c.reset}\n`,
			);
			break;
		case "task_start":
			break;
		case "task_end":
			break;
		case "agent_event":
			break;
	}
}
