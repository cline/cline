import type { AgentEvent, TeamEvent } from "@cline/core";
import { StreamAssembler } from "@cline/core";
import { AgentEventFramer, type StreamFrame } from "@cline/shared";
import { truncate } from "./helpers";
import { c, emitJsonLine, getCurrentOutputMode, write, writeErr } from "./output";
import { CliFrameRenderer, resolveFrameStatusLabel } from "./frame-renderer";
import type { Config } from "./types";

// =============================================================================
// Agent event stream (v2 frames)
// =============================================================================
//
// The inline CLI renderer now consumes v2 frames: every v1 event is
// framed (AgentEventFramer) and parsed (StreamAssembler) into the
// CliFrameRenderer, whose sinks hold only visual state. The v1 switch
// and its module-level parser state are gone from production; the
// extracted v1 logic lives in agent-renderer-v1.reference.ts as the
// differential-test baseline and is deleted in Phase 5.
//
// The framer/assembler/renderer are per-process singletons: one
// terminal, one stream. JSON mode is unchanged — it emits the v1
// event verbatim, which is the machine contract.

let stream: {
	framer: AgentEventFramer;
	assembler: StreamAssembler;
	renderer: CliFrameRenderer;
} | undefined;

function ensureStream(config: Config): {
	framer: AgentEventFramer;
	assembler: StreamAssembler;
	renderer: CliFrameRenderer;
} {
	if (stream === undefined) {
		const renderer = new CliFrameRenderer(
			{ verbose: config.verbose, modelId: config.modelId },
			{ write, writeErr },
		);
		stream = {
			framer: new AgentEventFramer(),
			assembler: new StreamAssembler(renderer),
			renderer,
		};
	}
	return stream;
}

export function handleEvent(event: AgentEvent, config: Config): void {
	if (getCurrentOutputMode() === "json") {
		emitJsonLine("stdout", { type: "agent_event", event });
		return;
	}
	const { framer, assembler } = ensureStream(config);
	const frames: StreamFrame[] = framer.frameEvent(event);
	assembler.pushAll(frames);
}

/** Kept for external callers (hooks.ts) and the team handler below. */
export function closeInlineStreamIfNeeded(): void {
	stream?.renderer.closeInlineStreamIfNeeded();
}

/**
 * v1-event adapter over the frame-path label logic, kept for callers
 * holding v1 notice events (the existing tests and any external user).
 */
export function resolveStatusNoticeLabel(
	event: AgentEvent,
): string | undefined {
	if (event.type !== "notice") {
		return undefined;
	}
	return resolveFrameStatusLabel({
		kind: "notice",
		noticeType: event.noticeType,
		...(event.message !== undefined ? { message: event.message } : {}),
		...(event.displayRole !== undefined
			? { displayRole: event.displayRole }
			: {}),
		...(event.reason !== undefined ? { reason: event.reason } : {}),
		...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
	});
}

/**
 * Label for a status notice already known not to be a compaction
 * notice. Kept for the TUI (use-agent-events.ts), which parses
 * compaction metadata itself; ports to the frame path in Phase 3+.
 */
export function resolveNonCompactionStatusLabel(
	event: AgentEvent,
): string | undefined {
	if (event.type !== "notice" || event.displayRole !== "status") {
		return undefined;
	}
	switch (event.reason) {
		case "auto_compaction":
			return "auto-compacting";
		case "manual_compaction":
			return "compacting";
		case "compaction_budget_emergency":
			return "context budget adjusted";
	}
	return event.message.trim() || undefined;
}

/** Test seam: drop the per-process stream so a fresh one is built. */
export function resetAgentEventStreamForTesting(): void {
	stream = undefined;
}

const TEAM_RUN_ACTIVE_SUFFIX = `${c.dim} ...${c.reset}`;

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

	stream?.renderer.breakLineIfStreaming();
	if (!stream?.renderer.isActiveTextStream()) {
		closeInlineStreamIfNeeded();
	}

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
