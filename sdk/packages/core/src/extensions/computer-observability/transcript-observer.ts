import type { AgentHooks, AgentMessage, AgentMessagePart } from "@cline/shared";
import type { ArtifactEventSource } from "./artifact-events";
import type { ComputerTaskArtifactRecorder } from "./recorder";

const TEXT_PREVIEW_LIMIT = 4000;
const REASONING_PREVIEW_LIMIT = 1000;
const TOOL_INPUT_PREVIEW_LIMIT = 500;

function truncate(text: string, limit: number): string {
	return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function redactComputerInput(input: unknown): unknown {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return input;
	}
	const { text, ...preview } = input as Record<string, unknown>;
	return {
		...preview,
		hasText: text !== undefined,
		...(Array.isArray(preview.actions)
			? { actions: preview.actions.map(redactComputerInput) }
			: {}),
	};
}

/**
 * Reduces one committed message part to a bounded preview. Tool results keep
 * only name/ok, and image parts are omitted: qbt retains screenshots in its
 * native action journal, so host events do not duplicate their bytes.
 * Computer inputs replace text (including key combinations and sequence-step
 * text) with hasText before serialization, without changing the tool input.
 * This is not general transcript redaction: other tool inputs, messages, and
 * reasoning remain visible. Qbt's native action journal still stores raw text.
 */
function partPayload(
	part: AgentMessagePart,
	role: AgentMessage["role"],
): { payload: Record<string, unknown>; toolCallId?: string } | undefined {
	switch (part.type) {
		case "text":
			return part.text.trim()
				? {
						payload: {
							role,
							text: truncate(part.text, TEXT_PREVIEW_LIMIT),
						},
					}
				: undefined;
		case "reasoning":
			return part.text.trim()
				? {
						payload: {
							role: "reasoning",
							text: truncate(part.text, REASONING_PREVIEW_LIMIT),
						},
					}
				: undefined;
		case "tool-call":
			return {
				payload: {
					role: "tool_call",
					toolName: part.toolName,
					input: truncate(
						JSON.stringify(
							part.toolName === "computer"
								? redactComputerInput(part.input ?? {})
								: (part.input ?? {}),
						),
						TOOL_INPUT_PREVIEW_LIMIT,
					),
				},
				toolCallId: part.toolCallId,
			};
		case "tool-result":
			return {
				payload: {
					role: "tool_result",
					toolName: part.toolName,
					ok: !part.isError,
				},
				toolCallId: part.toolCallId,
			};
		default:
			return undefined;
	}
}

/**
 * Agent hooks that record a session's transcript and run status into the
 * artifact stream. Attach to a session via its config `hooks` (hosts merge
 * hook layers): every committed message becomes
 * `transcript.message_committed` events (one per meaningful part), and run
 * start/end become `session.status_changed` — the overview's at-a-glance
 * "is it working or done" signal.
 *
 * Hooks are used rather than a host event subscription because
 * `message-added` is the canonical commit point: it fires exactly once per
 * transcript message, on every host (local or hub), for user, assistant,
 * and tool messages alike.
 */
export function createTranscriptRecordingHooks(
	recorder: ComputerTaskArtifactRecorder,
	source: ArtifactEventSource,
): AgentHooks {
	return {
		beforeRun: async () => {
			recorder.record({
				type: "session.status_changed",
				source: { ...source },
				payload: { status: "running" },
			});
			return undefined;
		},
		afterRun: async ({ result }) => {
			recorder.record({
				type: "session.status_changed",
				source: { ...source },
				payload: { status: result.status },
			});
		},
		onEvent: async (event) => {
			if (event.type !== "message-added") {
				return;
			}
			for (const part of event.message.content) {
				const reduced = partPayload(part, event.message.role);
				if (!reduced) {
					continue;
				}
				recorder.record({
					type: "transcript.message_committed",
					source: { ...source },
					...(reduced.toolCallId
						? { correlation: { toolCallId: reduced.toolCallId } }
						: {}),
					payload: reduced.payload,
				});
			}
		},
	};
}
