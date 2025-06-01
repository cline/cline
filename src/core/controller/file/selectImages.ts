import { Controller } from ".."
import { EmptyRequest, StringArray } from "@shared/proto/common"
import { selectImages as selectImagesIntegration } from "@integrations/misc/process-images"
import { FileMethodHandler } from "./index"

/**
 * Prompts the user to select images from the file system and returns them as data URLs
 * @param controller The controller instance
 * @param request Empty request, no parameters needed
 * @returns Array of image data URLs
 */
export const selectImages: FileMethodHandler = async (controller: Controller, request: EmptyRequest): Promise<StringArray> => {
	try {
		const images = await selectImagesIntegration()
		return StringArray.create({ values: images })
	} catch (error) {
		console.error("Error selecting images:", error)
		// Return empty array on error
		return StringArray.create({ values: [] })
	}
}
