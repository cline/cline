import { GetMatrixFileRequest, GetMatrixFileResponse } from "@shared/proto/cline/matrix"
import { Controller } from "@/core/controller"
import { MATRIX_FILES_BUCKET, minioClient } from "@/services/matrix/minioClient"

/**
 * Get a matrix file from MinIO storage
 * @param controller The controller instance
 * @param request The get matrix file request containing file name
 * @returns The get matrix file response with file data
 */
export async function getMatrixFile(controller: Controller, request: GetMatrixFileRequest): Promise<GetMatrixFileResponse> {
	console.log("[MatrixService] Getting matrix file:", request.fileName)

	try {
		// Get the file from MinIO
		const dataStream = await minioClient.getObject(MATRIX_FILES_BUCKET, request.fileName)

		// Convert stream to Uint8Array
		const chunks: Uint8Array[] = []
		for await (const chunk of dataStream) {
			chunks.push(new Uint8Array(chunk))
		}

		// Concatenate all chunks into a single Uint8Array
		let totalLength = 0
		for (const chunk of chunks) {
			totalLength += chunk.length
		}

		const fileContent = new Uint8Array(totalLength)
		let offset = 0
		for (const chunk of chunks) {
			fileContent.set(chunk, offset)
			offset += chunk.length
		}

		console.log("[MatrixService] File retrieved successfully, size:", fileContent.length, "bytes")

		return GetMatrixFileResponse.create({
			fileContent: fileContent as any, // 使用类型断言解决类型不匹配问题
			status: "success",
		})
	} catch (error) {
		console.error("[MatrixService] Error retrieving matrix file:", error)

		return GetMatrixFileResponse.create({
			fileContent: new Uint8Array(0) as any, // 使用类型断言解决类型不匹配问题
			status: "error",
			error: error instanceof Error ? error.message : "Unknown error occurred",
		})
	}
}
