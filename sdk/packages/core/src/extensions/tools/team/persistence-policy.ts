import {
	type AgentResult,
	type LegacyAgentUsage,
	TeamMessageType,
} from "@cline/shared";
import type { TeamEvent } from "./multi-agent";

/**
 * Persistence policy for team events.
 *
 * Team events fall into two classes:
 * - **durable**: they mutate team state that must survive a restart
 *   (tasks, mailbox, mission log, run lifecycle, outcomes, membership).
 * - **telemetry**: high-frequency liveness signals (streamed agent chunks,
 *   run heartbeats/activity). These are forwarded to live UIs only and are
 *   never written to disk.
 *
 * The switch is exhaustive so adding a new `TeamMessageType` fails to compile
 * until it is classified here.
 */
export function isDurableTeamEvent(event: TeamEvent): boolean {
	const type = event.type;
	switch (type) {
		case TeamMessageType.AgentEvent:
			return false;
		case TeamMessageType.RunProgress:
			// A scheduled retry re-queues the run and bumps `retryCount` but only
			// reports it as progress; that transition must reach disk so recovery
			// does not grant an extra attempt. Plain heartbeats stay telemetry.
			return isRetryScheduledProgress(event);
		case TeamMessageType.TaskStart:
		case TeamMessageType.TaskEnd:
		case TeamMessageType.TeammateSpawned:
		case TeamMessageType.TeammateShutdown:
		case TeamMessageType.TeamTaskUpdated:
		case TeamMessageType.TeamMessage:
		case TeamMessageType.TeamMissionLog:
		case TeamMessageType.RunQueued:
		case TeamMessageType.RunStarted:
		case TeamMessageType.RunCompleted:
		case TeamMessageType.RunFailed:
		case TeamMessageType.RunCancelled:
		case TeamMessageType.RunInterrupted:
		case TeamMessageType.OutcomeCreated:
		case TeamMessageType.OutcomeFragmentAttached:
		case TeamMessageType.OutcomeFragmentReviewed:
		case TeamMessageType.OutcomeFinalized:
			return true;
		default: {
			const exhaustive: never = type;
			return Boolean(exhaustive);
		}
	}
}

/**
 * Durable events that should be flushed to storage immediately instead of
 * waiting for the batch window: terminal run states and membership changes,
 * where losing the write on a crash would leave recovery in a wrong state.
 */
export function shouldFlushTeamEventImmediately(event: TeamEvent): boolean {
	switch (event.type) {
		case TeamMessageType.TeammateSpawned:
		case TeamMessageType.TeammateShutdown:
		case TeamMessageType.RunCompleted:
		case TeamMessageType.RunFailed:
		case TeamMessageType.RunCancelled:
		case TeamMessageType.RunInterrupted:
			return true;
		case TeamMessageType.RunProgress:
			return isRetryScheduledProgress(event);
		default:
			return false;
	}
}

function isRetryScheduledProgress(event: TeamEvent): boolean {
	return (
		event.type === TeamMessageType.RunProgress && event.run.status === "queued"
	);
}

/**
 * Compact form of an `AgentResult` kept on team run records. Contains exactly
 * the fields consumed by run summaries; the full transcript (messages, tool
 * calls) already lives in the teammate's session storage.
 */
export interface TeamRunResultRecord {
	text: string;
	iterations: number;
	finishReason: AgentResult["finishReason"];
	durationMs: number;
	usage: LegacyAgentUsage;
}

/** Upper bound for final text kept on a run record (previews use 400). */
export const TEAM_RUN_RESULT_TEXT_LIMIT = 4000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function asNumber(value: unknown, fallback = 0): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asOptionalNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function truncateResultText(text: string): string {
	return text.length > TEAM_RUN_RESULT_TEXT_LIMIT
		? `${text.slice(0, TEAM_RUN_RESULT_TEXT_LIMIT - 3)}...`
		: text;
}

/**
 * Reduce a full (or legacy persisted) agent result to a `TeamRunResultRecord`.
 * Accepts `unknown` because persisted rows written by older versions may hold
 * a full `AgentResult` with dates serialized as strings.
 */
export function toTeamRunResultRecord(
	result: unknown,
): TeamRunResultRecord | undefined {
	if (!isRecord(result)) {
		return undefined;
	}
	const usage = isRecord(result.usage) ? result.usage : {};
	const finishReason = result.finishReason;
	return {
		text: truncateResultText(
			typeof result.text === "string" ? result.text : "",
		),
		iterations: asNumber(result.iterations),
		finishReason: (typeof finishReason === "string"
			? finishReason
			: "completed") as AgentResult["finishReason"],
		durationMs: asNumber(result.durationMs),
		usage: {
			inputTokens: asNumber(usage.inputTokens),
			outputTokens: asNumber(usage.outputTokens),
			cacheReadTokens: asOptionalNumber(usage.cacheReadTokens),
			cacheWriteTokens: asOptionalNumber(usage.cacheWriteTokens),
			totalCost: asOptionalNumber(usage.totalCost),
		},
	};
}

function compactRun<T extends { result?: unknown }>(run: T): T {
	if (run.result === undefined) {
		return run;
	}
	return { ...run, result: toTeamRunResultRecord(run.result) };
}

/**
 * Strip heavy payloads (full transcripts, tool calls) from an event before it
 * is appended to the durable event log.
 */
export function toPersistableTeamEvent(event: TeamEvent): unknown {
	switch (event.type) {
		case TeamMessageType.TaskEnd: {
			const { messages: _messages, result, error, ...rest } = event;
			return {
				...rest,
				result: toTeamRunResultRecord(result),
				error: error ? { message: error.message } : undefined,
			};
		}
		case TeamMessageType.RunQueued:
		case TeamMessageType.RunStarted:
		case TeamMessageType.RunCompleted:
		case TeamMessageType.RunFailed:
		case TeamMessageType.RunCancelled:
		case TeamMessageType.RunInterrupted:
			return { ...event, run: compactRun(event.run) };
		default:
			return event;
	}
}
