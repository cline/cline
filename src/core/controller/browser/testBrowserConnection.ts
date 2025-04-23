import { BrowserConnection } from "@shared/proto/browser"
import { StringRequest } from "@shared/proto/common"
import { Controller } from "../index"
import { getAllExtensionState } from "@core/storage/state"
import { BrowserSession } from "@services/browser/BrowserSession"
import { discoverChromeInstances } from "@services/browser/BrowserDiscovery"

/**
 * Test connection to a browser instance
 * @param controller The controller instance
 * @param request The request message
 * @returns The browser connection result
 */
export async function testBrowserConnection(controller: Controller, request: StringRequest): Promise<BrowserConnection> {
	try {
		const { browserSettings } = await getAllExtensionState(controller.context)
		const browserSession = new BrowserSession(controller.context, browserSettings)
		const text = request.value || ""

		// If no text is provided, try auto-discovery
		if (!text) {
			try {
				const discoveredHost = await discoverChromeInstances()
				if (discoveredHost) {
					// Test the connection to the discovered host
					const result = await browserSession.testConnection(discoveredHost)
					return {
						success: result.success,
						message: `Auto-discovered and tested connection to Chrome at ${discoveredHost}: ${result.message}`,
						endpoint: result.endpoint || "",
					}
				} else {
					return {
						success: false,
						message:
							"No Chrome instances found on the network. Make sure Chrome is running with remote debugging enabled (--remote-debugging-port=9222).",
						endpoint: "",
					}
				}
			} catch (error) {
				return {
					success: false,
					message: `Error during auto-discovery: ${error instanceof Error ? error.message : String(error)}`,
					endpoint: "",
				}
			}
		} else {
			// Test the provided URL
			const result = await browserSession.testConnection(text)
			return {
				success: result.success,
				message: result.message,
				endpoint: result.endpoint || "",
			}
		}
	} catch (error) {
		return {
			success: false,
			message: `Error testing connection: ${error instanceof Error ? error.message : String(error)}`,
			endpoint: "",
		}
	}
}
