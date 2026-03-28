export function formatFileContentBlock(path: string, content: string): string {
	return `<file_content path="${path}">\n${content}\n</file_content>`;
}

export function formatUserInputBlock(
	input: string,
	mode: "act" | "plan" = "act",
): string {
	return `<user_input mode="${mode}">${input}</user_input>`;
}

export function normalizeUserInput(input?: string): string {
	if (!input?.trim()) return "";
	// First try to extract content from properly closed tags
	const extracted = xmlTagsRemoval(input, "user_input");
	const withoutTags = (
		extracted !== input ? extracted : input.replace(/<user_input[^>]*>/g, "")
	).trim();
	return withoutTags;
}

export function xmlTagsRemoval(input?: string, tag?: string): string {
	if (!input?.trim()) return "";
	if (!tag) return input;
	const regex = new RegExp(`<${tag}.*?>(.*?)</${tag}>`, "g");
	return input.replace(regex, "$1");
}
