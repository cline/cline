import type { ProviderSettings } from "@cline/core"
import type { BedrockConnection, ProviderConfig } from "@cline/llms"
import { type ApiConfiguration, BEDROCK_DEFAULT_REGION } from "@shared/api"

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function buildBedrockConnection(configuration: ApiConfiguration): BedrockConnection {
	return {
		region: optionalString(configuration.awsRegion) ?? BEDROCK_DEFAULT_REGION,
		profile: optionalString(configuration.awsProfile),
		endpoint: optionalString(configuration.awsBedrockEndpoint),
		caBundlePath: optionalString(configuration.awsBedrockCaBundlePath),
		controlPlaneEndpoint: optionalString(configuration.awsBedrockControlPlaneEndpoint),
	}
}

export type BedrockProviderConfig = Pick<ProviderConfig, "providerId" | "modelId" | "connection" | "workspaceRoot">

export function buildBedrockProviderConfig(
	configuration: ApiConfiguration,
	modelId: string,
	workspaceRoot?: string,
): BedrockProviderConfig {
	return {
		providerId: "bedrock",
		modelId,
		connection: buildBedrockConnection(configuration),
		workspaceRoot,
	}
}

export function buildBedrockProviderSettings(configuration: ApiConfiguration, modelId: string): ProviderSettings {
	return {
		provider: "bedrock",
		model: modelId,
		connection: buildBedrockConnection(configuration),
	}
}
