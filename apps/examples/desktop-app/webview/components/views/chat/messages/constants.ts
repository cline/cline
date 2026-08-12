export const IS_DEBUG = process.env.NODE_ENV === "test";
export const STREAMING_TITLE_CLASS = "cline-chat-streaming-title";

/**
 * Expanded reasoning and tool panels hang off a shared left rail: the border
 * sits 8px in, centered under the 16px trigger icon, and the content is padded
 * 16px so panel text lines up with the trigger label above it. Both panels must
 * use this verbatim, and it overrides the panel chrome (border box, radius,
 * background, inset) that `agent-chat.css` gives each of them by default.
 *
 * Expanded content renders at full opacity — the user opened it, so it is the
 * thing they are reading; no hover-to-unfade.
 *
 * Reasoning stays capped and scrollable, while tool output grows into the
 * conversation scroller and wraps to avoid a nested scrolling region.
 */
export const EXPANDED_PANEL_RAIL_CLASS =
	"ml-1 mt-0 max-w-full rounded-none border-0 border-l border-border bg-transparent py-1 px-2 text-sm";
