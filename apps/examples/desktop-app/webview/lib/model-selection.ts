export const MODEL_SELECTION_STORAGE_KEY = "cline.code.model-selection.v1";

/** Composer reasoning levels; mirrors ChatSessionConfigSchema.reasoningEffort. */
export const REASONING_EFFORT_VALUES = [
	"low",
	"medium",
	"high",
	"xhigh",
] as const;

export type StoredReasoningEffort = (typeof REASONING_EFFORT_VALUES)[number];

export type ModelSelectionStorage = {
	lastProvider: string;
	lastModelByProvider: Record<string, string>;
	/**
	 * Last explicit composer reasoning choice. Remembered so a new thread (or a
	 * restart) starts from the user's selection instead of the built-in default.
	 * `thinking: false` is the "None" option, which has no effort value.
	 */
	thinking?: boolean;
	reasoningEffort?: StoredReasoningEffort;
};

function sanitizeStringRecord(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	return Object.fromEntries(
		Object.entries(value).filter(
			([key, entry]) =>
				typeof key === "string" &&
				typeof entry === "string" &&
				entry.trim().length > 0,
		),
	);
}

function sanitizeReasoningEffort(
	value: unknown,
): StoredReasoningEffort | undefined {
	return typeof value === "string" &&
		(REASONING_EFFORT_VALUES as readonly string[]).includes(value)
		? (value as StoredReasoningEffort)
		: undefined;
}

export function parseModelSelectionStorage(
	raw: string | null,
): ModelSelectionStorage {
	const empty: ModelSelectionStorage = {
		lastProvider: "",
		lastModelByProvider: {},
	};
	if (!raw) {
		return empty;
	}

	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return empty;
		}

		const shaped = parsed as {
			lastProvider?: unknown;
			lastModelByProvider?: unknown;
			thinking?: unknown;
			reasoningEffort?: unknown;
		};

		if ("lastProvider" in shaped || "lastModelByProvider" in shaped) {
			const thinking =
				typeof shaped.thinking === "boolean" ? shaped.thinking : undefined;
			const reasoningEffort = sanitizeReasoningEffort(shaped.reasoningEffort);
			return {
				lastProvider:
					typeof shaped.lastProvider === "string"
						? shaped.lastProvider.trim()
						: "",
				lastModelByProvider: sanitizeStringRecord(shaped.lastModelByProvider),
				...(thinking === undefined ? {} : { thinking }),
				...(reasoningEffort === undefined ? {} : { reasoningEffort }),
			};
		}

		return {
			lastProvider: "",
			lastModelByProvider: sanitizeStringRecord(parsed),
		};
	} catch {
		return empty;
	}
}

export function readModelSelectionStorageFromWindow(): ModelSelectionStorage {
	if (typeof window === "undefined") {
		return {
			lastProvider: "",
			lastModelByProvider: {},
		};
	}
	return parseModelSelectionStorage(
		window.localStorage.getItem(MODEL_SELECTION_STORAGE_KEY),
	);
}

export function writeModelSelectionStorageToWindow(
	value: ModelSelectionStorage,
): void {
	if (typeof window === "undefined") {
		return;
	}
	window.localStorage.setItem(
		MODEL_SELECTION_STORAGE_KEY,
		JSON.stringify(value),
	);
}

/**
 * Remembers the composer's reasoning choice alongside the provider/model picks.
 * Rebuilds the payload instead of spreading the stored value so an omitted
 * effort (the "None" option, `thinking: false`) clears any stale level rather
 * than silently resurrecting it on the next mount.
 */
export function rememberReasoningSelectionInWindow(
	selection: Pick<ModelSelectionStorage, "thinking" | "reasoningEffort">,
): void {
	if (typeof window === "undefined") {
		return;
	}
	const current = readModelSelectionStorageFromWindow();
	const next: ModelSelectionStorage = {
		lastProvider: current.lastProvider,
		lastModelByProvider: current.lastModelByProvider,
	};
	if (selection.thinking !== undefined) {
		next.thinking = selection.thinking;
	}
	if (selection.reasoningEffort !== undefined) {
		next.reasoningEffort = selection.reasoningEffort;
	}
	writeModelSelectionStorageToWindow(next);
}
