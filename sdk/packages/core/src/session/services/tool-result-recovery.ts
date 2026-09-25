import type { TextContent, ToolResultContent } from "@cline/shared";

/** Serialize complete tool output for durable result storage. */
export function serializeToolResultContent(
	content: ToolResultContent["content"],
): string {
	return typeof content === "string"
		? content
		: JSON.stringify(content, null, 2);
}

/** Only an explicitly recorded recovery notice is protected from truncation. */
export function isToolResultRecoveryNotice(
	entry: unknown,
): entry is TextContent & { toolResultFile: string } {
	if (!entry || typeof entry !== "object") return false;
	const notice = entry as Partial<TextContent>;
	return (
		notice.type === "text" &&
		typeof notice.toolResultFile === "string" &&
		notice.toolResultFile.length > 0 &&
		notice.text === `Full result saved to ${notice.toolResultFile} for search.`
	);
}
