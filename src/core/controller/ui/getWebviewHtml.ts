import type { Controller } from "../index"
import { EmptyRequest, Empty, String } from "@shared/proto/common"
import * as hostProviders from "@hosts/host-providers"
import { WebviewProviderType } from "@/shared/webview/types"

/**
 * Initialize webview when it launches
 * @param controller The controller instance
 * @param request The empty request
 * @returns Empty response
 */
export async function getWebviewHtml(_controller: Controller, _: EmptyRequest): Promise<String> {
	const webviewProvider = hostProviders.createWebviewProvider(WebviewProviderType.SIDEBAR)

	return Promise.resolve(String.create({ value: webviewProvider.getHtmlContent() }))
}
