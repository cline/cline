import type { Controller } from "../index"
import { EmptyRequest, String } from "@shared/proto/cline/common"
import { HostProvider } from "@/hosts/host-provider"
import { WebviewProviderType } from "@/shared/webview/types"

/**
 * Initialize webview when it launches
 * @param controller The controller instance
 * @param request The empty request
 * @returns Empty response
 */
export async function getWebviewHtml(_controller: Controller, _: EmptyRequest): Promise<String> {
	const webviewProvider = HostProvider.get().createWebviewProvider(WebviewProviderType.SIDEBAR)

	return Promise.resolve(String.create({ value: webviewProvider.getHtmlContent() }))
}
