import type { ToolResultContent } from "@cline/shared";

/** Serialize complete tool output for durable result storage. */
export function serializeToolResultContent(
	content: ToolResultContent["content"],
): string {
	return typeof content === "string"
		? content
		: JSON.stringify(content, null, 2);
}
