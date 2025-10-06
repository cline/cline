import { discoverChromeInstances } from "@services/browser/BrowserDiscovery"
import { BrowserSession } from "@services/browser/BrowserSession"
import { BrowserConnection } from "@shared/proto/cline/browser"
import { EmptyRequest } from "@shared/proto/cline/common"
import { Controller } from "../index"

/**
 * Discover Chrome instances
 * @param controller The controller instance
 * @param request The request message
 * @returns The browser connection result
 */
export async function discoverBrowser(controller: Controller, _request: EmptyRequest): Promise<BrowserConnection> {
	try {
		const discoveredHost = await discoverChromeInstances()

		if (discoveredHost) {
			// Don't update the remoteBrowserHost state when auto-discovering
			// This way we don't override the user's preference

			// Test the connection to get the endpoint
			const browserSession = new BrowserSession(controller.stateManager)
			const result = await browserSession.testConnection(discoveredHost)

			return BrowserConnection.create({
				success: true,
				message: `Successfully discovered and connected to Chrome at ${discoveredHost}`,
				endpoint: result.endpoint || "",
			})
		} else {
			return BrowserConnection.create({
				success: false,
				message:
					"No Chrome instances found. Make sure Chrome is running with remote debugging enabled (--remote-debugging-port=9222).",
				endpoint: "",
			})
		}
	} catch (error) {
		return BrowserConnection.create({
			success: false,
			message: `Error discovering browser: ${error instanceof Error ? error.message : String(error)}`,
			endpoint: "",
		})
	}
}
