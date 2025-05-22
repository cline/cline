import { Controller } from ".."
import { EmptyRequest, StringArrays } from "@shared/proto/common"
import { selectFiles as selectFilesIntegration } from "@integrations/misc/process-files"
import { FileMethodHandler } from "./index"

/**
 * Prompts the user to select images from the file system and returns them as data URLs
 * @param controller The controller instance
 * @param request Empty request, no parameters needed
 * @returns Array of image data URLs
 */
export const selectImages: FileMethodHandler = async (controller: Controller, request: EmptyRequest): Promise<StringArrays> => {
	try {
		const { images, files } = await selectFilesIntegration()
		return StringArrays.create({ values1: images, values2: files })
	} catch (error) {
		console.error("Error selecting images & files:", error)
		// Return empty array on error
		return StringArrays.create({ values1: [], values2: [] })
	}
}
