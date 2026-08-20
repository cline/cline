import {
	getModelsForProvider,
	getProvider,
	getProviderIds,
	type ModelInfo,
} from "@cline/llms";
import {
	gatewayProviderSettingsPath,
	readSavedProviderSelection,
} from "@cline/gateway/client";

const COLORS = [
	"#c4956a",
	"#6b8aad",
	"#e8963a",
	"#5b9bd5",
	"#6bbd7b",
	"#9b7dd4",
	"#d07f68",
	"#57a6a1",
] as const;

function color(id: string): string {
	let hash = 0;
	for (const character of id) {
		hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
	}
	return COLORS[hash % COLORS.length];
}

function letter(name: string): string {
	const words = name.split(/\s+/).filter(Boolean);
	if (words.length === 0) return "?";
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function model(id: string, info: ModelInfo) {
	return {
		id,
		name: info.name ?? id,
		operation: info.operation,
		operationModes: info.operationModes,
		contextWindow: info.contextWindow,
		supportsAttachments: info.capabilities?.includes("files"),
		supportsVision: info.capabilities?.includes("images"),
		supportsReasoning:
			info.capabilities?.includes("reasoning") || info.thinkingConfig != null,
		inputModalities: info.modalities?.input,
		outputModalities: info.modalities?.output,
	};
}

export async function listProviderModels(providerId: string) {
	const id = providerId.trim();
	const models = await getModelsForProvider(id);
	return {
		providerId: id,
		models: Object.entries(models)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([modelId, info]) => model(modelId, info)),
	};
}

export async function listProviderCatalog() {
	const providers = await Promise.all(
		getProviderIds().map(async (id) => {
			const [info, modelResponse] = await Promise.all([
				getProvider(id),
				listProviderModels(id),
			]);
			const saved = readSavedProviderSelection(id)?.settings;
			const name = info?.name ?? id;
			return {
				id,
				name,
				models: modelResponse.models.length,
				color: color(id),
				letter: letter(name),
				enabled: saved !== undefined,
				apiKey: saved?.apiKey ?? saved?.auth?.apiKey,
				oauthAccessTokenPresent: Boolean(saved?.auth?.accessToken?.trim()),
				baseUrl: saved?.baseUrl ?? info?.baseUrl,
				defaultModelId: info?.defaultModelId,
				capabilities: info?.capabilities,
				authDescription: "This provider uses API keys for authentication.",
				baseUrlDescription: "The base endpoint to use for provider requests.",
				modelList: modelResponse.models,
				_rank:
					typeof info?.metadata?.popularRank === "number"
						? info.metadata.popularRank
						: Number.MAX_SAFE_INTEGER,
			};
		}),
	);
	providers.sort(
		(left, right) =>
			left._rank - right._rank ||
			left.name.localeCompare(right.name) ||
			left.id.localeCompare(right.id),
	);
	return {
		providers: providers.map(({ _rank, ...provider }) => provider),
		settingsPath: gatewayProviderSettingsPath(),
	};
}
