#!/usr/bin/env bun

import type { ModelInfo } from "@clinebot/shared";
import { fetchModelsDevProviderModels } from "../../src/catalog/catalog-live";

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
	);
	return sortObjectByKey(providerModels);
}
