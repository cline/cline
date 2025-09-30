import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { EmptyRequest } from "@/shared/proto/cline/common"

// Canonical header names for extra client/host context
export const ClineHeaders = {
	PLATFORM: "X-PLATFORM",
	PLATFORM_VERSION: "X-PLATFORM-VERSION",
	CLIENT_VERSION: "X-CLIENT-VERSION",
	CORE_VERSION: "X-CORE-VERSION",
} as const
export type ClineHeaderName = (typeof ClineHeaders)[keyof typeof ClineHeaders]

export async function buildClineExtraHeaders(): Promise<Record<string, string>> {
	const headers: Record<string, string> = {}
	try {
		const host = await HostProvider.env.getHostVersion(EmptyRequest.create({}))
		headers[ClineHeaders.PLATFORM] = host.platform || "unknown"
		headers[ClineHeaders.PLATFORM_VERSION] = host.version || "unknown"
		// TODO: Set X-CLIENT-VERSION (extension/plugin/cli wrapper version) when RPC becomes available
	} catch (error) {
		console.log("Failed to get IDE/platform info via HostBridge EnvService.getHostVersion", error)
		headers[ClineHeaders.PLATFORM] = "unknown"
		headers[ClineHeaders.PLATFORM_VERSION] = "unknown"
	}
	headers[ClineHeaders.CORE_VERSION] = ExtensionRegistryInfo.version
	return headers
}
