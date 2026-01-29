import { isMultiRootWorkspace } from "@/core/workspace/utils/workspace-detection"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { EmptyRequest } from "@/shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"

// Canonical header names for extra client/host context
export const ClineHeaders = {
	PLATFORM: "X-PLATFORM",
	PLATFORM_VERSION: "X-PLATFORM-VERSION",
	CLIENT_VERSION: "X-CLIENT-VERSION",
	CLIENT_TYPE: "X-CLIENT-TYPE",
	CORE_VERSION: "X-CORE-VERSION",
	IS_MULTIROOT: "X-IS-MULTIROOT",
} as const
export type ClineHeaderName = (typeof ClineHeaders)[keyof typeof ClineHeaders]

export function buildExternalBasicHeaders(): Record<string, string> {
	return {
		"User-Agent": `Cline/${ExtensionRegistryInfo.version}`,
	}
}

export async function buildBasicClineHeaders(): Promise<Record<string, string>> {
	const headers: Record<string, string> = {}
	try {
		const host = await HostProvider.env.getHostVersion(EmptyRequest.create({}))
		headers[ClineHeaders.PLATFORM] = host.platform || "unknown"
		headers[ClineHeaders.PLATFORM_VERSION] = host.version || "unknown"
		headers[ClineHeaders.CLIENT_TYPE] = host.clineType || "unknown"
		headers[ClineHeaders.CLIENT_VERSION] = host.clineVersion || "unknown"
	} catch (error) {
		Logger.log("Failed to get IDE/platform info via HostBridge EnvService.getHostVersion", error)
		headers[ClineHeaders.PLATFORM] = "unknown"
		headers[ClineHeaders.PLATFORM_VERSION] = "unknown"
		headers[ClineHeaders.CLIENT_TYPE] = "unknown"
		headers[ClineHeaders.CLIENT_VERSION] = "unknown"
	}
	headers[ClineHeaders.CORE_VERSION] = ExtensionRegistryInfo.version

	return headers
}

export async function buildClineExtraHeaders(): Promise<Record<string, string>> {
	const headers = await buildBasicClineHeaders()

	try {
		const isMultiRoot = await isMultiRootWorkspace()
		headers[ClineHeaders.IS_MULTIROOT] = isMultiRoot ? "true" : "false"
	} catch (error) {
		Logger.log("Failed to detect multi-root workspace", error)
		headers[ClineHeaders.IS_MULTIROOT] = "false"
	}

	return headers
}
