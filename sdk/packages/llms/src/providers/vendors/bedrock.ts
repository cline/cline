import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import type { GatewayResolvedProviderConfig } from "@cline/shared";
import { resolveApiKey } from "../http";
import type { ProviderFactoryResult } from "./types";

export async function createBedrockProviderModule(
	config: GatewayResolvedProviderConfig,
): Promise<ProviderFactoryResult> {
	const credentialProvider =
		typeof config.options?.credentialProvider === "function"
			? (config.options.credentialProvider as
					| (() => PromiseLike<{
							accessKeyId: string;
							secretAccessKey: string;
							sessionToken?: string;
					  }>)
					| undefined)
			: undefined;

	const provider = createAmazonBedrock({
		region: config.options?.region as string | undefined,
		apiKey: await resolveApiKey(config),
		accessKeyId: config.options?.accessKeyId as string | undefined,
		secretAccessKey: config.options?.secretAccessKey as string | undefined,
		sessionToken: config.options?.sessionToken as string | undefined,
		baseURL: config.baseUrl,
		headers: config.headers,
		fetch: config.fetch,
		credentialProvider,
	});

	return {
		model: (modelId) => provider(modelId),
	};
}
