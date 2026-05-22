import { Empty } from "@shared/proto/cline/common"
import type { RemoveHtmlPreviewItemRequest } from "@shared/proto/cline/html_preview"
import type { Controller } from ".."

/**
 * Removes a specific HTML preview item by ID
 */
export async function removeHtmlPreviewItem(controller: Controller, request: RemoveHtmlPreviewItemRequest): Promise<Empty> {
	controller.removeHtmlPreview(request.id)
	return Empty.create()
}
