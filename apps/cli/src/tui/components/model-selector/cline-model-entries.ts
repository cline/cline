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

// Featured entries for the sectioned picker, keyed by provider: cline gets
// Recommended/Free with a browse-all escape into the full catalog; cline-pass
// gets Subscribed/Free (see buildClinePassModelEntries for why no browse-all).
export function buildFeaturedModelEntries(
	providerId: string,
	data: ClineRecommendedModelsData,
): ClineModelPickerEntry[] {
	return providerId === "cline-pass"
		? buildClinePassModelEntries(data)
		: buildClineModelEntries(data);
}

function buildClineModelEntries(
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

// Shown under the Free section header when picking a model for ClinePass
export const CLINE_PASS_FREE_SECTION_DESCRIPTION =
	"Try with limited usage, separate from ClinePass quota.";

// ClinePass shows the subscription's models plus the Cline free models — both
// providers hit the same Cline API, so free models are selectable in place
// (they ride usage billing at $0 instead of the subscription quota).
// No "browse all" entry when the clinePass bucket is populated: unlike cline,
// the ClinePass catalog contains exactly these two buckets, so the sections
// already list every selectable model. An empty clinePass bucket means the
// fetch fell back to the bundled list (which has no pass models) — without an
// escape into the full catalog a subscriber could only pick free models, so
// browse-all comes back in that degraded mode.
function buildClinePassModelEntries(
	data: ClineRecommendedModelsData,
): ClineModelPickerEntry[] {
	const entries: ClineModelPickerEntry[] = [];
	for (const m of data.clinePass) {
		entries.push({ kind: "model", model: m, tier: "subscribed" });
	}
	for (const m of data.free) {
		entries.push({ kind: "model", model: m, tier: "free" });
	}
	if (data.clinePass.length === 0) {
		entries.push({ kind: "browse" });
	}
	return entries;
}

// The quota explainer only makes sense in the ClinePass picker, which is the
// only picker that has a "subscribed" section
export function freeTierDescriptionFor(
	entries: ClineModelPickerEntry[],
): string | undefined {
	const isClinePassPicker = entries.some(
		(entry) => entry.kind === "model" && entry.tier === "subscribed",
	);
	return isClinePassPicker ? CLINE_PASS_FREE_SECTION_DESCRIPTION : undefined;
}

// OpenRouter marks free variants with "(free)" in names and ":free" in ids to
// disambiguate them from their paid twins. Inside the sectioned pickers the
// Free header already says it, so the markers are redundant — but keep them in
// flat lists (e.g. browse-all), where both variants appear side by side.
export function stripFreeMarker(displayName: string): string {
	return displayName
		.replace(/\s*\(free\)\s*$/i, "")
		.replace(/:free$/i, "")
		.trim();
}
