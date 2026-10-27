import type { CloudModelOption } from "@/cloud";
import { modelDisplayName } from "@/cloud/model-display";
import type { ModelCatalogView } from "@/session";

export function localModelOptions(
	catalog: ModelCatalogView,
): (CloudModelOption & { providerId: string })[] {
	return catalog.providers.flatMap((provider) =>
		provider.enabled
			? (catalog.modelsByProvider[provider.id] ?? []).map((model) => ({
					id: model.id,
					name: modelDisplayName(model.id, model.name),
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
