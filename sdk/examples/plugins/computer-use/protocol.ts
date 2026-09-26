/** Newline-delimited JSON protocol spoken by the out-of-tree qbt backend. */

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
	| "zoom"
	| "run_sequence";

export const GET_DISPLAY_INFO_ACTION = "get_display_info";

export interface ComputerUseDisplayInfo {
	widthPx: number;
	heightPx: number;
}

export type ComputerUseCoordinate = readonly [number, number];

export interface ComputerUseRequest {
	id: number;
	action: ComputerUseAction | typeof GET_DISPLAY_INFO_ACTION;
	coordinate?: ComputerUseCoordinate;
	startCoordinate?: ComputerUseCoordinate;
	text?: string;
	durationSeconds?: number;
	scrollDirection?: "up" | "down" | "left" | "right";
	scrollAmount?: number;
	region?: readonly [number, number, number, number];
	actions?: ComputerUseSequenceItem[];
	expectUnchanged?: readonly [number, number, number, number];
}

export type ComputerUseSequenceItem = Omit<ComputerUseRequest, "id">;

export interface ComputerUseImage {
	data: string;
	mediaType: string;
}

export interface ComputerUseResponse {
	id: number;
	ok: boolean;
	aborted?: boolean;
	text?: string;
	image?: ComputerUseImage;
	display?: ComputerUseDisplayInfo;
	error?: string;
}

export function isComputerUseResponse(
	value: unknown,
): value is ComputerUseResponse {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	return typeof candidate.id === "number" && typeof candidate.ok === "boolean";
}
