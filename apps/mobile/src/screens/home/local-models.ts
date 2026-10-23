import type { CloudModelOption } from "@/cloud";
import type { ModelCatalogView } from "@/session";

export function localModelOptions(
	catalog: ModelCatalogView,
): (CloudModelOption & { providerId: string })[] {
	return catalog.providers.flatMap((provider) =>
		provider.enabled
			? (catalog.modelsByProvider[provider.id] ?? []).map((model) => ({
					id: model.id,
					name: model.name?.trim() || model.id,
					providerId: provider.id,
					supportsReasoning: model.supportsThinking,
					tags: [
						provider.name,
						...(model.supportsThinking ? ["thinking"] : []),
					],
				}))
			: [],
	);
}
