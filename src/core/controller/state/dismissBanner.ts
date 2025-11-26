import type { StringRequest } from "@/shared/proto/cline/common"
import { Empty } from "@/shared/proto/cline/common"
import type { Controller } from ".."

/**
 * Dismisses a banner by ID
 * @param controller The controller instance
 * @param request The request containing the banner ID to dismiss
 * @returns Empty response
 */
export async function dismissBanner(controller: Controller, request: StringRequest): Promise<Empty> {
	const bannerId = request.value

	if (bannerId) {
		await controller.dismissBanner(bannerId)
	}

	return Empty.create()
}
