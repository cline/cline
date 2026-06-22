import { EmptyRequest, String } from "@shared/proto/cline/common"
import type { Controller } from "../index"

/**
 * Returns the HTML content of the webview.
 */
export async function getWebviewHtml(_controller: Controller, _: EmptyRequest): Promise<String> {
	return String.create({})
}
