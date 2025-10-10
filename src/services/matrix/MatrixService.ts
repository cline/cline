import { ProcessMatrixRequest, ProcessMatrixResponse } from "@shared/proto/cline/matrix"
import { existsSync, mkdirSync, writeFileSync } from "fs"
import { Client } from "minio"
import { resolve } from "path"
import { MATRIX_FILES_BUCKET, minioClient } from "./minioClient"

/**
 * Process a matrix file and store it in MinIO
 * @param request The process matrix request containing file data
 * @returns The process matrix response with file URL
 */
export async function processMatrixFile(request: ProcessMatrixRequest): Promise<ProcessMatrixResponse> {
	console.log("[MatrixService] Processing matrix file:", request.fileName)
	console.log("[MatrixService] File size:", request.fileSize, "bytes")

	try {
		// Ensure the bucket exists
		const bucketExists = await minioClient.bucketExists(MATRIX_FILES_BUCKET)
		if (!bucketExists) {
			await minioClient.makeBucket(MATRIX_FILES_BUCKET, "us-east-1")
			console.log(`[MatrixService] Created bucket: ${MATRIX_FILES_BUCKET}`)
		}

		// Generate a unique file name
		const timestamp = Date.now()
		const fileExtension = request.fileName.split(".").pop() || "xlsx"
		const uniqueFileName = `${request.fileName.replace(/\.[^/.]+$/, "")}_${timestamp}.${fileExtension}`

		// Upload the file to MinIO
		// Convert Uint8Array to Buffer for MinIO
		const fileBuffer = Buffer.from(request.fileContent.buffer, request.fileContent.byteOffset, request.fileContent.byteLength)
		await minioClient.putObject(MATRIX_FILES_BUCKET, uniqueFileName, fileBuffer, fileBuffer.length, {
			"Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			"x-amz-meta-filename": request.fileName,
			"x-amz-meta-filesize": request.fileSize.toString(),
		})

		console.log(`[MatrixService] File uploaded to MinIO: ${uniqueFileName}`)

		// Generate the file URL
		const fileUrl = `/api/matrix/files/${uniqueFileName}`

		console.log("[MatrixService] File processed successfully, URL:", fileUrl)

		return ProcessMatrixResponse.create({
			fileUrl: fileUrl,
			status: "success",
		})
	} catch (error) {
		console.error("[MatrixService] Error processing matrix file:", error)

		return ProcessMatrixResponse.create({
			fileUrl: "",
			status: "error",
			error: error instanceof Error ? error.message : "Unknown error occurred",
		})
	}
}
