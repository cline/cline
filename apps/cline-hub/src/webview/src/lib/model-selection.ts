export const MODEL_SELECTION_STORAGE_KEY = "cline.code.model-selection.v1";

export type ModelSelectionStorage = {
	lastProvider: string;
	lastModelByProvider: Record<string, string>;
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
		};

		if ("lastProvider" in shaped || "lastModelByProvider" in shaped) {
			return {
				lastProvider:
					typeof shaped.lastProvider === "string"
						? shaped.lastProvider.trim()
						: "",
				lastModelByProvider: sanitizeStringRecord(shaped.lastModelByProvider),
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
