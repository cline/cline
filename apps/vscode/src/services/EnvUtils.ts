import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { EmptyRequest } from "@/shared/proto/bedrock_coder/common"
import { Logger } from "@/shared/services/Logger"

// Canonical header names for extra client/host context
const BedrockCoderHeaders = {
	PLATFORM: "X-PLATFORM",
	PLATFORM_VERSION: "X-PLATFORM-VERSION",
	CLIENT_VERSION: "X-CLIENT-VERSION",
	CLIENT_TYPE: "X-CLIENT-TYPE",
	CORE_VERSION: "X-CORE-VERSION",
	IS_MULTIROOT: "X-IS-MULTIROOT",
} as const

export function buildExternalBasicHeaders(): Record<string, string> {
	return {
		"User-Agent": `BedrockCoder/${ExtensionRegistryInfo.version}`,
	}
}

export async function buildBasicBedrockCoderHeaders(): Promise<Record<string, string>> {
	const headers: Record<string, string> = buildExternalBasicHeaders()
	try {
		const host = await HostProvider.env.getHostVersion(EmptyRequest.create({}))
		headers[BedrockCoderHeaders.PLATFORM] = host.platform || "unknown"
		headers[BedrockCoderHeaders.PLATFORM_VERSION] = host.version || "unknown"
		headers[BedrockCoderHeaders.CLIENT_TYPE] = host.bedrockCoderType || "unknown"
		headers[BedrockCoderHeaders.CLIENT_VERSION] = host.bedrockCoderVersion || "unknown"
	} catch (error) {
		Logger.log("Failed to get IDE/platform info via HostBridge EnvService.getHostVersion", error)
		headers[BedrockCoderHeaders.PLATFORM] = "unknown"
		headers[BedrockCoderHeaders.PLATFORM_VERSION] = "unknown"
		headers[BedrockCoderHeaders.CLIENT_TYPE] = "unknown"
		headers[BedrockCoderHeaders.CLIENT_VERSION] = "unknown"
	}
	headers[BedrockCoderHeaders.CORE_VERSION] = ExtensionRegistryInfo.version

	return headers
}
