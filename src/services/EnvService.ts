import { HostProvider } from "@/hosts/host-provider"

/**
 * Returns the IDE/platform identifier as provided by the host via Host Bridge RPC.
 * Returns undefined if unavailable or if the RPC fails.
 */
export async function getIdeId(): Promise<string | undefined> {
	try {
		const host = await getHostVersionCached()
		return host.platform || undefined
	} catch (error) {
		console.log("Failed to get IDE/platform id via HostBridge EnvService.getHostVersion", error)
		return undefined
	}
}

/**
 * Returns the IDE/platform version as provided by the host via Host Bridge RPC.
 * Returns undefined if unavailable or if the RPC fails.
 */
export async function getIdeVersion(): Promise<string | undefined> {
	try {
		const host = await getHostVersionCached()
		return host.version || undefined
	} catch (error) {
		console.log("Failed to get IDE/platform version via HostBridge EnvService.getHostVersion", error)
		return undefined
	}
}

// Canonical header names for extra client/host context
export const ClineHeaders = {
	IDE_ID: "X-IDE-ID",
	IDE_VERSION: "X-IDE-VERSION",
} as const
export type ClineHeaderName = (typeof ClineHeaders)[keyof typeof ClineHeaders]

/**
 * Build extra headers (IDE-related) once, conditionally including values only when present.
 */
export async function buildClineExtraHeaders(): Promise<Record<string, string>> {
	const [ideId, ideVersion] = await Promise.all([getIdeId(), getIdeVersion()])
	const headers: Record<string, string> = {}
	if (ideId) headers[ClineHeaders.IDE_ID] = ideId
	if (ideVersion) headers[ClineHeaders.IDE_VERSION] = ideVersion
	return headers
}

// --- Simple module-level cache for host version ---
let cachedHostVersion: { platform?: string; version?: string } | undefined
let inflight: Promise<{ platform?: string; version?: string }> | undefined

async function getHostVersionCached(): Promise<{ platform?: string; version?: string }> {
	if (cachedHostVersion) return cachedHostVersion
	if (inflight) return inflight
	inflight = HostProvider.env
		.getHostVersion({})
		.then((host) => {
			cachedHostVersion = host
			return host
		})
		.finally(() => {
			inflight = undefined
		})
	return inflight
}
