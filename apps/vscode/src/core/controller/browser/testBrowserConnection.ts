import { BrowserConnection } from "@shared/proto/cline/browser"
import { StringRequest } from "@shared/proto/cline/common"
import { Controller } from "../index"

/**
 * Test connection to a browser instance
 * @param controller The controller instance
 * @param request The request message
 * @returns The browser connection result
 */
export async function testBrowserConnection(_controller: Controller, _request: StringRequest): Promise<BrowserConnection> {
	return BrowserConnection.create({})
}
