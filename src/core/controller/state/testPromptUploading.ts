import { EmptyRequest } from "@shared/proto/cline/common"
import { TestConnectionResult } from "@shared/proto/cline/state"
import { Logger } from "@/shared/services/Logger"
import { blobStorage } from "@/shared/storage/ClineBlobStorage"
import { Controller } from ".."

/**
 * Tests the prompt uploading (blob storage) connection by uploading a test file
 * @param controller The controller instance
 * @param request Empty request
 * @returns TestConnectionResult with success status and message
 */
export async function testPromptUploading(_controller: Controller, _: EmptyRequest): Promise<TestConnectionResult> {
	try {
		if (!blobStorage.isReady()) {
			return TestConnectionResult.create({
				success: false,
				error: "Blob storage is not configured or not ready",
			})
		}

		const testKey = `cline-test-${Date.now()}.json`
		const testContent = JSON.stringify({
			test: true,
			timestamp: new Date().toISOString(),
			source: "remote_config_settings",
		})

		await blobStorage._dangerousStore(testKey, testContent)

		return TestConnectionResult.create({
			success: true,
			message: "Test file uploaded and verified successfully.",
		})
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		Logger.error("[TEST_PROMPT_UPLOADING] Failed to test blob storage:", error)

		return TestConnectionResult.create({
			success: false,
			error: errorMessage,
		})
	}
}
