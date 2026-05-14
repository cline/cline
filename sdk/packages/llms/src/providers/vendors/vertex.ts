import { createVertex } from "@ai-sdk/google-vertex";
import { createVertexAnthropic } from "@ai-sdk/google-vertex/anthropic";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { isClaudeModelId } from "../model-facts";
import type { ProviderFactoryResult } from "./types";

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

	if (isClaudeModelId(context.model.id)) {
		const provider = createVertexAnthropic({
			project,
			location,
			baseURL: config.baseUrl,
			headers: config.headers,
			fetch: config.fetch,
		});
		return { model: (modelId) => provider(modelId) };
	}

	const apiKey = await resolveExplicitApiKey(config);
	const provider = createVertex({
		project,
		location,
		baseURL: config.baseUrl,
		headers: config.headers,
		fetch: config.fetch,
		...(apiKey ? { apiKey } : {}),
	});
	return {
		model: (modelId) => provider(modelId),
	};
}
