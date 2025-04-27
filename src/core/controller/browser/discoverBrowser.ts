import { BrowserConnection } from "@shared/proto/browser"
import { EmptyRequest } from "@shared/proto/common"
import { Controller } from "../index"
import { getAllExtensionState } from "@core/storage/state"
import { BrowserSession } from "@services/browser/BrowserSession"
import { discoverChromeInstances } from "@services/browser/BrowserDiscovery"

/**
 * Discover Chrome instances
 * @param controller The controller instance
 * @param request The request message
 * @returns The browser connection result
 */
export async function discoverBrowser(controller: Controller, request: EmptyRequest): Promise<BrowserConnection> {
	try {
		const discoveredHost = await discoverChromeInstances()

		if (discoveredHost) {
			// Don't update the remoteBrowserHost state when auto-discovering
			// This way we don't override the user's preference

			// Test the connection to get the endpoint
			const { browserSettings } = await getAllExtensionState(controller.context)
			const browserSession = new BrowserSession(controller.context, browserSettings)
			const result = await browserSession.testConnection(discoveredHost)

			return {
				success: true,
				message: `Successfully discovered and connected to Chrome at ${discoveredHost}`,
				endpoint: result.endpoint || "",
			}
		} else {
			return {
				success: false,
				message:
					"No Chrome instances found. Make sure Chrome is running with remote debugging enabled (--remote-debugging-port=9222).",
				endpoint: "",
			}
		}
	} catch (error) {
		return {
			success: false,
			message: `Error discovering browser: ${error instanceof Error ? error.message : String(error)}`,
			endpoint: "",
		}
	}
}
