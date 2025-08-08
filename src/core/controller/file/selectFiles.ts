import { Controller } from ".."
import { BooleanRequest, StringArrays } from "@shared/proto/common"
import { selectFiles as selectFilesIntegration } from "@integrations/misc/process-files"
import { FileMethodHandler } from "./index"

/**
 * Prompts the user to select images from the file system and returns them as data URLs
 * @param controller The controller instance
 * @param request Boolean request, with the value defining whether this model supports images
 * @returns Two arrays of image data URLs and other file paths
 */
export const selectFiles: FileMethodHandler = async (controller: Controller, request: BooleanRequest): Promise<StringArrays> => {
	try {
		const { images, files } = await selectFilesIntegration(request.value)
		return StringArrays.create({ values1: images, values2: files })
	} catch (error) {
		console.error("Error selecting images & files:", error)
		// Return empty array on error
		return StringArrays.create({ values1: [], values2: [] })
	}
}
