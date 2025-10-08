// Shared helpers for working with attachment paths across extension and webview

// Default task bucket used for transient uploads before a task is created/selected
export const DEFAULT_ATTACHMENTS_TASK_ID = "default"

// Matches (optionally) .../globalStorage/<extensionId>/ followed by tasks/{taskId}/attachments
// We normalize to forward slashes before testing.
const ATTACHMENT_PATH_RE = /(?:^|\/)\/?(?:globalStorage\/[^/]+\/)?tasks\/([^/]+)\/attachments(?:\/.+|$)/

/**
 * Returns true if the path appears to be inside a task attachments directory:
 * [optional] .../globalStorage/<extensionId>/tasks/{taskId}/attachments/...
 * or simply .../tasks/{taskId}/attachments/...
 * Works with both POSIX and Windows paths.
 */
export function isAttachmentPath(p: string | undefined | null): boolean {
	if (!p) return false
	const norm = p.replace(/\\/g, "/")
	return ATTACHMENT_PATH_RE.test(norm)
}

/**
 * Extracts the {taskId} from an attachment path. Returns undefined if not matched.
 */
export function extractTaskIdFromAttachmentPath(p: string | undefined | null): string | undefined {
	if (!p) return undefined
	const norm = p.replace(/\\/g, "/")
	const m = norm.match(ATTACHMENT_PATH_RE)
	return m?.[1]
}
