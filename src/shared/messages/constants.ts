/**
 * Constants for identifying user-generated content and system-generated markers
 * in task conversations. These are used to parse and filter content appropriately.
 */

/**
 * Tags that wrap user-generated content in the conversation.
 * Used to identify content that comes from the user vs system-generated content.
 */
export const USER_CONTENT_TAGS = ["<task>", "<feedback>", "<answer>", "<user_message>"] as const

/**
 * Markers for system-generated content that should be excluded when parsing user input.
 * These indicate content added by the system rather than the user.
 */
export const SYSTEM_CONTENT_MARKERS = [
	"[TASK RESUMPTION]",
	"<hook_context",
	"[Response interrupted",
	"Task was interrupted",
] as const
