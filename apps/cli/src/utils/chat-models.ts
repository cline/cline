import {
	type ChatModelModalities,
	type ModelModality,
	supportsChatModalities,
} from "@cline/shared";

export type ChatCatalogModel = {
	readonly modalities?: ChatModelModalities;
	readonly [key: string]: unknown;
};

export function filterChatModels<T extends ChatCatalogModel>(
	models: Readonly<Record<string, T>>,
): Record<string, T> {
	return Object.fromEntries(
		Object.entries(models).filter(([, model]) =>
			supportsChatModalities(model.modalities),
		),
	);
}

export function isChatProviderModel(model: {
	readonly inputModalities?: readonly ModelModality[];
	readonly outputModalities?: readonly ModelModality[];
}): boolean {
	return supportsChatModalities({
		input: model.inputModalities,
		output: model.outputModalities,
	});
}
