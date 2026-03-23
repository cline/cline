import type { AgentEvent, TeamEvent } from "@clinebot/agents";
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
			if (!event.hadToolCalls) {
				// write(`\n\n${c.dim}(no tools called, done)${c.reset}\n`)
			}
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
						activeInlineStream = "text";
					}
					write(event.text ?? "");
					inlineStreamHasOutput = true;
					break;
				case "reasoning":
					if (activeInlineStream !== "reasoning") {
						closeInlineStreamIfNeeded();
						write(`${c.dim}[thinking] ${c.reset}`);
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
						`${c.dim}[${toolName}]${c.reset} ${c.cyan}${inputStr}${c.reset}`,
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
						write(` ${c.red}error: ${event.error}${c.reset}\n`);
					} else {
						const outputStr = formatToolOutput(event.output);
						if (outputStr) {
							write(`  ${c.dim}-> ${outputStr}${c.reset}\n`);
						} else {
							write(` ${c.green}ok${c.reset}\n`);
						}
					}
					shouldPrefixNextTextWithBlankLine = true;
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
			writeErr(event.error.message);
			break;
		case "notice":
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

	switch (event.type) {
		case "teammate_spawned":
			write(
				`\n${c.dim}[team] teammate spawned:${c.reset} ${c.cyan}${event.agentId}${c.reset}`,
			);
			break;
		case "teammate_shutdown":
			write(
				`\n${c.dim}[team] teammate shutdown:${c.reset} ${c.cyan}${event.agentId}${c.reset}`,
			);
			break;
		case "team_task_updated":
			write(
				`\n${c.dim}[team task]${c.reset} ${c.cyan}${event.task.id}${c.reset} -> ${event.task.status}`,
			);
			break;
		case "team_message":
			write(
				`\n${c.dim}[mailbox]${c.reset} ${event.message.fromAgentId} -> ${event.message.toAgentId}: ${event.message.subject}`,
			);
			break;
		case "team_mission_log":
			write(
				`\n${c.dim}[mission]${c.reset} ${event.entry.agentId}: ${truncate(event.entry.summary, 90)}`,
			);
			break;
		case "run_queued":
			write(
				`\n${c.dim}[team run]${c.reset} queued ${c.cyan}${event.run.id}${c.reset} -> ${event.run.agentId}`,
			);
			break;
		case "run_started":
			write(
				`\n${c.dim}[team run]${c.reset} started ${c.cyan}${event.run.id}${c.reset} -> ${event.run.agentId}`,
			);
			break;
		case "run_progress":
			write(
				`\n${c.dim}[team run]${c.reset} progress ${c.cyan}${event.run.id}${c.reset}: ${event.message}`,
			);
			break;
		case "run_completed":
			write(
				`\n${c.dim}[team run]${c.reset} completed ${c.cyan}${event.run.id}${c.reset}`,
			);
			break;
		case "run_failed":
			write(
				`\n${c.dim}[team run]${c.reset} failed ${c.cyan}${event.run.id}${c.reset}: ${event.run.error ?? "unknown error"}`,
			);
			break;
		case "run_cancelled":
			write(
				`\n${c.dim}[team run]${c.reset} cancelled ${c.cyan}${event.run.id}${c.reset}`,
			);
			break;
		case "run_interrupted":
			write(
				`\n${c.dim}[team run]${c.reset} interrupted ${c.cyan}${event.run.id}${c.reset}`,
			);
			break;
		case "outcome_created":
			write(
				`\n${c.dim}[team outcome]${c.reset} created ${c.cyan}${event.outcome.id}${c.reset}: ${event.outcome.title}`,
			);
			break;
		case "outcome_fragment_attached":
			write(
				`\n${c.dim}[team outcome]${c.reset} fragment ${c.cyan}${event.fragment.id}${c.reset} attached to ${event.fragment.section}`,
			);
			break;
		case "outcome_fragment_reviewed":
			write(
				`\n${c.dim}[team outcome]${c.reset} fragment ${c.cyan}${event.fragment.id}${c.reset} -> ${event.fragment.status}`,
			);
			break;
		case "outcome_finalized":
			write(
				`\n${c.dim}[team outcome]${c.reset} finalized ${c.cyan}${event.outcome.id}${c.reset}`,
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
