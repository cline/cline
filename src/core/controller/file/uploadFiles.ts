import { Controller } from "@core/controller"
import { writeAttachment } from "@core/storage/disk"
import { UploadFilesRequest, UploadFilesResponse } from "@shared/proto/cline/file"
import { DEFAULT_ATTACHMENTS_TASK_ID } from "@/shared/attachments"

/**
 * Saves uploaded file blobs to the per-task attachments directory under global storage.
 *   <globalStorage>/tasks/{taskId}/attachments/<optional base_dir>/<suggested_path or filename>
 * Returns absolute saved paths (attachments live outside the workspace).
 */
export async function uploadFiles(controller: Controller, request: UploadFilesRequest): Promise<UploadFilesResponse> {
	// Always prefer an explicit taskId from the request; otherwise use the transient 'default' bucket.
	// Avoid inferring from controller.task?.taskId because the user might be composing a new task
	// without submitting yet, which could incorrectly tie uploads to some existing task.
	const taskId = request.taskId || DEFAULT_ATTACHMENTS_TASK_ID

	const savedPaths: string[] = []
	for (const file of request.files) {
		const bytes = new Uint8Array(file.content)
		const saved = await writeAttachment(controller.context, taskId, bytes, {
			baseDir: request.baseDir || undefined,
			suggestedPath: file.suggestedPath || undefined,
			filename: file.filename,
			overwrite: request.overwrite === undefined ? true : request.overwrite,
		})
		savedPaths.push(saved)
	}

	return UploadFilesResponse.create({ savedPaths })
}
