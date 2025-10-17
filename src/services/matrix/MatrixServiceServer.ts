import { ProcessMatrixRequest, ProcessMatrixResponse } from "@shared/proto/cline/matrix"
import { Controller } from "@/core/controller"
import { uploadMatrixFile } from "./MatrixService"

/**
 * Process a matrix file and return a URL to the processed file
 * @param controller The controller instance
 * @param request The process matrix request containing file data
 * @returns The process matrix response with file URL
 */
export async function processMatrixFileServer(
	controller: Controller,
	request: ProcessMatrixRequest,
): Promise<ProcessMatrixResponse> {
	console.log("[MatrixServiceServer] Processing matrix file:", request.fileName)

	// Call the service function to process the file
	const response = await uploadMatrixFile(request)

	console.log("[MatrixServiceServer] File processing completed:", response.status)

	return response
}
