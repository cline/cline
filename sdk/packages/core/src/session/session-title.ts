import { formatDisplayUserInput } from "@cline/shared";

export function normalizeSessionTitle(
	title?: string | null,
): string | undefined {
	const trimmed = typeof title === "string" ? title.trim() : "";
	return trimmed ? formatDisplayUserInput(trimmed).slice(0, 120) : undefined;
}

// List titles use readable text, not tool/image/reasoning placeholders. Display,
// transcript reconciliation, and bounded search keep their own extraction rules.
function textContent(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.flatMap((block) => {
			if (!block || typeof block !== "object" || block.type !== "text")
				return [];
			return typeof block.text === "string" && block.text.trim()
				? [block.text.trim()]
				: [];
		})
		.join("\n");
}

function titleFromPrompt(prompt?: string | null): string | undefined {
	return (
		normalizeSessionTitle(prompt)?.split("\n")[0]?.trim().slice(0, 70) ||
		undefined
	);
}

function titleFromMessages(messages: unknown[]): string | undefined {
	for (const role of ["user", "assistant"] as const) {
		for (const message of messages) {
			if (
				!message ||
				typeof message !== "object" ||
				!("role" in message) ||
				message.role !== role
			)
				continue;
			const title = titleFromPrompt(
				textContent("content" in message ? message.content : undefined),
			);
			if (title) return title;
		}
	}
	return undefined;
}

/** Project a list title without modifying authoritative session metadata. */
export function resolveSessionListTitle(options: {
	sessionId: string;
	metadata?: unknown;
	prompt?: string | null;
	messages?: unknown[];
}): string {
	const title =
		options.metadata &&
		typeof options.metadata === "object" &&
		"title" in options.metadata
			? options.metadata.title
			: undefined;
	const explicit = normalizeSessionTitle(
		typeof title === "string" ? title : undefined,
	);
	return (
		explicit?.slice(0, 70) ||
		titleFromPrompt(options.prompt) ||
		(options.messages && titleFromMessages(options.messages)) ||
		`Session ${options.sessionId.slice(-6)}`
	);
}
