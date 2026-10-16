import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"

let hostName: string | undefined

/**
 * The host product as getHostVersion reports it ("Cursor", "PyCharm Professional", ...).
 * It is fixed for the process, so it is fetched once instead of on every state push
 * (on JetBrains each fetch is a host-bridge RPC). A failed fetch is retried next time.
 */
export async function getHostName(): Promise<string | undefined> {
	if (hostName === undefined) {
		try {
			hostName = (await HostProvider.env.getHostVersion({})).platform || undefined
		} catch (error) {
			Logger.debug("Failed to resolve the host name for webview state", error)
		}
	}
	return hostName
}
