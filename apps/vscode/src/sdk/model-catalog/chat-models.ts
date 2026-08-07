import { type ChatModelModalities, supportsChatModalities } from "@cline/shared"

type ChatCatalogModel = {
	readonly modalities?: ChatModelModalities
}

export function filterChatModelMap<T extends ChatCatalogModel>(models: ReadonlyMap<string, T>): Map<string, T> {
	return new Map([...models].filter(([, model]) => supportsChatModalities(model.modalities)))
}

export function resolveChatModelDefault(
	defaultModelId: string | undefined,
	models: ReadonlyMap<string, unknown>,
): string | undefined {
	return defaultModelId && models.has(defaultModelId) ? defaultModelId : models.keys().next().value
}
