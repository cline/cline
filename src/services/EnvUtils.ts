import { isMultiRootWorkspace } from "@/core/workspace/utils/workspace-detection"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { EmptyRequest } from "@/shared/proto/beadsmith/common"
import { Logger } from "@/shared/services/Logger"

// Canonical header names for extra client/host context
export const BeadsmithHeaders = {
	PLATFORM: "X-PLATFORM",
	PLATFORM_VERSION: "X-PLATFORM-VERSION",
	CLIENT_VERSION: "X-CLIENT-VERSION",
	CLIENT_TYPE: "X-CLIENT-TYPE",
	CORE_VERSION: "X-CORE-VERSION",
	IS_MULTIROOT: "X-IS-MULTIROOT",
} as const
export type BeadsmithHeaderName = (typeof BeadsmithHeaders)[keyof typeof BeadsmithHeaders]

export async function buildBasicBeadsmithHeaders(): Promise<Record<string, string>> {
	const headers: Record<string, string> = {}
	try {
		const host = await HostProvider.env.getHostVersion(EmptyRequest.create({}))
		headers[BeadsmithHeaders.PLATFORM] = host.platform || "unknown"
		headers[BeadsmithHeaders.PLATFORM_VERSION] = host.version || "unknown"
		headers[BeadsmithHeaders.CLIENT_TYPE] = host.beadsmithType || "unknown"
		headers[BeadsmithHeaders.CLIENT_VERSION] = host.beadsmithVersion || "unknown"
	} catch (error) {
		Logger.log("Failed to get IDE/platform info via HostBridge EnvService.getHostVersion", error)
		headers[BeadsmithHeaders.PLATFORM] = "unknown"
		headers[BeadsmithHeaders.PLATFORM_VERSION] = "unknown"
		headers[BeadsmithHeaders.CLIENT_TYPE] = "unknown"
		headers[BeadsmithHeaders.CLIENT_VERSION] = "unknown"
	}
	headers[BeadsmithHeaders.CORE_VERSION] = ExtensionRegistryInfo.version

	return headers
}

export async function buildBeadsmithExtraHeaders(): Promise<Record<string, string>> {
	const headers = await buildBasicBeadsmithHeaders()

	try {
		const isMultiRoot = await isMultiRootWorkspace()
		headers[BeadsmithHeaders.IS_MULTIROOT] = isMultiRoot ? "true" : "false"
	} catch (error) {
		Logger.log("Failed to detect multi-root workspace", error)
		headers[BeadsmithHeaders.IS_MULTIROOT] = "false"
	}

	return headers
}
