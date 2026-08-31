"use client";

import type { SearchComboboxOption, SearchComboboxSection } from "@cline/ui";
import type {
	ProviderModel,
	ProviderModelFeaturedTier,
} from "@/lib/provider-schema";

export type ModelPickerData = {
	options: SearchComboboxOption[];
	sections?: SearchComboboxSection[];
};

// Section copy mirrors the CLI's featured picker so the products read the same.
const FREE_SECTION_DESCRIPTION = "Try with limited usage at no cost";
const CLINE_PASS_FREE_SECTION_DESCRIPTION =
	"Try with limited usage, separate from ClinePass quota";

function displayName(model: ProviderModel): string {
	return model.name?.trim() || model.id;
}

function byLabel(a: SearchComboboxOption, b: SearchComboboxOption): number {
	return a.label.localeCompare(b.label);
}

function flatOptions(models: ProviderModel[]): SearchComboboxOption[] {
	return models
		.map((model) => ({ label: displayName(model), value: model.id }))
		.sort(byLabel);
}

function tierOptions(
	models: ProviderModel[],
	tier: ProviderModelFeaturedTier,
	section: string,
	badge?: (model: ProviderModel) => string | undefined,
): SearchComboboxOption[] {
	return models
		.filter((model) => model.featured?.tier === tier)
		.sort((a, b) => (a.featured?.rank ?? 0) - (b.featured?.rank ?? 0))
		.map((model) => ({
			badge: badge?.(model),
			description: model.description?.trim() || undefined,
			label: displayName(model),
			section,
			value: model.id,
		}));
}

/**
 * Builds the sectioned model picker for a provider from the tier data the SDK
 * stamps onto `ProviderModel.featured` (see @cline/core's
 * applyClineFeaturedModels). The `cline` provider gets Recommended / Free /
 * All models; `cline-pass` gets Subscribed / Free only — its offer is exactly
 * those tiers, and stale catalog leftovers must not be advertised (the full
 * catalog only returns when the subscribed tier is empty, so a subscriber is
 * never limited to free models offline). Every other provider renders its
 * catalog as a flat list ordered by display name.
 */
export function buildModelPickerData(
	providerId: string,
	models: ProviderModel[],
): ModelPickerData {
	if (providerId === "cline") {
		const recommended = tierOptions(
			models,
			"recommended",
			"recommended",
			(model) => model.featured?.tags[0],
		);
		const free = tierOptions(models, "free", "free", () => "Free");
		if (recommended.length === 0 && free.length === 0) {
			return { options: flatOptions(models) };
		}
		const rest = models
			.filter((model) => !model.featured)
			.map((model) => ({
				label: displayName(model),
				section: "all",
				value: model.id,
			}))
			.sort(byLabel);
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
		const subscribed = tierOptions(models, "subscribed", "subscribed");
		const free = tierOptions(models, "free", "free", () => "Free");
		if (subscribed.length === 0 && free.length === 0) {
			return { options: flatOptions(models) };
		}
		const rest =
			subscribed.length === 0
				? models
						.filter((model) => !model.featured)
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

	return { options: flatOptions(models) };
}
