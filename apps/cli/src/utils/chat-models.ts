import {
	type ChatModelModalities,
	isChatCompatibleModel,
	type ModelModality,
	type ModelOperation,
} from "@cline/shared";

export type ChatCatalogModel = {
	readonly operation?: ModelOperation;
	readonly modalities?: ChatModelModalities;
	readonly [key: string]: unknown;
};

export function filterChatModels<T extends ChatCatalogModel>(
	models: Readonly<Record<string, T>>,
): Record<string, T> {
	return Object.fromEntries(
		Object.entries(models).filter(([, model]) => isChatCompatibleModel(model)),
	);
}

export function isChatProviderModel(model: {
	readonly operation?: ModelOperation;
	readonly inputModalities?: readonly ModelModality[];
	readonly outputModalities?: readonly ModelModality[];
}): boolean {
	return isChatCompatibleModel({
		operation: model.operation,
		modalities: {
			input: model.inputModalities,
			output: model.outputModalities,
		},
	});
}
