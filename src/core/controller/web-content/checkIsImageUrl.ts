import { Controller } from "../index"
import { StringRequest } from "../../../shared/proto/common"
import { IsImageUrl } from "../../../shared/proto/web_content"
import { detectImageUrl } from "@integrations/misc/link-preview"

/**
 * Checks if a URL is an image URL
 * @param controller The controller instance
 * @param request The request containing the URL to check
 * @returns A result indicating if the URL is an image and the URL that was checked
 */
export async function checkIsImageUrl(controller: Controller, request: StringRequest): Promise<IsImageUrl> {
	try {
		const url = request.value || ""
		// Check if the URL is an image
		const isImage = await detectImageUrl(url)

		return {
			isImage,
			url,
		}
	} catch (error) {
		console.error(`Error checking if URL is an image: ${request.value}`, error)
		return {
			isImage: false,
			url: request.value || "",
		}
	}
}
