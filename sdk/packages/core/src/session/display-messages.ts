import type {
	AgentModelToolActivity,
	MessageWithMetadata,
	ModelToolExecution,
	ToolUseContent,
} from "@cline/shared";
import { toPersistedToolResultContent } from "./persisted-tool-result-content";

const MODEL_TOOL_ACTIVITIES_METADATA_KEY = "modelToolActivities";

/**
 * A message prepared exclusively for transcript presentation.
 *
 * The wrapper is intentionally not structurally assignable to `Message`, so a
 * display projection cannot accidentally be passed to `initialMessages` or a
 * provider request. Consumers render `message`; runtime/replay code continues
 * to consume the canonical history directly.
 */
export interface SessionDisplayMessage {
	kind: "session_display_message";
	origin: "history" | "model_tool_activity";
	execution?: ModelToolExecution;
	message: MessageWithMetadata;
	/** Index of the canonical message that produced this display entry. */
	sourceIndex: number;
}

type ProjectableModelToolActivity = AgentModelToolActivity & {
	hasResult: boolean;
};

function readModelToolActivities(
	message: MessageWithMetadata,
): ProjectableModelToolActivity[] {
	if (message.role !== "assistant") {
		return [];
	}
	const stored = message.metadata?.[MODEL_TOOL_ACTIVITIES_METADATA_KEY];
	if (!Array.isArray(stored)) {
		return [];
	}

	const activities: ProjectableModelToolActivity[] = [];
	for (const value of stored) {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			continue;
		}
		const record = value as Record<string, unknown>;
		const toolCallId =
			typeof record.toolCallId === "string" ? record.toolCallId.trim() : "";
		const toolName =
			typeof record.toolName === "string" ? record.toolName.trim() : "";
		const execution = record.execution;
		if (
			!toolCallId ||
			!toolName ||
			(execution !== "client" && execution !== "provider")
		) {
			continue;
		}

		activities.push({
			toolCallId,
			toolName,
			execution,
			input: record.input,
			output: record.output,
			isError: record.isError === true,
			hasResult:
				Object.hasOwn(record, "output") || Object.hasOwn(record, "isError"),
		});
	}
	return activities;
}

function withoutModelToolActivities(
	metadata: MessageWithMetadata["metadata"],
): MessageWithMetadata["metadata"] {
	if (
		!metadata ||
		!Object.hasOwn(metadata, MODEL_TOOL_ACTIVITIES_METADATA_KEY)
	) {
		return metadata;
	}
	const projected = { ...metadata };
	delete projected[MODEL_TOOL_ACTIVITIES_METADATA_KEY];
	return Object.keys(projected).length > 0 ? projected : undefined;
}

function asDisplayMessage(
	message: MessageWithMetadata,
	sourceIndex: number,
	origin: SessionDisplayMessage["origin"],
	execution?: ModelToolExecution,
): SessionDisplayMessage {
	return {
		kind: "session_display_message",
		origin,
		execution,
		message,
		sourceIndex,
	};
}

/**
 * Project observational model-tool activity into the same persisted
 * `tool_use` / `tool_result` shapes used by ordinary runtime tools.
 *
 * The source history is never mutated. The non-`Message` wrapper keeps this
 * display representation out of resume, fork, compaction, and model replay by
 * construction. Since the sidecar metadata does not retain text-relative
 * positions, projected activities are placed in their recorded order
 * immediately before the assistant message that owns them.
 */
export function projectSessionMessagesForDisplay(
	messages: readonly MessageWithMetadata[],
): SessionDisplayMessage[] {
	const projected: SessionDisplayMessage[] = [];

	for (const [messageIndex, rawMessage] of messages.entries()) {
		// Persisted files and remote transports are validated defensively at
		// runtime even though SDK callers get a one-way typed projection API.
		if (
			!rawMessage ||
			typeof rawMessage !== "object" ||
			Array.isArray(rawMessage) ||
			(rawMessage.role !== "user" && rawMessage.role !== "assistant")
		) {
			continue;
		}
		const message = rawMessage as MessageWithMetadata;
		const activities = readModelToolActivities(message);
		if (activities.length === 0) {
			projected.push(asDisplayMessage(message, messageIndex, "history"));
			continue;
		}

		for (const [activityIndex, activity] of activities.entries()) {
			const sourceId = typeof message.id === "string" ? message.id.trim() : "";
			const idBase =
				sourceId ||
				`model_tool_${activity.toolCallId || `history_message_${messageIndex}`}`;
			const sharedFields = {
				agent: message.agent,
				sessionId: message.sessionId,
				ts: message.ts,
			};
			const toolUse: ToolUseContent = {
				type: "tool_use",
				id: activity.toolCallId,
				name: activity.toolName,
				input: (activity.input as Record<string, unknown>) ?? {},
			};
			projected.push(
				asDisplayMessage(
					{
						...sharedFields,
						id: `${idBase}_model_tool_${activityIndex}_use`,
						role: "assistant",
						content: [toolUse],
						metadata: { userRunSpan: 0 },
						modelInfo: message.modelInfo,
					},
					messageIndex,
					"model_tool_activity",
					activity.execution,
				),
			);

			if (activity.hasResult) {
				projected.push(
					asDisplayMessage(
						{
							...sharedFields,
							id: `${idBase}_model_tool_${activityIndex}_result`,
							role: "user",
							content: [
								{
									type: "tool_result",
									tool_use_id: activity.toolCallId,
									name: activity.toolName,
									content: toPersistedToolResultContent(activity.output),
									is_error: activity.isError || undefined,
								},
							],
							metadata: { userRunSpan: 0 },
						},
						messageIndex,
						"model_tool_activity",
						activity.execution,
					),
				);
			}
		}

		projected.push(
			asDisplayMessage(
				{
					...message,
					metadata: withoutModelToolActivities(message.metadata),
				},
				messageIndex,
				"history",
			),
		);
	}

	return projected;
}
