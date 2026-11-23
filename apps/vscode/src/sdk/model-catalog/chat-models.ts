import { type ChatModelModalities, isChatCompatibleModel, type ModelOperation } from "@cline/shared"

type ChatCatalogModel = {
	readonly operation?: ModelOperation
	readonly modalities?: ChatModelModalities
}

export function filterChatModelMap<T extends ChatCatalogModel>(models: ReadonlyMap<string, T>): Map<string, T> {
	return new Map([...models].filter(([, model]) => isChatCompatibleModel(model)))
}

export function resolveChatModelDefault(
	defaultModelId: string | undefined,
	models: ReadonlyMap<string, unknown>,
): string | undefined {
	return defaultModelId && models.has(defaultModelId) ? defaultModelId : undefined
}
