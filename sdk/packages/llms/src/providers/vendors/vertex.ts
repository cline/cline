import { createVertex } from "@ai-sdk/google-vertex";
import { createVertexAnthropic } from "@ai-sdk/google-vertex/anthropic";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { ensureFetch, resolveApiKey } from "../http";
import { isClaudeModelId } from "../model-facts";
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
	const googleAuthProjectId =
		typeof config.options?.project === "string"
			? config.options.project
			: typeof config.options?.projectId === "string"
				? config.options.projectId
				: undefined;
	const fetch = ensureFetch(config.fetch);

	if (isClaudeModelId(context.model.id)) {
		const provider = createVertexAnthropic({
			project,
			location,
			baseURL: config.baseUrl,
			headers: config.headers,
			fetch,
		});
		return { model: (modelId) => provider(modelId) };
	}

	const provider = createVertex({
		project,
		location,
		apiKey: googleAuthProjectId ? undefined : await resolveApiKey(config),
		googleAuthOptions: googleAuthProjectId
			? {
					projectId: googleAuthProjectId,
				}
			: undefined,
		baseURL: config.baseUrl,
		headers: config.headers,
		fetch,
	});
	return {
		model: (modelId) => provider(modelId),
	};
}
