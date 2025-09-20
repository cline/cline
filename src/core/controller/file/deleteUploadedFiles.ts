import { Controller } from "@core/controller"
import { getAttachmentsRoot } from "@core/storage/disk"
import { DeleteUploadedFilesRequest, DeleteUploadedFilesResponse } from "@shared/proto/cline/file"
import * as fs from "fs/promises"
import { DEFAULT_ATTACHMENTS_TASK_ID, extractTaskIdFromAttachmentPath } from "@/shared/attachments"
import { isLocatedInPath } from "@/utils/path"

/**
 * Deletes previously uploaded attachment files, only if they reside under the task's attachments root.
 */
export async function deleteUploadedFiles(
	controller: Controller,
	request: DeleteUploadedFilesRequest,
): Promise<DeleteUploadedFilesResponse> {
	const deleted: string[] = []
	const failed: string[] = []

	for (const absPath of request.paths) {
		try {
			if (!absPath) {
				failed.push(absPath)
				continue
			}

			// Prefer deriving the taskId from the provided path to avoid relying on ambient state
			const derivedTaskId = extractTaskIdFromAttachmentPath(absPath) || request.taskId || DEFAULT_ATTACHMENTS_TASK_ID
			const root = await getAttachmentsRoot(controller.context, derivedTaskId)

			if (!isLocatedInPath(root, absPath)) {
				failed.push(absPath)
				continue
			}
			await fs.unlink(absPath)
			deleted.push(absPath)
		} catch (err) {
			const e = err as NodeJS.ErrnoException
			const code = (e && (e as any).code) || "UNKNOWN"
			const message = e instanceof Error ? e.message : String(e)
			console.error("Failed to delete uploaded attachment:", {
				path: absPath,
				code,
				message,
			})
			failed.push(absPath)
		}
	}

	if (deleted.length > 0) {
		console.log("Deleted uploaded attachment(s):", deleted)
	}
	if (failed.length > 0) {
		console.warn("Failed to delete some uploaded attachment(s):", failed)
	}

	return DeleteUploadedFilesResponse.create({ deletedPaths: deleted, failedPaths: failed })
}
