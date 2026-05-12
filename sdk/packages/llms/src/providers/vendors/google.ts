import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
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
		model: (modelId) => provider(modelId),
	};
}
