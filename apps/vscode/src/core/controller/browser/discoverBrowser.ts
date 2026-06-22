import { BrowserConnection } from "@shared/proto/cline/browser"
import { EmptyRequest } from "@shared/proto/cline/common"
import { Controller } from "../index"

/**
 * Discover Chrome instances
 * @param controller The controller instance
 * @param request The request message
 * @returns The browser connection result
 */
export async function discoverBrowser(_controller: Controller, _request: EmptyRequest): Promise<BrowserConnection> {
	return BrowserConnection.create({})
}
