import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import type { ToolSet } from "ai";
import { resolveApiKey } from "../http";
import type { ProviderFactoryResult } from "./types";

export async function createGoogleProviderModule(
	config: GatewayResolvedProviderConfig,
	context: GatewayProviderContext,
): Promise<ProviderFactoryResult> {
	const apiKey = await resolveApiKey(config);
	const provider = createGoogleGenerativeAI({
		apiKey,
		headers: config.headers,
		fetch: config.fetch,
		name: context.provider.id,
	});
	return {
		buildModelTools: (tools) => {
			const result: ToolSet = {};
			for (const tool of tools) {
				if (tool.name === "web_search") {
					result.web_search = provider.tools.googleSearch({});
				}
			}
			return result;
		},
		model: (modelId) => provider(modelId),
	};
}
