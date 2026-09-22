import { ReasoningEffortSchema } from "@cline/shared";

const SESSION_THINKING_METADATA_KEY = "thinking";
const SESSION_REASONING_EFFORT_METADATA_KEY = "reasoningEffort";

/**
 * The composer reasoning selection a session last ran with. Clients restore it
 * when they re-attach the session, so reopening a conversation keeps that
 * conversation's own level instead of the default for a new thread.
 */
export interface SessionReasoningMetadata {
	thinking?: boolean;
	reasoningEffort?: string;
}

function readEffort(value: unknown): string | undefined {
	const result = ReasoningEffortSchema.safeParse(value);
	return result.success ? result.data : undefined;
}

export function readSessionReasoningMetadata(
	metadata: Record<string, unknown> | null | undefined,
): SessionReasoningMetadata | undefined {
	const thinking =
		typeof metadata?.[SESSION_THINKING_METADATA_KEY] === "boolean"
			? (metadata[SESSION_THINKING_METADATA_KEY] as boolean)
			: undefined;
	const reasoningEffort = readEffort(
		metadata?.[SESSION_REASONING_EFFORT_METADATA_KEY],
	);
	if (thinking === undefined && reasoningEffort === undefined) {
		return undefined;
	}
	return {
		...(thinking === undefined ? {} : { thinking }),
		...(reasoningEffort === undefined ? {} : { reasoningEffort }),
	};
}

/**
 * Merges the selection into session metadata. Omitted values leave the stored
 * entry untouched, and switching thinking off drops a stale level so a later
 * read cannot resurrect a level the user turned off.
 */
export function withSessionReasoningMetadata(
	metadata: Record<string, unknown> | null | undefined,
	selection: { thinking?: boolean; reasoningEffort?: string },
): Record<string, unknown> {
	const thinking = selection.thinking;
	const reasoningEffort =
		thinking === false ? undefined : readEffort(selection.reasoningEffort);
	if (thinking === undefined && reasoningEffort === undefined) {
		return { ...(metadata ?? {}) };
	}
	const next: Record<string, unknown> = { ...(metadata ?? {}) };
	next[SESSION_THINKING_METADATA_KEY] = thinking ?? true;
	if (reasoningEffort === undefined) {
		delete next[SESSION_REASONING_EFFORT_METADATA_KEY];
	} else {
		next[SESSION_REASONING_EFFORT_METADATA_KEY] = reasoningEffort;
	}
	return next;
}
