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

/**
 * Where a remembered model lives: Local and Cloud chats, and the Factory
 * manager (Ask Factory), which keeps its own and starts from Local's until
 * one is chosen for it.
 */
export type ModelSelectionScope = ExecutionTarget | "factory-manager";

export const FACTORY_MANAGER_MODEL_STORAGE_KEY =
	"cline.code.factory-manager-model.v1";

export function readModelSelectionStorageFromWindow(
	scope: ModelSelectionScope = "local",
): ModelSelectionStorage {
	if (typeof window === "undefined") {
		return {
			lastProvider: "",
			lastModelByProvider: {},
		};
	}
	const raw = window.localStorage.getItem(modelSelectionStorageKey(scope));
	if (raw === null && scope === "factory-manager")
		return readModelSelectionStorageFromWindow("local");
	return parseModelSelectionStorage(raw);
}

export function writeModelSelectionStorageToWindow(
	value: ModelSelectionStorage,
	scope: ModelSelectionScope = "local",
): void {
	if (typeof window === "undefined") {
		return;
	}
	window.localStorage.setItem(
		modelSelectionStorageKey(scope),
		JSON.stringify(value),
	);
}

export const REASONING_SELECTION_STORAGE_KEY =
	"cline.code.reasoning-selection.v1";

export const REASONING_SELECTION_VALUES = [
	"none",
	"low",
	"medium",
	"high",
	"xhigh",
] as const;

export type ReasoningSelectionValue =
	(typeof REASONING_SELECTION_VALUES)[number];

/** Last reasoning effort picked for each provider, like `lastModelByProvider`. */
export function readReasoningSelectionStorageFromWindow(): Record<
	string,
	ReasoningSelectionValue
> {
	if (typeof window === "undefined") {
		return {};
	}
	try {
		const parsed = JSON.parse(
			window.localStorage.getItem(REASONING_SELECTION_STORAGE_KEY) ?? "null",
		) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}
		return Object.fromEntries(
			Object.entries(parsed).filter(
				(entry): entry is [string, ReasoningSelectionValue] =>
					(REASONING_SELECTION_VALUES as readonly string[]).includes(
						entry[1] as string,
					),
			),
		);
	} catch {
		return {};
	}
}

export function writeReasoningSelectionToWindow(
	providerId: string,
	value: ReasoningSelectionValue,
): void {
	if (typeof window === "undefined") {
		return;
	}
	window.localStorage.setItem(
		REASONING_SELECTION_STORAGE_KEY,
		JSON.stringify({
			...readReasoningSelectionStorageFromWindow(),
			[providerId]: value,
		}),
	);
}

export type ExecutionTarget = "local" | "cloud";
export const EXECUTION_TARGET_STORAGE_KEY = "cline.code.execution-target.v1";

function modelSelectionStorageKey(scope: ModelSelectionScope): string {
	// Cloud has a different model catalog; keep the local provider/model intact.
	if (scope === "cloud") return "cline.code.cloud-model-selection.v1";
	if (scope === "factory-manager") return FACTORY_MANAGER_MODEL_STORAGE_KEY;
	return MODEL_SELECTION_STORAGE_KEY;
}

export function readExecutionTargetFromWindow(): ExecutionTarget {
	try {
		return typeof window !== "undefined" &&
			JSON.parse(
				window.localStorage.getItem(EXECUTION_TARGET_STORAGE_KEY) ?? "null",
			)?.target === "cloud"
			? "cloud"
			: "local";
	} catch {
		return "local";
	}
}

export function writeExecutionTargetToWindow(target: ExecutionTarget): void {
	try {
		if (typeof window !== "undefined") {
			window.localStorage.setItem(
				EXECUTION_TARGET_STORAGE_KEY,
				JSON.stringify({ target }),
			);
		}
	} catch {
		// Ignore localStorage persistence failures.
	}
}
