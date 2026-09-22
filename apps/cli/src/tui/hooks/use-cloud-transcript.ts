import { useCallback, useEffect, useRef, useState } from "react";
import type {
	CliCloudRuntime,
	CloudRuntimeState,
} from "../../runtime/cloud/runtime";
import { formatToolOutput } from "../../utils/helpers";
import type { ChatEntry, InlineStream } from "../types";
import { hydrateSessionMessages } from "../utils/hydrate-messages";
import { useAgentEventHandlers } from "./use-agent-events";

const ignore = () => {};

/** One projection of reconciled cloud events, reset atomically by authoritative baselines. */
export function useCloudTranscript(
	runtime: CliCloudRuntime,
	target: CloudRuntimeState["target"],
) {
	const [entries, setEntries] = useState<ChatEntry[]>([]);
	const activeInlineStreamRef = useRef<InlineStream>(undefined);
	const appendEntry = useCallback(
		(entry: ChatEntry) =>
			setEntries((current) => [...current, { ...entry, mode: "act" }]),
		[],
	);
	const updateLastEntry = useCallback(
		(update: (entry: ChatEntry) => ChatEntry) =>
			setEntries((current) =>
				current.length
					? [...current.slice(0, -1), update(current[current.length - 1])]
					: current,
			),
		[],
	);
	const updateEntry = useCallback(
		(update: (entry: ChatEntry) => ChatEntry) =>
			setEntries((current) => current.map(update)),
		[],
	);
	const closeInlineStream = useCallback(() => {
		activeInlineStreamRef.current = undefined;
		setEntries((current) =>
			current.map((entry) =>
				(entry.kind === "assistant_text" || entry.kind === "reasoning") &&
				entry.streaming
					? { ...entry, streaming: false }
					: entry,
			),
		);
	}, []);
	const handlers = useAgentEventHandlers({
		appendEntry,
		updateLastEntry,
		updateEntry,
		closeInlineStream,
		activeInlineStreamRef,
		setIsRunning: ignore,
		setIsStreaming: ignore,
		addUsageDelta: ignore,
		onTurnErrorReported: ignore,
		verbose: true,
	});
	const handlersRef = useRef(handlers);
	handlersRef.current = handlers;
	useEffect(() => {
		setEntries([]);
		handlersRef.current.resetProjection();
		if (!target) return;
		return runtime.subscribeToSessionEvents((event) => {
			if (event.target !== target || runtime.getSnapshot().target !== target)
				return;
			if (event.type === "snapshot") {
				handlersRef.current.resetProjection();
				const next = hydrateSessionMessages(event.snapshot.messages, {
					materializeMedia: false,
				});
				// Resume an unfinished text block rather than adding its suffix as a duplicate entry.
				const tail = next.at(-1);
				if (
					event.snapshot.busy &&
					(tail?.kind === "assistant_text" || tail?.kind === "reasoning")
				) {
					tail.streaming = true;
					activeInlineStreamRef.current =
						tail.kind === "reasoning" ? "reasoning" : "text";
				}
				setEntries(next);
				return;
			}
			const coreEvent = event.event;
			if (coreEvent.type === "agent_event") {
				const agentEvent = coreEvent.payload.event;
				if (
					agentEvent.type === "content_update" &&
					agentEvent.contentType === "tool"
				) {
					updateEntry((entry) =>
						entry.kind === "tool_call" &&
						entry.toolCallId === agentEvent.toolCallId
							? {
									...entry,
									result: {
										outputSummary: formatToolOutput(agentEvent.update),
										rawOutput: agentEvent.update,
									},
								}
							: entry,
					);
					return;
				}
				if (
					agentEvent.type === "content_end" &&
					agentEvent.contentType === "media" &&
					agentEvent.media
				) {
					// Cloud media remains a remote reference. The local handler otherwise writes downloads to disk.
					const media = agentEvent.media;
					closeInlineStream();
					appendEntry({
						kind: "assistant_media",
						modality: media.modality,
						mediaType: media.mediaType,
						byteLength: media.sizeBytes ?? 0,
						location:
							media.source.type === "url"
								? media.source.url
								: media.source.type === "artifact"
									? `artifact:${media.source.artifactId}`
									: undefined,
					});
					return;
				}
				handlersRef.current.handleAgentEvent(agentEvent);
			} else if (coreEvent.type === "pending_prompt_submitted") {
				closeInlineStream();
				handlersRef.current.handlePendingPromptSubmitted(coreEvent.payload);
			} else if (coreEvent.type === "pending_prompts") {
				handlersRef.current.handlePendingPrompts(coreEvent.payload);
			} else if (coreEvent.type === "ended") closeInlineStream();
		});
	}, [runtime, target, appendEntry, closeInlineStream, updateEntry]);
	return entries;
}
