import { fuzzyScore, type ModelSearchCandidate } from "./model-search";

/**
 * Structural view of a Cline recommended-models feed entry. Hosts fetch the
 * feed (e.g. via @cline/core's fetchClineRecommendedModels) and pass the
 * data in; names arrive display-ready.
 */
export interface ClineFeaturedModel {
	id: string;
	name: string;
	description: string;
	tags: string[];
}

export interface ClineFeaturedModelsData {
	recommended: ClineFeaturedModel[];
	free: ClineFeaturedModel[];
	clinePass: ClineFeaturedModel[];
}

export type ClineModelPickerTier = "recommended" | "subscribed" | "free";

export interface ClineModelPickerItem {
	kind: "model";
	model: ClineFeaturedModel;
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
	data: ClineFeaturedModelsData,
): ClineModelPickerEntry[] {
	return providerId === "cline-pass"
		? buildClinePassModelEntries(data)
		: buildClineModelEntries(data);
}

function buildClineModelEntries(
	data: ClineFeaturedModelsData,
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
	data: ClineFeaturedModelsData,
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

/** A row in the featured picker's search results. */
export interface ClineModelSearchRow {
	id: string;
	name: string;
	tags: string[];
	/** Set when the row came from the featured sections. */
	tier?: ClineModelPickerTier;
}

/**
 * Search across the featured entries and the full model catalog. Featured
 * matches come first in their section order — recommended on top — followed
 * by remaining catalog matches ranked by fuzzy score. Catalog models already
 * shown as featured matches are deduplicated by id.
 */
export function searchFeaturedModels(input: {
	entries: ClineModelPickerEntry[];
	allModels: ModelSearchCandidate[];
	query: string;
}): ClineModelSearchRow[] {
	const query = input.query.trim().toLowerCase();
	if (!query) {
		return [];
	}

	const featuredMatches: ClineModelSearchRow[] = [];
	const featuredMatchIds = new Set<string>();
	for (const entry of input.entries) {
		if (entry.kind !== "model") continue;
		const score = fuzzyScore(
			{ key: entry.model.id, name: entry.model.name || entry.model.id },
			query,
		);
		if (score > 0) {
			featuredMatches.push({
				id: entry.model.id,
				name: entry.model.name || entry.model.id,
				tags: entry.model.tags,
				tier: entry.tier,
			});
			featuredMatchIds.add(entry.model.id);
		}
	}

	const catalogMatches = input.allModels
		.filter((model) => !featuredMatchIds.has(model.key))
		.map((model) => ({ model, score: fuzzyScore(model, query) }))
		.filter((result) => result.score > 0);
	catalogMatches.sort((a, b) => b.score - a.score);

	return [
		...featuredMatches,
		...catalogMatches.map(({ model }) => ({
			id: model.key,
			name: model.name,
			tags: [],
		})),
	];
}
