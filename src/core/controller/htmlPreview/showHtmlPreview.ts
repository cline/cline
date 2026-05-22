import { Empty } from "@shared/proto/cline/common"
import type { ShowHtmlPreviewRequest } from "@shared/proto/cline/html_preview"
import type { Controller } from ".."
import { sendHtmlPreviewButtonClickedEvent } from "../ui/subscribeToHtmlPreviewButtonClicked"

/**
 * Shows the HTML preview panel.
 * Auto-loads workspace HTML files so the panel is never empty when
 * workspace contains eligible files.
 */
export async function showHtmlPreview(controller: Controller, _request: ShowHtmlPreviewRequest): Promise<Empty> {
	console.log("[showHtmlPreview] Showing HTML preview view")

	// Auto-discover and load workspace HTML files
	await controller.loadWorkspaceHtmlPreviews()

	await sendHtmlPreviewButtonClickedEvent()

	return Empty.create()
}
