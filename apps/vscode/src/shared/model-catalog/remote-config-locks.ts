import type { RemoteConfigFields } from "@shared/storage/state-keys"
import { areProviderIdsEquivalent } from "./provider-helpers"

type RemoteConfigKey = keyof RemoteConfigFields

const REMOTE_LOCKED_FIELD_PATHS: Record<string, Partial<Record<RemoteConfigKey, readonly string[]>>> = {
	anthropic: {
		anthropicBaseUrl: ["baseUrl"],
	},
	bedrock: {
		awsRegion: ["region", "aws.region"],
		awsUseCrossRegionInference: ["aws.useCrossRegionInference"],
		awsUseGlobalInference: ["aws.useGlobalInference"],
		awsBedrockUsePromptCache: ["aws.usePromptCache"],
		awsBedrockEndpoint: ["aws.endpoint"],
	},
	litellm: {
		configuredApiKeys: ["apiKey"],
		liteLlmBaseUrl: ["baseUrl"],
	},
	openai: {
		openAiBaseUrl: ["baseUrl"],
		openAiHeaders: ["headers"],
		azureApiVersion: ["azure.apiVersion"],
	},
	vertex: {
		vertexProjectId: ["gcp.projectId"],
		vertexRegion: ["region", "gcp.region"],
	},
}

function canonicalRemoteProviderId(providerId: string): string {
	return areProviderIdsEquivalent(providerId, "openai-compatible") ? "openai" : providerId
}

export function getRemoteLockedProviderFieldPaths(
	remoteConfigSettings: Partial<RemoteConfigFields> | undefined,
	providerId: string,
): Set<string> {
	const locked = new Set<string>()
	const configuredProviders = remoteConfigSettings?.remoteConfiguredProviders ?? []
	if (!configuredProviders.some((configuredProvider) => areProviderIdsEquivalent(providerId, configuredProvider))) {
		return locked
	}

	const fieldMap = REMOTE_LOCKED_FIELD_PATHS[canonicalRemoteProviderId(providerId)]
	if (!fieldMap) {
		return locked
	}

	for (const [key, paths] of Object.entries(fieldMap) as Array<[RemoteConfigKey, readonly string[]]>) {
		if (remoteConfigSettings?.[key] !== undefined) {
			for (const path of paths) {
				locked.add(path)
			}
		}
	}
	return locked
}
