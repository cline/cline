import { HostProvider } from "@/hosts/host-provider"
import { EmptyRequest } from "@/shared/proto/cline/common"

// Canonical header names for extra client/host context
export const ClineHeaders = {
	IDE_ID: "X-IDE-ID",
	IDE_VERSION: "X-IDE-VERSION",
	CLIENT_VERSION: "X-CLIENT-VERSION",
} as const
export type ClineHeaderName = (typeof ClineHeaders)[keyof typeof ClineHeaders]

export async function buildClineExtraHeaders(): Promise<Record<string, string>> {
	const headers: Record<string, string> = {}
	try {
		const host = await HostProvider.env.getHostVersion(EmptyRequest.create({}))
		headers[ClineHeaders.IDE_ID] = host.platform || "unknown"
		headers[ClineHeaders.IDE_VERSION] = host.version || "unknown"
	} catch (error) {
		console.log("Failed to get IDE/platform info via HostBridge EnvService.getHostVersion", error)
		headers[ClineHeaders.IDE_ID] = "unknown"
		headers[ClineHeaders.IDE_VERSION] = "unknown"
	}
	// Do NOT set X-CLIENT-VERSION here; extension version is populated at sites from package.json
	return headers
}
