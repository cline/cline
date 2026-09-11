import { createVertex } from "@ai-sdk/google-vertex";
import { createVertexAnthropic } from "@ai-sdk/google-vertex/anthropic";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { ensureFetch, resolveApiKey } from "../http";
import { isClaudeModelId } from "../model-facts";
import type { ProviderFactoryResult } from "./types";

type VertexProviderSettings = NonNullable<Parameters<typeof createVertex>[0]>;
type VertexGoogleAuthOptions = NonNullable<
	VertexProviderSettings["googleAuthOptions"]
>;

function createGoogleAuthOptions(
	projectId: string | undefined,
	fetchImplementation: typeof fetch,
): VertexGoogleAuthOptions {
	return {
		...(projectId ? { projectId } : {}),
		clientOptions: {
			transporterOptions: {
				fetchImplementation,
			},
		},
	};
}

function readStringOption(
	options: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = options?.[key];
	return typeof value === "string" && value.trim().length > 0
		? value
		: undefined;
}

function readNestedStringOption(
	options: Record<string, unknown> | undefined,
	objectKey: string,
	key: string,
): string | undefined {
	const object = options?.[objectKey];
	if (!object || typeof object !== "object" || Array.isArray(object)) {
		return undefined;
	}
	const value = (object as Record<string, unknown>)[key];
	return typeof value === "string" && value.trim().length > 0
		? value
		: undefined;
}

export async function createVertexProviderModule(
	config: GatewayResolvedProviderConfig,
	context: GatewayProviderContext,
): Promise<ProviderFactoryResult> {
	const project =
		readStringOption(config.options, "project") ??
		readStringOption(config.options, "projectId") ??
		readNestedStringOption(config.options, "gcp", "projectId") ??
		"";
	const location =
		readStringOption(config.options, "location") ??
		readStringOption(config.options, "region") ??
		readNestedStringOption(config.options, "gcp", "region") ??
		"us-central1";
	const googleAuthProjectId = project || undefined;
	const fetch = ensureFetch(config.fetch);
	const googleAuthOptions = createGoogleAuthOptions(googleAuthProjectId, fetch);

	if (isClaudeModelId(context.model.id)) {
		const provider = createVertexAnthropic({
			project,
			location,
			googleAuthOptions,
			baseURL: config.baseUrl,
			headers: config.headers,
			fetch,
		});
		return { operations: { language: (modelId) => provider(modelId) } };
	}

	const provider = createVertex({
		project,
		location,
		apiKey: googleAuthProjectId ? undefined : await resolveApiKey(config),
		googleAuthOptions: googleAuthProjectId ? googleAuthOptions : undefined,
		baseURL: config.baseUrl,
		headers: config.headers,
		fetch,
	});
	return {
		buildModelTools: (tools) => {
			const result: ReturnType<
				NonNullable<ProviderFactoryResult["buildModelTools"]>
			> = {};
			for (const tool of tools) {
				if (tool.name === "web_search") {
					result.web_search = { tool: provider.tools.googleSearch({}) };
				}
			}
			return result;
		},
		operations: {
			language: (modelId) => provider(modelId),
			imageGeneration: (modelId) => provider.image(modelId),
		},
	};
}
