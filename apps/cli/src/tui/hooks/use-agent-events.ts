import type { AgentEvent, TeamEvent } from "@cline/core";
import { formatDisplayUserInput } from "@cline/shared";
import { useCallback, useRef } from "react";
import type {
	PendingPromptSnapshot,
	PendingPromptSubmittedEvent,
} from "../../runtime/session-events";
import { formatCliErrorMessage } from "../../utils/cline-pass-errors";
import { resolveNonCompactionStatusLabel } from "../../utils/events";
import {
	formatToolInput,
	formatToolOutput,
	truncate,
} from "../../utils/helpers";
import type { ChatEntry, InlineStream, TuiProps } from "../types";
import { parseCompactionNoticeMetadata } from "../utils/compaction-status";

interface AgentEventDeps {
	appendEntry: (entry: ChatEntry) => void;
	updateLastEntry: (updater: (prev: ChatEntry) => ChatEntry) => void;
	updateEntry: (updater: (entry: ChatEntry) => ChatEntry) => void;
	closeInlineStream: () => void;
	activeInlineStreamRef: React.MutableRefObject<InlineStream>;
	setIsRunning: (v: boolean) => void;
	setIsStreaming: (v: boolean) => void;
	addUsageDelta: (usage: {
		inputTokens?: number;
		outputTokens?: number;
		cost?: number;
	}) => void;
	onTurnErrorReported: TuiProps["onTurnErrorReported"];
	verbose: boolean;
	modelId?: string;
}

// Streamed text/reasoning deltas are buffered and flushed to React state at
// most once per interval. Committing every delta re-renders the transcript
// (and re-parses the streaming markdown entry) hundreds of times per second,
// which wastes CPU and permanently grows native renderer memory.
const STREAM_DELTA_FLUSH_MS = 50;

export function useAgentEventHandlers(deps: AgentEventDeps) {
	const openCompactionEntryRef = useRef(false);
	const {
		appendEntry,
		updateLastEntry,
		updateEntry,
		closeInlineStream,
		activeInlineStreamRef,
		setIsRunning,
		setIsStreaming,
		addUsageDelta,
		onTurnErrorReported,
		verbose,
		modelId,
	} = deps;

	const pendingDeltaRef = useRef<{
		kind: "assistant_text" | "reasoning";
		buffer: string;
	} | null>(null);
	const deltaFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	const flushPendingDelta = useCallback(() => {
		if (deltaFlushTimerRef.current !== null) {
			clearTimeout(deltaFlushTimerRef.current);
			deltaFlushTimerRef.current = null;
		}
		const pending = pendingDeltaRef.current;
		pendingDeltaRef.current = null;
		if (!pending || pending.buffer.length === 0) return;
		updateLastEntry((prev) =>
			prev.kind === pending.kind
				? { ...prev, text: prev.text + pending.buffer }
				: prev,
		);
	}, [updateLastEntry]);

	const queuePendingDelta = useCallback(
		(kind: "assistant_text" | "reasoning", chunk: string) => {
			const pending = pendingDeltaRef.current;
			if (pending && pending.kind === kind) {
				pending.buffer += chunk;
			} else {
				flushPendingDelta();
				pendingDeltaRef.current = { kind, buffer: chunk };
			}
			if (deltaFlushTimerRef.current === null) {
				deltaFlushTimerRef.current = setTimeout(() => {
					deltaFlushTimerRef.current = null;
					flushPendingDelta();
				}, STREAM_DELTA_FLUSH_MS);
			}
		},
		[flushPendingDelta],
	);

	// Compaction dividers that arrived while an assistant message was still
	// streaming. Appending them immediately would split the message in two, so
	// they are held until the active content block closes (or the turn ends).
	const pendingCompactionEntriesRef = useRef<
		Extract<ChatEntry, { kind: "compaction" }>[]
	>([]);

	const flushPendingCompactionEntries = useCallback(() => {
		const pending = pendingCompactionEntriesRef.current;
		if (pending.length === 0) return;
		pendingCompactionEntriesRef.current = [];
		for (const entry of pending) {
			if (entry.status !== "started" && openCompactionEntryRef.current) {
				updateEntry((current) =>
					current.kind === "compaction" && current.status === "started"
						? { ...current, ...entry }
						: current,
				);
				openCompactionEntryRef.current = false;
			} else {
				appendEntry(entry);
				if (entry.status === "started") {
					openCompactionEntryRef.current = true;
				}
			}
		}
	}, [appendEntry, updateEntry]);

	const finalizeDanglingCompactionEntry = useCallback(
		(status: "failed" | "cancelled") => {
			if (!openCompactionEntryRef.current) return;
			openCompactionEntryRef.current = false;
			updateEntry((entry) =>
				entry.kind === "compaction" && entry.status === "started"
					? { ...entry, status }
					: entry,
			);
		},
		[updateEntry],
	);

	const closeToolEntry = useCallback(
		(event: AgentEvent & { type: "content_end" }) => {
			const error = event.error ?? undefined;
			const output = event.output;
			const result = {
				outputSummary: error ? "" : formatToolOutput(output),
				rawOutput: error ? undefined : output,
				error,
			};
			if (event.toolCallId) {
				updateEntry((entry) => {
					if (
						entry.kind !== "tool_call" ||
						entry.toolCallId !== event.toolCallId
					) {
						return entry;
					}
					return { ...entry, streaming: false, result };
				});
			} else {
				updateLastEntry((prev) => {
					if (prev.kind !== "tool_call") return prev;
					return { ...prev, streaming: false, result };
				});
			}
		},
		[updateEntry, updateLastEntry],
	);

	const turnErrorReportedRef = useRef(false);
	const knownPendingPromptIdsRef = useRef(new Set<string>());

	const handleAgentEvent = useCallback(
		(event: AgentEvent) => {
			// Any event other than an inline text/reasoning delta must observe
			// the transcript with all buffered deltas applied, otherwise
			// entries would be appended out of order.
			const isInlineDelta =
				event.type === "content_start" &&
				(event.contentType === "text" || event.contentType === "reasoning");
			if (!isInlineDelta) {
				flushPendingDelta();
			}
			switch (event.type) {
				case "iteration_start":
					setIsRunning(true);
					setIsStreaming(true);
					closeInlineStream();
					flushPendingCompactionEntries();
					break;
				case "iteration_end":
					closeInlineStream();
					flushPendingCompactionEntries();
					break;
				case "content_start": {
					setIsStreaming(false);
					switch (event.contentType) {
						case "text": {
							if (activeInlineStreamRef.current !== "text") {
								flushPendingDelta();
								closeInlineStream();
								activeInlineStreamRef.current = "text";
								appendEntry({
									kind: "assistant_text",
									text: event.text ?? "",
									streaming: true,
								});
							} else {
								queuePendingDelta("assistant_text", event.text ?? "");
							}
							break;
						}
						case "reasoning": {
							const chunk =
								event.redacted && !event.reasoning
									? "[redacted]"
									: (event.reasoning ?? "");
							if (activeInlineStreamRef.current !== "reasoning") {
								flushPendingDelta();
								closeInlineStream();
								activeInlineStreamRef.current = "reasoning";
								appendEntry({
									kind: "reasoning",
									text: chunk,
									streaming: true,
								});
							} else {
								queuePendingDelta("reasoning", chunk);
							}
							break;
						}
						case "tool": {
							closeInlineStream();
							const toolName = event.toolName ?? "unknown_tool";
							appendEntry({
								kind: "tool_call",
								toolCallId: event.toolCallId,
								toolName,
								inputSummary: formatToolInput(toolName, event.input),
								rawInput: event.input,
								streaming: true,
							});
							break;
						}
					}
					break;
				}
				case "content_end": {
					switch (event.contentType) {
						case "text":
						case "reasoning":
							closeInlineStream();
							break;
						case "tool": {
							closeInlineStream();
							closeToolEntry(event);
							break;
						}
					}
					break;
				}
				case "done":
					setIsRunning(false);
					setIsStreaming(false);
					closeInlineStream();
					flushPendingCompactionEntries();
					finalizeDanglingCompactionEntry("cancelled");
					break;
				case "error":
					setIsRunning(false);
					setIsStreaming(false);
					closeInlineStream();
					flushPendingCompactionEntries();
					finalizeDanglingCompactionEntry("failed");
					turnErrorReportedRef.current = true;
					onTurnErrorReported(true);
					if (!event.recoverable || verbose) {
						appendEntry({
							kind: "error",
							text: formatCliErrorMessage(event.error, { modelId }),
						});
					}
					break;
				case "notice":
					if (event.displayRole === "status") {
						const compaction = parseCompactionNoticeMetadata(event.metadata);
						if (!compaction) {
							closeInlineStream();
						}
						if (compaction) {
							if (activeInlineStreamRef.current) {
								// An assistant message is still streaming; appending now
								// would split it around the divider. Hold the divider (final
								// state until the content block closes, then reconcile it
								// with the same open divider atomically.
								pendingCompactionEntriesRef.current.push({
									kind: "compaction",
									...compaction,
								});
								break;
							}
							if (compaction.status === "started") {
								appendEntry({ kind: "compaction", ...compaction });
								openCompactionEntryRef.current = true;
							} else if (openCompactionEntryRef.current) {
								// Finalize the in-progress divider in place, wherever it
								// sits in the transcript.
								updateEntry((entry) =>
									entry.kind === "compaction" && entry.status === "started"
										? { ...entry, ...compaction }
										: entry,
								);
								openCompactionEntryRef.current = false;
							} else {
								appendEntry({ kind: "compaction", ...compaction });
							}
							break;
						}
						const label = resolveNonCompactionStatusLabel(event);
						if (label) {
							appendEntry({ kind: "status", text: label });
						}
					}
					break;
				case "usage":
					addUsageDelta({
						inputTokens: event.inputTokens,
						outputTokens: event.outputTokens,
						cost: event.cost,
					});
					break;
			}
		},
		[
			appendEntry,
			updateEntry,
			closeInlineStream,
			activeInlineStreamRef,
			setIsRunning,
			setIsStreaming,
			addUsageDelta,
			onTurnErrorReported,
			verbose,
			modelId,
			closeToolEntry,
			finalizeDanglingCompactionEntry,
			flushPendingCompactionEntries,
			flushPendingDelta,
			queuePendingDelta,
		],
	);

	const handleTeamEvent = useCallback(
		(event: TeamEvent) => {
			const team = (text: string) => {
				flushPendingDelta();
				closeInlineStream();
				appendEntry({ kind: "team", text });
			};
			switch (event.type) {
				case "teammate_spawned":
					team(`[team] teammate spawned: ${event.agentId}`);
					break;
				case "teammate_shutdown":
					team(`[team] teammate shutdown: ${event.agentId}`);
					break;
				case "team_task_updated":
					team(`[team task] ${event.task.id} -> ${event.task.status}`);
					break;
				case "team_message":
					team(
						`[mailbox] ${event.message.fromAgentId} -> ${event.message.toAgentId}: ${event.message.subject}`,
					);
					break;
				case "team_mission_log":
					team(
						`[mission] ${event.entry.agentId}: ${truncate(event.entry.summary, 90)}`,
					);
					break;
				case "run_queued":
					team(`[team run] queued ${event.run.id} -> ${event.run.agentId} ...`);
					break;
				case "run_started":
					team(
						`[team run] started ${event.run.id} -> ${event.run.agentId} ...`,
					);
					break;
				case "run_progress":
					if (event.message === "heartbeat") break;
					team(`[team run] progress ${event.run.id}: ${event.message}`);
					break;
				case "run_completed":
					team(`[team run] completed ${event.run.id}`);
					break;
				case "run_failed":
					team(
						`[team run] failed ${event.run.id}: ${event.run.error ?? "unknown error"}`,
					);
					break;
				case "run_cancelled":
					team(`[team run] cancelled ${event.run.id}`);
					break;
				case "run_interrupted":
					team(`[team run] interrupted ${event.run.id}`);
					break;
				case "outcome_created":
					team(
						`[team outcome] created ${event.outcome.id}: ${event.outcome.title}`,
					);
					break;
				case "outcome_fragment_attached":
					team(
						`[team outcome] fragment ${event.fragment.id} attached to ${event.fragment.section}`,
					);
					break;
				case "outcome_fragment_reviewed":
					team(
						`[team outcome] fragment ${event.fragment.id} -> ${event.fragment.status}`,
					);
					break;
				case "outcome_finalized":
					team(`[team outcome] finalized ${event.outcome.id}`);
					break;
				case "task_start":
				case "task_end":
				case "agent_event":
					break;
			}
		},
		[appendEntry, closeInlineStream, flushPendingDelta],
	);

	const handlePendingPrompts = useCallback((event: PendingPromptSnapshot) => {
		knownPendingPromptIdsRef.current = new Set(event.prompts.map((e) => e.id));
	}, []);

	const handlePendingPromptSubmitted = useCallback(
		(event: PendingPromptSubmittedEvent) => {
			knownPendingPromptIdsRef.current.delete(event.id);
			flushPendingDelta();
			// Display boundary: formatDisplayUserInput strips runtime-generated
			// notice elements (e.g. mode_notice) that normalizeUserInput must
			// preserve, since the latter also sanitizes model-bound prompts.
			appendEntry({
				kind: "user_submitted",
				text: formatDisplayUserInput(event.prompt),
			});
		},
		[appendEntry, flushPendingDelta],
	);

	return {
		handleAgentEvent,
		handleTeamEvent,
		handlePendingPrompts,
		handlePendingPromptSubmitted,
		turnErrorReportedRef,
	};
}
