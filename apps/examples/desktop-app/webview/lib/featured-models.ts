"use client";

import type { SearchComboboxOption, SearchComboboxSection } from "@cline/ui";
import { desktopClient } from "@/lib/desktop-client";
import type { ProviderModel } from "@/lib/provider-schema";

/** One entry from the Cline recommended-models feed (display-ready name). */
export type FeaturedModel = {
	id: string;
	name: string;
	description: string;
	tags: string[];
};

export type FeaturedModelsData = {
	recommended: FeaturedModel[];
	free: FeaturedModel[];
	clinePass: FeaturedModel[];
};

export const EMPTY_FEATURED_MODELS: FeaturedModelsData = {
	recommended: [],
	free: [],
	clinePass: [],
};

let featuredModelsCache: Promise<FeaturedModelsData> | null = null;

/**
 * Loads the tiered Cline model feed (recommended / free / clinePass) through
 * the sidecar. Cached for the app's lifetime — the sidecar already falls back
 * to a bundled list offline, so a resolved value is always renderable.
 * Failures resolve to empty tiers (the picker degrades to a flat catalog)
 * and are not cached, so a later composer mount retries.
 */
export function loadClineFeaturedModels(): Promise<FeaturedModelsData> {
	if (featuredModelsCache) {
		return featuredModelsCache;
	}
	const request = desktopClient
		.invoke<FeaturedModelsData>("list_cline_recommended_models")
		.then((data) => ({
			recommended: data?.recommended ?? [],
			free: data?.free ?? [],
			clinePass: data?.clinePass ?? [],
		}))
		.catch(() => {
			if (featuredModelsCache === request) {
				featuredModelsCache = null;
			}
			return EMPTY_FEATURED_MODELS;
		});
	featuredModelsCache = request;
	return request;
}

export type ModelPickerData = {
	options: SearchComboboxOption[];
	sections?: SearchComboboxSection[];
};

// Section copy mirrors the CLI's featured picker so the products read the same.
const FREE_SECTION_DESCRIPTION = "Try with limited usage at no cost";
const CLINE_PASS_FREE_SECTION_DESCRIPTION =
	"Try with limited usage, separate from ClinePass quota";

/**
 * Resolves a feed model id against the provider's catalog ids. The feed can
 * spell a model differently from the catalog (Vercel-style vs OpenRouter
 * aliases), so fall back to a unique match on the id's slug after "/".
 */
function resolveCatalogId(
	featuredId: string,
	catalogIds: Set<string>,
	catalogIdsBySlug: Map<string, string[]>,
): string | undefined {
	if (catalogIds.has(featuredId)) {
		return featuredId;
	}
	const slug = featuredId.split("/").at(-1) ?? featuredId;
	const candidates = catalogIdsBySlug.get(slug);
	return candidates?.length === 1 ? candidates[0] : undefined;
}

function displayName(model: ProviderModel): string {
	return model.name?.trim() || model.id;
}

function byLabel(a: SearchComboboxOption, b: SearchComboboxOption): number {
	return a.label.localeCompare(b.label);
}

/**
 * Builds the sectioned model picker for a provider. The `cline` provider gets
 * Recommended / Free / All models; `cline-pass` gets Subscribed / Free (its
 * catalog contains exactly those two tiers). Every other provider renders its
 * catalog as a flat list ordered by display name.
 *
 * Feed entries are only surfaced when they resolve to a model that exists in
 * the provider's catalog — the composer treats the catalog as the set of
 * selectable ids, and an unselectable "recommendation" is worse than none.
 */
export function buildModelPickerData(
	providerId: string,
	models: ProviderModel[],
	featured: FeaturedModelsData,
): ModelPickerData {
	const catalogIds = new Set(models.map((model) => model.id));
	const catalogIdsBySlug = new Map<string, string[]>();
	for (const model of models) {
		const slug = model.id.split("/").at(-1) ?? model.id;
		const bucket = catalogIdsBySlug.get(slug);
		if (bucket) {
			bucket.push(model.id);
		} else {
			catalogIdsBySlug.set(slug, [model.id]);
		}
	}

	const usedIds = new Set<string>();
	const featuredOptions = (
		entries: FeaturedModel[],
		section: string,
		badge?: (entry: FeaturedModel) => string | undefined,
	): SearchComboboxOption[] => {
		const options: SearchComboboxOption[] = [];
		for (const entry of entries) {
			const catalogId = resolveCatalogId(
				entry.id,
				catalogIds,
				catalogIdsBySlug,
			);
			if (!catalogId || usedIds.has(catalogId)) {
				continue;
			}
			usedIds.add(catalogId);
			options.push({
				badge: badge?.(entry),
				description: entry.description.trim() || undefined,
				label: entry.name.trim() || catalogId,
				section,
				value: catalogId,
			});
		}
		return options;
	};

	if (providerId === "cline") {
		const recommended = featuredOptions(
			featured.recommended,
			"recommended",
			(entry) => entry.tags[0],
		);
		const free = featuredOptions(featured.free, "free", () => "Free");
		const rest = models
			.filter((model) => !usedIds.has(model.id))
			.map((model) => ({
				label: displayName(model),
				section: "all",
				value: model.id,
			}))
			.sort(byLabel);
		if (recommended.length === 0 && free.length === 0) {
			return {
				options: rest.map(({ section: _section, ...option }) => option),
			};
		}
		return {
			options: [...recommended, ...free, ...rest],
			sections: [
				{ id: "recommended", label: "Recommended" },
				{
					description: FREE_SECTION_DESCRIPTION,
					id: "free",
					label: "Free",
				},
				{ id: "all", label: "All models" },
			],
		};
	}

	if (providerId === "cline-pass") {
		const subscribed = featuredOptions(featured.clinePass, "subscribed");
		const free = featuredOptions(featured.free, "free", () => "Free");
		if (subscribed.length === 0 && free.length === 0) {
			return {
				options: models
					.map((model) => ({ label: displayName(model), value: model.id }))
					.sort(byLabel),
			};
		}
		// The ClinePass offer is exactly the subscribed + free tiers (CLI
		// parity). Catalog entries outside the feed are stale bundled/cached
		// models, not part of the plan — hide them rather than advertise them
		// under an "All models" tier. The full catalog only comes back when
		// the subscribed bucket is empty (offline/degraded fallback), so a
		// subscriber is never limited to free models.
		const rest =
			subscribed.length === 0
				? models
						.filter((model) => !usedIds.has(model.id))
						.map((model) => ({
							label: displayName(model),
							section: "all",
							value: model.id,
						}))
						.sort(byLabel)
				: [];
		return {
			options: [...subscribed, ...free, ...rest],
			sections: [
				{ id: "subscribed", label: "Subscribed" },
				{
					description: CLINE_PASS_FREE_SECTION_DESCRIPTION,
					id: "free",
					label: "Free",
				},
				...(rest.length > 0
					? [{ id: "all", label: "All models" } as SearchComboboxSection]
					: []),
			],
		};
	}

	return {
		options: models
			.map((model) => ({ label: displayName(model), value: model.id }))
			.sort(byLabel),
	};
}
