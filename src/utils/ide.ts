import { HostProvider } from "@/hosts/host-provider"

/**
 * Returns the IDE identifier string as provided by the host via Host Bridge RPC.
 */
export async function getIdeId(): Promise<string> {
	try {
		const host = await HostProvider.env.getHostVersion({})
		return host.platform || "unknown"
	} catch {
		return "unknown"
	}
}
