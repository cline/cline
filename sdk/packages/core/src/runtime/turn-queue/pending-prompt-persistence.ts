import type { PendingPrompt } from "../../types/session";

const PENDING_PROMPTS_METADATA_KEY = "cline.pendingPrompts";

export function readPersistedPendingPrompts(
	metadata: Record<string, unknown> | undefined,
): PendingPrompt[] {
	const value = metadata?.[PENDING_PROMPTS_METADATA_KEY];
	if (!Array.isArray(value)) return [];

	return value.flatMap((entry): PendingPrompt[] => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
		const record = entry as Record<string, unknown>;
		if (
			typeof record.id !== "string" ||
			typeof record.prompt !== "string" ||
			(record.delivery !== "queue" && record.delivery !== "steer")
		) {
			return [];
		}
		const mode =
			record.mode === "act" ||
			record.mode === "plan" ||
			record.mode === "yolo" ||
			record.mode === "zen"
				? record.mode
				: undefined;
		return [
			{
				id: record.id,
				prompt: record.prompt,
				delivery: record.delivery,
				...(mode ? { mode } : {}),
				userImages: readStringArray(record.userImages),
				userFiles: readStringArray(record.userFiles),
			},
		];
	});
}

export function withPersistedPendingPrompts(
	metadata: Record<string, unknown> | undefined,
	pendingPrompts: readonly PendingPrompt[],
): Record<string, unknown> {
	const next = { ...(metadata ?? {}) };
	if (pendingPrompts.length > 0) {
		next[PENDING_PROMPTS_METADATA_KEY] = pendingPrompts.map(clonePendingPrompt);
	} else {
		delete next[PENDING_PROMPTS_METADATA_KEY];
	}
	return next;
}

function readStringArray(value: unknown): string[] | undefined {
	return Array.isArray(value) && value.every((item) => typeof item === "string")
		? value
		: undefined;
}

function clonePendingPrompt(prompt: PendingPrompt): PendingPrompt {
	return {
		...prompt,
		userImages: prompt.userImages ? [...prompt.userImages] : undefined,
		userFiles: prompt.userFiles ? [...prompt.userFiles] : undefined,
	};
}
