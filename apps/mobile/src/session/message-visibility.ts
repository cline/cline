/** Runtime-authored history must not be mistaken for a person's chat turn. */
const SYNTHETIC_USER_KINDS = new Set([
	"auto_compaction",
	"compaction",
	"compaction_summary",
	"compaction_budget_emergency",
	"completion_reminder",
	"loop_detection_notice",
	"manual_compaction",
	"mistake_stop_notice",
	"recovery_notice",
]);

// AgentRuntime.addUserReminderMessage persists this nudge with userRunSpan: 0,
// without a kind/displayRole. Keep matching exact text, not reminder-like prose.
const OUTPUT_LIMIT_REMINDER =
	"Your previous response was cut off because it reached the model's output-token limit before finishing. Keep responses concise: take one small step at a time, avoid long explanations, and write large files or command output in smaller chunks across multiple tool calls.";

export function isInternalTranscriptMessage(message: {
	role: string;
	metadata?: unknown;
	content?: unknown;
}): boolean {
	const metadata = message.metadata;
	const record =
		metadata && typeof metadata === "object" && !Array.isArray(metadata)
			? (metadata as Record<string, unknown>)
			: {};
	const displayRole =
		typeof record.displayRole === "string"
			? record.displayRole.trim().toLowerCase()
			: undefined;
	// Errors are deliberately user-visible even when displayOnly is true.
	if (displayRole === "error") return false;
	if (displayRole === "system" || displayRole === "status") return true;
	if (
		message.role === "user" &&
		typeof record.kind === "string" &&
		SYNTHETIC_USER_KINDS.has(record.kind)
	)
		return true;
	if (message.role !== "user") return false;
	if (
		Array.isArray(message.content) &&
		message.content.some((block) => {
			if (!block || typeof block !== "object") return false;
			return ["image", "file", "media"].includes(
				(block as Record<string, unknown>).type as string,
			);
		})
	)
		return false;
	const content =
		typeof message.content === "string"
			? message.content
			: Array.isArray(message.content)
				? message.content
						.flatMap((block) => {
							if (!block || typeof block !== "object") return [];
							const value = block as Record<string, unknown>;
							return value.type === "text" && typeof value.text === "string"
								? [value.text]
								: [];
						})
						.join("\n")
				: "";
	// Only unwrap the complete runtime envelope. The shared search formatter
	// also removes inline tags and arbitrary mode notices, which could turn an
	// authored XML example into one of the exact continuation strings below.
	const trimmed = content.trim();
	// Match desktop's runtime steering provenance. A zero span alone also marks
	// genuine mid-run user steering, and a person's [SYSTEM] example can appear
	// inside user_input. Do not unwrap before this check or hide unmarked text.
	if (
		record.userRunSpan === 0 &&
		(/^\[SYSTEM\](?:\s|$)/.test(trimmed) || trimmed === OUTPUT_LIMIT_REMINDER)
	)
		return true;
	const envelope =
		/^<user_input mode="(?:act|plan|yolo)">([\s\S]*)<\/user_input>$/.exec(
			trimmed,
		);
	const normalized = (envelope?.[1] ?? trimmed).trim();
	if (isRawHookContext(content.trim())) return true;
	// Older clients persisted these exact SDK continuation prompts without
	// metadata. Do not hide arbitrary documents merely mentioning the prefix.
	return (
		normalized === "[TASK RESUMPTION] Please continue where you left off." ||
		normalized ===
			"The user approved switching to act mode. Continue with the approved plan now."
	);
}

/** Hook output is a separate runtime message, never a user_input body. */
function isRawHookContext(text: string): boolean {
	let offset = 0;
	let blocks = 0;
	while (text.startsWith("<hook_context ", offset)) {
		const openEnd = text.indexOf(">", offset);
		if (openEnd < 0) return false;
		const open = text.slice(offset, openEnd + 1);
		if (
			!/^<hook_context source="(?:RunStart|PreToolUse|PostToolUse)"(?: tool_name="[^"<>]*" tool_call_id="[^"<>]*")?>$/.test(
				open,
			)
		)
			return false;
		const end = text.indexOf("</hook_context>", openEnd + 1);
		if (end < 0 || text.slice(openEnd + 1, end).includes("<hook_context"))
			return false;
		offset = end + "</hook_context>".length;
		while (offset < text.length && /\s/.test(text[offset] ?? "")) offset += 1;
		blocks += 1;
	}
	return blocks > 0 && offset === text.length;
}
