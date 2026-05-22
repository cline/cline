import { EmptyRequest } from "@shared/proto/cline/common"
import { HtmlPreviewStateResponse } from "@shared/proto/cline/html_preview"
import type { Controller } from ".."

/**
 * Gets current HTML preview state
 */
export async function getHtmlPreviewState(controller: Controller, _request: EmptyRequest): Promise<HtmlPreviewStateResponse> {
	console.log("[getHtmlPreviewState] Retrieving current HTML preview state")

	const items = controller.getHtmlPreviews()

	return HtmlPreviewStateResponse.create({
		items,
		itemCount: items.length,
	})
}
