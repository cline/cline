/**
 * Wire protocol for the Cline <-> computer-use backend socket connection.
 *
 * This is intentionally NOT MCP. The computer-use backend (a Rust process,
 * developed out-of-tree) is a single-purpose, low-latency screen/input
 * bridge: connect once, send an action, get a screenshot back. MCP's
 * JSON-RPC 2.0 handshake, capability negotiation, and stdio/SSE transport
 * machinery buy nothing here and add real latency + complexity for a tool
 * that's called on every turn of an agentic loop. A plain newline-delimited
 * JSON ("JSON Lines" / JSON-L) socket protocol keeps the dependency light
 * and easy to reimplement in Rust with nothing more than `tokio::net` +
 * `serde_json`.
 *
 * Framing: every message is a single JSON value serialized on one line,
 * terminated by "\n". No Content-Length headers, no multipart framing.
 * Newlines inside string values MUST be JSON-escaped (this is automatic with
 * `JSON.stringify`/`serde_json::to_string`), so a bare "\n" always marks a
 * message boundary.
 *
 * Transport: plain TCP, localhost only. TCP (rather than a Unix domain
 * socket / Windows named pipe) is used so the same client code works
 * unmodified on Windows, macOS, and Linux. This is a local trust boundary
 * (loopback only, never bound to 0.0.0.0).
 */

/**
 * Actions understood by the computer-use backend, mirroring Anthropic's
 * `computer` tool action set (see
 * https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool).
 */
export type ComputerUseAction =
	| "screenshot"
	| "cursor_position"
	| "mouse_move"
	| "left_click"
	| "left_click_drag"
	| "right_click"
	| "middle_click"
	| "double_click"
	| "triple_click"
	| "left_mouse_down"
	| "left_mouse_up"
	| "key"
	| "hold_key"
	| "type"
	| "scroll"
	| "wait"
	| "zoom";

/**
 * Internal query (not one of Anthropic's `computer` tool actions) used to
 * ask the backend for the real, native display dimensions before the
 * `computer` tool is built. The tool's description/schema is static once
 * built, so this must be resolved once at startup rather than per model
 * turn — see `ComputerUseClient.getDisplayInfo()`.
 */
export const GET_DISPLAY_INFO_ACTION = "get_display_info";

/** Native display dimensions reported by the backend. */
export interface ComputerUseDisplayInfo {
	widthPx: number;
	heightPx: number;
}

/** A single [x, y] pixel coordinate in the (possibly scaled) display space. */
export type ComputerUseCoordinate = readonly [number, number];

/** Request envelope sent from Cline to the computer-use backend, one per line. */
export interface ComputerUseRequest {
	/** Monotonically increasing id used to match responses to requests. */
	id: number;
	action: ComputerUseAction | typeof GET_DISPLAY_INFO_ACTION;
	coordinate?: ComputerUseCoordinate;
	startCoordinate?: ComputerUseCoordinate;
	text?: string;
	/** Key name(s) for "key"/"hold_key", e.g. "ctrl+alt+delete". */
	keys?: string;
	/** Duration in seconds, used by "hold_key" and "wait". */
	durationSeconds?: number;
	scrollDirection?: "up" | "down" | "left" | "right";
	scrollAmount?: number;
	/** Region [x, y, width, height] for "zoom". */
	region?: readonly [number, number, number, number];
}

/** A single image returned by the backend (typically a screenshot). */
export interface ComputerUseImage {
	/** Base64-encoded image bytes. */
	data: string;
	/** MIME type, e.g. "image/png". */
	mediaType: string;
}

/** Response envelope received from the computer-use backend, one per line. */
export interface ComputerUseResponse {
	/** Echoes the request id this response answers. */
	id: number;
	ok: boolean;
	/** Human-readable result text (e.g. cursor position, ack message). */
	text?: string;
	/**
	 * Present for actions that capture the screen ("screenshot", and
	 * optionally others that return a post-action screenshot).
	 */
	image?: ComputerUseImage;
	/** Present in the response to a "get_display_info" request. */
	display?: ComputerUseDisplayInfo;
	/** Present when ok is false. */
	error?: string;
}

/** Type guard for parsed JSON-L lines from the backend. */
export function isComputerUseResponse(
	value: unknown,
): value is ComputerUseResponse {
	if (!value || typeof value !== "object") {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	return typeof candidate.id === "number" && typeof candidate.ok === "boolean";
}
