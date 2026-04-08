import { MODEL_COLLECTION_LIST } from "../../models/provider-catalog";
import type {
	ModelInfo,
	ProviderCapability,
	ProviderClient,
	ProviderProtocol,
} from "../../models/types";

export type BuiltInProviderFamily =
	| "anthropic"
	| "gemini"
	| "vertex"
	| "bedrock"
	| "openai-compatible"
	| "openai-responses"
	| "openai-base"
	| "asksage"
	| "claude-code"
	| "openai-codex"
	| "opencode"
	| "mistral"
	| "dify"
	| "sapaicore"
	| "oca";

export interface BuiltInProviderManifest {
	id: string;
	family: BuiltInProviderFamily;
	baseUrl: string;
	modelId: string;
	knownModels?: Record<string, ModelInfo>;
	capabilities?: ProviderCapability[];
	env?: readonly string[];
	client: ProviderClient;
	protocol?: ProviderProtocol;
}

function cloneKnownModels(
	models: Record<string, ModelInfo>,
): Record<string, ModelInfo> {
	return Object.fromEntries(
		Object.entries(models).map(([id, info]) => [id, { ...info }]),
	);
}

const EXPLICIT_FAMILY_BY_PROVIDER_ID: Partial<
	Record<string, BuiltInProviderFamily>
> = {
	asksage: "asksage",
	"claude-code": "claude-code",
	dify: "dify",
	mistral: "mistral",
	oca: "oca",
	"openai-codex": "openai-codex",
	opencode: "opencode",
	sapaicore: "sapaicore",
};

function resolveProviderFamily(input: {
	id: string;
	client: ProviderClient;
	protocol?: ProviderProtocol;
}): BuiltInProviderFamily | undefined {
	const explicit = EXPLICIT_FAMILY_BY_PROVIDER_ID[input.id];
	if (explicit) {
		return explicit;
	}

	switch (input.client) {
		case "anthropic":
			return "anthropic";
		case "gemini":
			return "gemini";
		case "vertex":
			return "vertex";
		case "bedrock":
			return "bedrock";
		case "openai":
			return "openai-responses";
		case "fetch":
			return "openai-base";
		case "openai-compatible":
		case "openai-r1":
			return "openai-compatible";
	}

	switch (input.protocol) {
		case "openai-responses":
			return "openai-responses";
		case "openai-chat":
		case "openai-r1":
			return "openai-compatible";
	}

	return undefined;
}

const BUILTIN_PROVIDER_MANIFESTS = MODEL_COLLECTION_LIST.flatMap(
	(collection) => {
		const family = resolveProviderFamily({
			id: collection.provider.id,
			client: collection.provider.client,
			protocol: collection.provider.protocol,
		});
		if (!family) {
			return [];
		}

		return [
			{
				id: collection.provider.id,
				family,
				baseUrl: collection.provider.baseUrl ?? "",
				modelId: collection.provider.defaultModelId,
				knownModels: cloneKnownModels(collection.models),
				capabilities: collection.provider.capabilities
					? [...collection.provider.capabilities]
					: undefined,
				env: collection.provider.env ? [...collection.provider.env] : undefined,
				client: collection.provider.client,
				protocol: collection.provider.protocol,
			} satisfies BuiltInProviderManifest,
		];
	},
);

export const BUILTIN_PROVIDER_MANIFESTS_BY_ID: Record<
	string,
	BuiltInProviderManifest
> = Object.fromEntries(
	BUILTIN_PROVIDER_MANIFESTS.map((manifest) => [manifest.id, manifest]),
);

const OPENAI_COMPATIBLE_PROVIDER_MANIFESTS: Record<
	string,
	BuiltInProviderManifest
> = Object.fromEntries(
	Object.entries(BUILTIN_PROVIDER_MANIFESTS_BY_ID).filter(
		([, manifest]) =>
			manifest.baseUrl.length > 0 &&
			(manifest.family === "openai-compatible" ||
				manifest.family === "openai-responses" ||
				manifest.family === "openai-base" ||
				manifest.family === "asksage" ||
				manifest.family === "oca"),
	),
);

export function getBuiltInProviderManifest(
	providerId: string,
): BuiltInProviderManifest | undefined {
	return BUILTIN_PROVIDER_MANIFESTS_BY_ID[providerId];
}

export function getOpenAICompatibleProviderManifests(): Record<
	string,
	BuiltInProviderManifest
> {
	return OPENAI_COMPATIBLE_PROVIDER_MANIFESTS;
}

export function getBuiltInProviderEnvKeys(
	providerId: string,
): readonly string[] {
	return getBuiltInProviderManifest(providerId)?.env ?? [];
}
