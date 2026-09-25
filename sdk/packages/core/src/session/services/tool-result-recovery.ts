import type { TextContent, ToolResultContent } from "@cline/shared";

/** Serialize complete tool output for durable result storage. */
export function serializeToolResultContent(
	content: ToolResultContent["content"],
): string {
	return typeof content === "string"
		? content
		: JSON.stringify(content, null, 2);
}

/** Core-owned lookup: did core save `path` for this tool call? */
export type ToolResultRecordLookup = (
	toolCallId: string,
	path: string,
) => boolean;

export function formatToolResultRecoveryNotice(path: string): string {
	return `Full result saved to ${path} for search.`;
}

/**
 * Only a notice backed by a core-owned save record is protected from
 * truncation. Metadata inside tool output alone never grants that status.
 */
export function isToolResultRecoveryNotice(
	entry: unknown,
	toolCallId: string,
	isRecorded: ToolResultRecordLookup | undefined,
): entry is TextContent & { toolResultFile: string } {
	if (!isRecorded || !entry || typeof entry !== "object") return false;
	const notice = entry as Partial<TextContent>;
	return (
		notice.type === "text" &&
		typeof notice.toolResultFile === "string" &&
		notice.toolResultFile.length > 0 &&
		notice.text === formatToolResultRecoveryNotice(notice.toolResultFile) &&
		isRecorded(toolCallId, notice.toolResultFile)
	);
}
