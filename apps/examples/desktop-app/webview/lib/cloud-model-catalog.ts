import type { CloudModel } from "@cline/core/cloud";
import { desktopClient } from "@/lib/desktop-client";
import { loadProviderModels } from "@/lib/provider-model-catalog";
import type { ProviderModel } from "@/lib/provider-schema";

export type CloudPickerModel = CloudModel & ProviderModel;

export async function loadCloudModelCatalog(): Promise<CloudPickerModel[]> {
	const [models, cline, pass] = await Promise.all([
		desktopClient.invoke<CloudModel[]>("list_cloud_models"),
		loadProviderModels("cline", { includeCloudModels: true }).catch(() => []),
		loadProviderModels("cline-pass").catch(() => []),
	]);
	const details = new Map(
		[...cline, ...pass].map((model) => [model.id, model]),
	);
	// Only the account-scoped cloud catalog controls availability. Local
	// provider metadata supplies optional capabilities, never extra choices.
	return models.map((model) => ({ ...details.get(model.id), ...model }));
}

export function cloudCatalogId(model: string): CloudModel["catalogId"] {
	if (model.startsWith("cline-pass/")) return "cline-pass";
	if (model.startsWith("cline-cloud/")) return "cline-cloud";
	return "cline";
}
