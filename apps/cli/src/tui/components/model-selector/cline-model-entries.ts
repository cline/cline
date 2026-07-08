import type {
	ClineRecommendedModel,
	ClineRecommendedModelsData,
} from "@cline/core";

export type ClineModelPickerTier = "recommended" | "subscribed" | "free";

export interface ClineModelPickerItem {
	kind: "model";
	model: ClineRecommendedModel;
	tier: ClineModelPickerTier;
}

export interface ClineModelPickerBrowse {
	kind: "browse";
}

export type ClineModelPickerEntry =
	| ClineModelPickerItem
	| ClineModelPickerBrowse;

export const CLINE_MODEL_PICKER_TIER_LABELS: Record<
	ClineModelPickerTier,
	string
> = {
	recommended: "Recommended",
	subscribed: "Subscribed",
	free: "Free",
};

export function buildClineModelEntries(
	data: ClineRecommendedModelsData,
): ClineModelPickerEntry[] {
	const entries: ClineModelPickerEntry[] = [];
	for (const m of data.recommended) {
		entries.push({ kind: "model", model: m, tier: "recommended" });
	}
	for (const m of data.free) {
		entries.push({ kind: "model", model: m, tier: "free" });
	}
	entries.push({ kind: "browse" });
	return entries;
}

// ClinePass shows the subscription's models plus the Cline free models — both
// providers hit the same Cline API, so free models are selectable in place
// (they ride usage billing at $0 instead of the subscription quota).
// No "browse all" entry: unlike cline, the ClinePass catalog contains exactly
// these two buckets, so the sections already list every selectable model.
export function buildClinePassModelEntries(
	data: ClineRecommendedModelsData,
): ClineModelPickerEntry[] {
	const entries: ClineModelPickerEntry[] = [];
	for (const m of data.clinePass) {
		entries.push({ kind: "model", model: m, tier: "subscribed" });
	}
	for (const m of data.free) {
		entries.push({ kind: "model", model: m, tier: "free" });
	}
	return entries;
}
