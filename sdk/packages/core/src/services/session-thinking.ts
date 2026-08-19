import {
	REASONING_EFFORT_RATIOS,
	type ReasoningEffortValue,
} from "@cline/shared";
import type { SessionThinkingMetadata } from "../types/sessions";

/**
 * Persisted thinking-level metadata, stored under `metadata.thinking` on the
 * session row and in the session manifest JSON.
 *
 * The session config carries the user's choice as three loosely coupled fields
 * (`thinking`, `reasoningEffort`, `thinkingBudgetTokens`); these helpers fold
 * them into one normalized record so readers do not have to repeat the
 * "which field wins" rules.
 */

function normalizeThinkingLevel(
	value: unknown,
): ReasoningEffortValue | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	// "none" is represented by `enabled: false`, never as a level.
	if (!normalized || normalized === "none") return undefined;
	return normalized in REASONING_EFFORT_RATIOS
		? (normalized as ReasoningEffortValue)
		: undefined;
}

function normalizeBudgetTokens(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.trunc(value)
		: undefined;
}

function buildThinkingMetadata(
	enabled: boolean,
	level: ReasoningEffortValue | undefined,
	budgetTokens: number | undefined,
): SessionThinkingMetadata {
	if (!enabled) return { enabled: false };
	return {
		enabled: true,
		...(level ? { level } : {}),
		...(budgetTokens !== undefined ? { budgetTokens } : {}),
	};
}

/** Derive the persisted shape from a session/provider config. */
export function resolveSessionThinkingMetadata(config: {
	thinking?: boolean;
	reasoningEffort?: string;
	thinkingBudgetTokens?: number;
}): SessionThinkingMetadata {
	const level = normalizeThinkingLevel(config.reasoningEffort);
	const budgetTokens = normalizeBudgetTokens(config.thinkingBudgetTokens);
	// An effort or budget implies thinking even when the boolean is unset:
	// providers treat either as a request to reason.
	const enabled =
		config.thinking === true ||
		level !== undefined ||
		budgetTokens !== undefined;
	return buildThinkingMetadata(enabled, level, budgetTokens);
}

/**
 * Merge a partial connection update into the current thinking metadata,
 * mirroring how the live agent's `updateConnection` folds partial reasoning
 * fields into its existing config. Recomputing from the session config
 * instead would drop reasoning the session inherited from persisted provider
 * settings, which only the effective bootstrap config ever carried.
 */
export function applySessionThinkingConnectionUpdate(
	current: SessionThinkingMetadata | undefined,
	updates: {
		thinking?: boolean | null;
		reasoningEffort?: string | null;
		thinkingBudgetTokens?: number | null;
	},
): SessionThinkingMetadata {
	// Reconstruct the config-field view of the current state. `enabled` with a
	// level or budget may or may not have had the boolean set; `enabled` with
	// neither can only have come from an explicit `thinking: true`.
	let level = current?.enabled === true ? current.level : undefined;
	let budgetTokens =
		current?.enabled === true ? current.budgetTokens : undefined;
	let thinking: boolean | undefined =
		current?.enabled === true &&
		level === undefined &&
		budgetTokens === undefined
			? true
			: undefined;
	// Mirror the agent's `updateConnection`: only fields present in the update
	// replace the current value, and disabling thinking clears effort/budget.
	if (Object.hasOwn(updates, "reasoningEffort")) {
		level = normalizeThinkingLevel(updates.reasoningEffort ?? undefined);
	}
	if (Object.hasOwn(updates, "thinkingBudgetTokens")) {
		budgetTokens = normalizeBudgetTokens(
			updates.thinkingBudgetTokens ?? undefined,
		);
	}
	if (Object.hasOwn(updates, "thinking")) {
		thinking = updates.thinking ?? undefined;
		if (updates.thinking === false || updates.thinking === null) {
			level = undefined;
			budgetTokens = undefined;
		}
	}
	return buildThinkingMetadata(
		thinking === true || level !== undefined || budgetTokens !== undefined,
		level,
		budgetTokens,
	);
}

/** Read back what was persisted, ignoring malformed values. */
export function readSessionThinkingMetadata(
	metadata: Record<string, unknown> | undefined,
): SessionThinkingMetadata | undefined {
	const thinking = metadata?.thinking;
	if (!thinking || typeof thinking !== "object" || Array.isArray(thinking)) {
		return undefined;
	}
	const record = thinking as Record<string, unknown>;
	return buildThinkingMetadata(
		record.enabled === true,
		normalizeThinkingLevel(record.level),
		normalizeBudgetTokens(record.budgetTokens),
	);
}

export function withSessionThinkingMetadata(
	metadata: Record<string, unknown> | undefined,
	thinking: SessionThinkingMetadata,
): Record<string, unknown> {
	return { ...(metadata ?? {}), thinking };
}

export function hasCurrentSessionThinkingMetadata(
	metadata: Record<string, unknown> | undefined,
	thinking: SessionThinkingMetadata,
): boolean {
	const current = readSessionThinkingMetadata(metadata);
	return (
		current?.enabled === thinking.enabled &&
		current?.level === thinking.level &&
		current?.budgetTokens === thinking.budgetTokens
	);
}
