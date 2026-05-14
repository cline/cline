import { createVertex } from "@ai-sdk/google-vertex";
import { createVertexAnthropic } from "@ai-sdk/google-vertex/anthropic";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { isClaudeModelId } from "../model-facts";
import type { ProviderFactoryResult } from "./types";

type VertexProviderSettings = NonNullable<Parameters<typeof createVertex>[0]>;
type VertexGoogleAuthOptions = NonNullable<
	VertexProviderSettings["googleAuthOptions"]
>;
type VertexGoogleAuthClientOptions = NonNullable<
	VertexGoogleAuthOptions["clientOptions"]
> & {
	transporterOptions?: {
		fetchImplementation?: typeof fetch;
	} & Record<string, unknown>;
};

async function resolveExplicitApiKey(
	config: GatewayResolvedProviderConfig,
): Promise<string | undefined> {
	const explicitApiKey = config.apiKey?.trim();
	if (explicitApiKey) {
		return explicitApiKey;
	}

	const resolvedApiKey = await config.apiKeyResolver?.();
	const trimmedResolvedApiKey = resolvedApiKey?.trim();
	return trimmedResolvedApiKey || undefined;
}

function resolveFetchImplementation(
	config: GatewayResolvedProviderConfig,
): typeof fetch | undefined {
	const fetchImplementation = config.fetch ?? globalThis.fetch;
	return typeof fetchImplementation === "function"
		? fetchImplementation
		: undefined;
}

function resolveGoogleAuthOptions(
	config: GatewayResolvedProviderConfig,
	fetchImplementation: typeof fetch | undefined,
): VertexGoogleAuthOptions | undefined {
	const googleAuthOptions = config.options?.googleAuthOptions as
		| VertexGoogleAuthOptions
		| undefined;

	if (!fetchImplementation) {
		return googleAuthOptions;
	}

	const clientOptions = googleAuthOptions?.clientOptions as
		| VertexGoogleAuthClientOptions
		| undefined;
	const transporterOptions = clientOptions?.transporterOptions;

	return {
		...googleAuthOptions,
		clientOptions: {
			...clientOptions,
			transporterOptions: {
				...transporterOptions,
				fetchImplementation:
					transporterOptions?.fetchImplementation ?? fetchImplementation,
			},
		},
	};
}

export async function createVertexProviderModule(
	config: GatewayResolvedProviderConfig,
	context: GatewayProviderContext,
): Promise<ProviderFactoryResult> {
	const project = String(
		config.options?.project ?? config.options?.projectId ?? "",
	);
	const location = String(
		config.options?.location ?? config.options?.region ?? "us-central1",
	);
	const fetchImplementation = resolveFetchImplementation(config);
	const googleAuthOptions = resolveGoogleAuthOptions(
		config,
		fetchImplementation,
	);
	const baseOptions = {
		project,
		location,
		baseURL: config.baseUrl,
		headers: config.headers,
		...(fetchImplementation ? { fetch: fetchImplementation } : {}),
		...(googleAuthOptions ? { googleAuthOptions } : {}),
	};

	if (isClaudeModelId(context.model.id)) {
		const provider = createVertexAnthropic(baseOptions);
		return { model: (modelId) => provider(modelId) };
	}

	const apiKey = await resolveExplicitApiKey(config);
	const provider = createVertex({
		...baseOptions,
		...(apiKey ? { apiKey } : {}),
	});
	return {
		model: (modelId) => provider(modelId),
	};
}
