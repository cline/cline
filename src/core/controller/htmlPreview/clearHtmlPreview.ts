import { Empty } from "@shared/proto/cline/common"
import type { ClearHtmlPreviewRequest } from "@shared/proto/cline/html_preview"
import type { Controller } from ".."

/**
 * Clears all HTML previews
 */
export async function clearHtmlPreview(controller: Controller, _request: ClearHtmlPreviewRequest): Promise<Empty> {
	console.log("[clearHtmlPreview] Clearing all HTML previews")
	controller.clearHtmlPreviews()
	return Empty.create()
}
