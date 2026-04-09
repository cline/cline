#!/usr/bin/env bun

import { MODELS_DEV_PROVIDER_KEY_MAP } from "@clinebot/shared";
import { fetchModelsDevProviderModels } from "../../src/model/catalog-live";
import type { ModelInfo } from "../../src/model/types";

function sortObjectByKey<T>(
	input: Record<string, T>,
	order: "asc" | "desc" = "asc",
): Record<string, T> {
	return Object.fromEntries(
		Object.entries(input).sort(([a], [b]) =>
			order === "asc" ? a.localeCompare(b) : b.localeCompare(a),
		),
	);
}

export async function loadModelsDevProviderModels(): Promise<
	Record<string, Record<string, ModelInfo>>
> {
	const providerModels = await fetchModelsDevProviderModels(
		"https://models.dev/api.json",
		MODELS_DEV_PROVIDER_KEY_MAP,
	);
	return sortObjectByKey(providerModels);
}
