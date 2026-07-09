import { createTool } from "@cline/shared";
import type { AgentTool, AgentToolContext } from "@cline/shared";
import { ComputerUseClient, type ComputerUseClientOptions } from "./client";
import type { ComputerUseAction, ComputerUseCoordinate } from "./protocol";

export interface ComputerUseToolOptions extends ComputerUseClientOptions {
	/**
	 * Override for the controlled display's width in pixels, reported in the
	 * tool description. When omitted, this is queried from the backend at
	 * construction time via `ComputerUseClient.getDisplayInfo()` — the
	 * backend is the source of truth for the real, native screen size.
	 */
	displayWidthPx?: number;
	/** Override for display height in pixels. See `displayWidthPx`. */
	displayHeightPx?: number;
	/**
	 * Optional pre-built client. Mainly useful for tests and for hosts that
	 * want explicit control over the connection's lifecycle (e.g. calling
	 * `client.close()` on shutdown). When omitted, a client is constructed
	 * from the other options.
	 */
	client?: ComputerUseClient;
}

/** Raw tool input shape as sent by the model (mirrors Anthropic's `computer` tool). */
interface ComputerToolInput {
	action: ComputerUseAction;
	coordinate?: ComputerUseCoordinate;
	start_coordinate?: ComputerUseCoordinate;
	text?: string;
	duration?: number;
	scroll_direction?: "up" | "down" | "left" | "right";
	scroll_amount?: number;
	region?: readonly [number, number, number, number];
}

const COMPUTER_TOOL_NAME = "computer";

const COMPUTER_TOOL_INPUT_SCHEMA: Record<string, unknown> = {
	type: "object",
	properties: {
		action: {
			type: "string",
			enum: [
				"screenshot",
				"cursor_position",
				"mouse_move",
				"left_click",
				"left_click_drag",
				"right_click",
				"middle_click",
				"double_click",
				"triple_click",
				"left_mouse_down",
				"left_mouse_up",
				"key",
				"hold_key",
				"type",
				"scroll",
				"wait",
				"zoom",
			],
			description: "The action to perform.",
		},
		coordinate: {
			type: "array",
			items: { type: "number" },
			minItems: 2,
			maxItems: 2,
			description:
				"(x, y) pixel coordinate, required for mouse_move, left_click, left_click_drag (end point), right_click, middle_click, double_click, triple_click, left_mouse_down, left_mouse_up, and scroll (scroll origin).",
		},
		start_coordinate: {
			type: "array",
			items: { type: "number" },
			minItems: 2,
			maxItems: 2,
			description: "(x, y) start coordinate, required for left_click_drag.",
		},
		text: {
			type: "string",
			description:
				"Text to type (for the type action) or key combination to press (for key/hold_key, e.g. 'ctrl+alt+delete').",
		},
		duration: {
			type: "number",
			description: "Duration in seconds, used by hold_key and wait.",
		},
		scroll_direction: {
			type: "string",
			enum: ["up", "down", "left", "right"],
			description: "Direction to scroll, required for the scroll action.",
		},
		scroll_amount: {
			type: "number",
			description: "Number of scroll clicks, required for the scroll action.",
		},
		region: {
			type: "array",
			items: { type: "number" },
			minItems: 4,
			maxItems: 4,
			description:
				"(x, y, width, height) region to zoom into, required for the zoom action.",
		},
	},
	required: ["action"],
};

function toComputerUseRequest(input: ComputerToolInput) {
	return {
		action: input.action,
		coordinate: input.coordinate,
		startCoordinate: input.start_coordinate,
		text: input.text,
		durationSeconds: input.duration,
		scrollDirection: input.scroll_direction,
		scrollAmount: input.scroll_amount,
		region: input.region,
	};
}

/**
 * Builds the `computer` tool that forwards Anthropic computer-use tool calls
 * to an external, lightweight backend (a Rust process developed out-of-tree)
 * over a plain JSON-L TCP socket.
 *
 * This is async because the tool's description embeds the display size,
 * which is queried from the backend (the source of truth for the real,
 * native screen dimensions) unless both `displayWidthPx`/`displayHeightPx`
 * are explicitly overridden in `options`.
 *
 * This is a genuine `@cline/core` `AgentTool` — usable from any host that
 * builds a `CoreSessionConfig` (CLI, VSCode adapter, etc.) via
 * `config.extraTools`. It's deliberately isolated within its own folder
 * (only depends on `@cline/shared`'s `AgentTool` contract) so it can be
 * lifted out into a standalone Cline plugin later with minimal changes. See
 * ./README.md for the wire protocol and rationale.
 */
export async function createComputerUseTool(
	options: ComputerUseToolOptions,
): Promise<AgentTool> {
	const client = options.client ?? new ComputerUseClient(options);

	const { displayWidthPx, displayHeightPx } =
		options.displayWidthPx !== undefined && options.displayHeightPx !== undefined
			? { displayWidthPx: options.displayWidthPx, displayHeightPx: options.displayHeightPx }
			: await client.getDisplayInfo().then((info) => ({
					displayWidthPx: options.displayWidthPx ?? info.widthPx,
					displayHeightPx: options.displayHeightPx ?? info.heightPx,
				}));

	return createTool({
		name: COMPUTER_TOOL_NAME,
		description:
			`Control the screen and keyboard/mouse of a remote computer environment. ` +
			`The display is ${displayWidthPx}x${displayHeightPx} pixels. ` +
			`Use "screenshot" to see the current screen before acting, since the environment ` +
			`may change between turns. Coordinates are [x, y] pixels from the top-left corner.`,
		inputSchema: COMPUTER_TOOL_INPUT_SCHEMA,
		// Screenshots and round trips to an external process are slower than
		// in-process tools; give this more room than the SDK's 30s default.
		timeoutMs: 30_000,
		retryable: false,
		execute: async (input: unknown, _context: AgentToolContext) => {
			const parsedInput = input as ComputerToolInput;
			const response = await client.send(toComputerUseRequest(parsedInput));

			if (!response.ok) {
				throw new Error(
					response.error ?? `Computer-use action "${parsedInput.action}" failed`,
				);
			}

			if (!response.image) {
				return response.text ?? `Action "${parsedInput.action}" completed.`;
			}

			return [
				{
					type: "text" as const,
					text: response.text ?? `Action "${parsedInput.action}" completed.`,
				},
				{
					type: "image" as const,
					data: response.image.data,
					mediaType: response.image.mediaType,
				},
			];
		},
	});
}
