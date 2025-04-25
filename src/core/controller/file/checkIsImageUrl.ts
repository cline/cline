import { Controller } from ".."
import { StringRequest } from "@shared/proto/common"
import { IsImageUrlResult } from "@shared/proto/file"
import { isImageUrl } from "@integrations/misc/link-preview"
import { FileMethodHandler } from "./index"

/**
 * Checks if a URL is an image
 * @param controller The controller instance
 * @param request The request message containing the URL to check in the 'value' field
 * @returns Result indicating if the URL is an image
 */
export const checkIsImageUrl: FileMethodHandler = async (
	controller: Controller,
	request: StringRequest,
): Promise<IsImageUrlResult> => {
	if (!request.value) {
		return IsImageUrlResult.create({
			isImage: false,
			url: "",
		})
	}

	try {
		const isImage = await isImageUrl(request.value)
		return IsImageUrlResult.create({
			isImage,
			url: request.value,
		})
	} catch (error) {
		console.error(`Error checking if URL is an image: ${request.value}`, error)
		return IsImageUrlResult.create({
			isImage: false,
			url: request.value,
		})
	}
}
