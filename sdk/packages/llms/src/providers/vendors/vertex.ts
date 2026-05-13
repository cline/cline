import { createVertex } from "@ai-sdk/google-vertex";
import { createVertexAnthropic } from "@ai-sdk/google-vertex/anthropic";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { resolveApiKey } from "../http";
import type { ProviderFactoryResult } from "./types";

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

	if (context.model.id.toLowerCase().includes("claude")) {
		const provider = createVertexAnthropic({
			project,
			location,
			baseURL: config.baseUrl,
			headers: config.headers,
			fetch: config.fetch,
		});
		return { model: (modelId) => provider(modelId) };
	}

	const provider = createVertex({
		project,
		location,
		apiKey: await resolveApiKey(config),
		baseURL: config.baseUrl,
		headers: config.headers,
		fetch: config.fetch,
	});
	return {
		model: (modelId) => provider(modelId),
	};
}
