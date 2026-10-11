import type { AgentTool, AgentToolContext } from "@cline/shared";
import { createTool, zodToJsonSchema } from "@cline/shared";
import { z } from "zod";
import type { ComputerBackendRestartCapability } from "./backend-restart";
import { ComputerUseClient, type ComputerUseClientOptions } from "./client";
import type { ComputerUseRequest, ComputerUseSequenceItem } from "./protocol";

export interface ComputerUseToolOptions extends ComputerUseClientOptions {
	/**
	 * Optional pre-built client. Mainly useful for tests and for hosts that
	 * want explicit control over the connection's lifecycle (e.g. calling
	 * `client.close()` on shutdown). When omitted, a client is constructed
	 * from the other options.
	 */
	client?: ComputerUseClient;
	/** Enrolls a validated action in the host journal before checking backend readiness. */
	beforeAction?: () => Promise<unknown>;
	/** Starts an absent backend before each action and provides its wait budget. */
	backendAvailability?: Pick<
		ComputerBackendRestartCapability,
		"budgetMs" | "ensureRunning"
	>;
}

const COMPUTER_TOOL_NAME = "computer";
const MAX_ESTIMATED_WORK_MS = 120_000;
const ACTION_RESPONSE_TIMEOUT_MS = 150_000;
const ACTION_OVERHEAD_MS = 250;
const JOURNAL_TIMEOUT_MARGIN_MS = 30_000;

// This raw-action allowlist is shared by runtime validation and the model schema.
// Internal protocol queries and clipboard actions are deliberately absent.
const RAW_ACTIONS = [
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
	"brief_pause",
	"wait",
	"zoom",
] as const;

// qbt accepts unsigned pixels but passes them to signed 32-bit desktop APIs.
const Pixel = z.number().int().nonnegative().max(2_147_483_647);
// Uniform array items keep the model schema portable across providers.
const Coordinate = z.array(Pixel).length(2);
const Region = z.array(Pixel).length(4);
const ACTION_FIELDS = {
	coordinate: Coordinate.describe(
		"(x, y) nonnegative integer pixel coordinate, required for mouse_move, left_click, left_click_drag (end point), right_click, middle_click, double_click, triple_click, left_mouse_down, left_mouse_up, and scroll (scroll origin).",
	).optional(),
	start_coordinate: Coordinate.describe(
		"(x, y) start coordinate, required for left_click_drag.",
	).optional(),
	text: z
		.string()
		.describe(
			"Required text to type (type) or key combination to press (key/hold_key, e.g. 'ctrl+alt+delete'). Typing costs 90 ms per Unicode character; split oversized text across calls.",
		)
		.optional(),
	duration: z
		.number()
		.finite()
		.min(0)
		.max(120)
		.describe(
			"Required duration in seconds for hold_key and wait, from 0 to 120. The aggregate work budget includes 250 ms per action, so split oversized waits across calls.",
		)
		.optional(),
	scroll_direction: z
		.enum(["up", "down", "left", "right"])
		.describe("Direction to scroll, required for the scroll action.")
		.optional(),
	scroll_amount: z
		.number()
		.int()
		.nonnegative()
		.max(4_294_967_295)
		.describe(
			"Nonnegative integer number of scroll clicks, required for scroll.",
		)
		.optional(),
	region: Region.describe(
		"(x0, y0, x1, y1) region to zoom into, required for the zoom action.",
	).optional(),
	expect_unchanged: Region.describe(
		"(x, y, width, height) click guard: a region that must look unchanged since the last screenshot you saw. The backend compares it before clicking; if it changed, the click is aborted and you get a fresh screenshot instead. Use it for clicks on targets that might move or disappear.",
	).optional(),
};

const SEQUENCE_STEP_SCHEMA = z
	.object({
		action: z.enum(RAW_ACTIONS).describe("The action to perform."),
		...ACTION_FIELDS,
	})
	.strict();

const COMPUTER_TOOL_INPUT_BASE = SEQUENCE_STEP_SCHEMA.extend({
	action: z
		.enum([...RAW_ACTIONS, "run_sequence"])
		.describe("The action to perform."),
	actions: z
		.array(SEQUENCE_STEP_SCHEMA)
		.min(1)
		.max(20)
		.describe(
			"Required steps for run_sequence only: 1–20 non-nested actions executed back-to-back, aborting on the first failure or refused click, returning one final screenshot. All steps share a 120-second estimated work budget; split oversized work across calls.",
		)
		.optional(),
}).strict();

type ComputerToolInput = z.infer<typeof COMPUTER_TOOL_INPUT_BASE>;
type ComputerToolSequenceInput = z.infer<typeof SEQUENCE_STEP_SCHEMA>;

const REQUIRED_ACTION_FIELDS: Partial<
	Record<ComputerToolInput["action"], readonly (keyof ComputerToolInput)[]>
> = {
	mouse_move: ["coordinate"],
	left_click: ["coordinate"],
	left_click_drag: ["coordinate", "start_coordinate"],
	right_click: ["coordinate"],
	middle_click: ["coordinate"],
	double_click: ["coordinate"],
	triple_click: ["coordinate"],
	left_mouse_down: ["coordinate"],
	left_mouse_up: ["coordinate"],
	key: ["text"],
	type: ["text"],
	hold_key: ["text", "duration"],
	wait: ["duration"],
	scroll: ["coordinate", "scroll_direction", "scroll_amount"],
	zoom: ["region"],
	run_sequence: ["actions"],
};

function validateRequiredFields(
	input: ComputerToolInput,
	context: z.RefinementCtx,
	path: (string | number)[] = [],
): void {
	for (const field of REQUIRED_ACTION_FIELDS[input.action] ?? []) {
		if (input[field] === undefined) {
			context.addIssue({
				code: "custom",
				path: [...path, field],
				message: `${field} is required for ${input.action}`,
			});
		}
	}
}

function estimatedActionWorkMs(input: ComputerToolInput): number {
	let workMs = ACTION_OVERHEAD_MS;
	if (input.action === "wait" || input.action === "hold_key") {
		workMs += (input.duration ?? 0) * 1_000;
	} else if (input.action === "brief_pause") {
		workMs += 300;
	} else if (input.action === "type") {
		// Iteration counts Unicode code points, not UTF-16 surrogate halves.
		for (const _character of input.text ?? "") {
			workMs += 90;
			if (workMs > MAX_ESTIMATED_WORK_MS) break;
		}
	}
	return workMs;
}

const COMPUTER_TOOL_INPUT = COMPUTER_TOOL_INPUT_BASE.superRefine(
	(input, context) => {
		validateRequiredFields(input, context);
		if (input.action !== "run_sequence" && input.actions !== undefined) {
			context.addIssue({
				code: "custom",
				path: ["actions"],
				message: "actions is only valid for run_sequence",
			});
		}
		// Validate the whole sequence before enrolling or executing even its first step.
		for (const [index, step] of (input.actions ?? []).entries()) {
			validateRequiredFields(step, context, ["actions", index]);
		}
		const workMs =
			input.action === "run_sequence"
				? (input.actions ?? []).reduce(
						(total, step) => total + estimatedActionWorkMs(step),
						0,
					)
				: estimatedActionWorkMs(input);
		if (workMs > MAX_ESTIMATED_WORK_MS) {
			context.addIssue({
				code: "custom",
				message:
					"Estimated computer work exceeds the 120-second budget. Split oversized waits, typing, or sequences across calls.",
			});
		}
	},
);

function toComputerUseRequest(
	input: ComputerToolInput,
): Omit<ComputerUseRequest, "id"> {
	// Runtime validation checked these arrays' elements and exact tuple lengths.
	return {
		action: input.action,
		coordinate: input.coordinate as ComputerUseRequest["coordinate"],
		startCoordinate:
			input.start_coordinate as ComputerUseRequest["startCoordinate"],
		text: input.text,
		durationSeconds: input.duration,
		scrollDirection: input.scroll_direction,
		scrollAmount: input.scroll_amount,
		region: input.region as ComputerUseRequest["region"],
		expectUnchanged:
			input.expect_unchanged as ComputerUseRequest["expectUnchanged"],
		...(input.actions ? { actions: input.actions.map(toSequenceItem) } : {}),
	};
}

function toSequenceItem(
	input: ComputerToolSequenceInput,
): ComputerUseSequenceItem {
	return {
		action: input.action,
		coordinate: input.coordinate as ComputerUseSequenceItem["coordinate"],
		startCoordinate:
			input.start_coordinate as ComputerUseSequenceItem["startCoordinate"],
		text: input.text,
		durationSeconds: input.duration,
		scrollDirection: input.scroll_direction,
		scrollAmount: input.scroll_amount,
		region: input.region as ComputerUseSequenceItem["region"],
		expectUnchanged:
			input.expect_unchanged as ComputerUseSequenceItem["expectUnchanged"],
	};
}

/**
 * Builds the `computer` tool that forwards Anthropic computer-use tool calls
 * to an external, lightweight backend (a Rust process developed out-of-tree)
 * over a plain JSON-L TCP socket.
 *
 * This is async because the tool's description embeds the display size,
 * which is always queried from the backend at construction time: the
 * backend is the only component that can know the real framebuffer
 * dimensions, and an independently configured value that disagreed with
 * them would corrupt every coordinate the model computes. (The dimensions
 * are still a construction-time snapshot — a display resize after startup
 * requires rebuilding the tool. See "Display size" in ./README.md.)
 *
 * This is a genuine `@cline/core` `AgentTool` — usable from any host that
 * builds a `CoreSessionConfig` (CLI, VSCode adapter, etc.) via
 * `config.extraTools`. It's deliberately isolated within its own folder
 * (uses `@cline/shared`'s `AgentTool` contract and Zod validation) so it can be
 * lifted out into a standalone Cline plugin later with minimal changes. See
 * ./README.md for the wire protocol and rationale.
 */
export async function createComputerUseTool(
	options: ComputerUseToolOptions,
): Promise<AgentTool> {
	const client = options.client ?? new ComputerUseClient(options);
	try {
		const { widthPx, heightPx } = await client.getDisplayInfo();

		return createTool({
			name: COMPUTER_TOOL_NAME,
			description:
				`Control the screen and keyboard/mouse of a remote computer environment. ` +
				`The display is ${widthPx}x${heightPx} pixels. ` +
				`Use "screenshot" to see the current screen before acting, since the environment ` +
				`may change between turns. Coordinates are [x, y] pixels from the top-left corner. ` +
				`After opening a dialog, launcher, menu, or other transient UI, do not type ` +
				`immediately: include "brief_pause" before typing, or inspect a screenshot ` +
				`that confirms the intended input is present and focused. ` +
				`Every click, type, key, scroll, and drag action returns a screenshot of the ` +
				`resulting state — do not take a separate screenshot just to see what an action ` +
				`did; reserve standalone screenshots for navigation, loading, or uncertain state. ` +
				`For multi-step interactions (e.g. click a field, type, click the next field) use ` +
				`the run_sequence action: all steps execute back-to-back and you get one screenshot ` +
				`of the final state — one round trip instead of one per action. For clicks on ` +
				`targets that might move or disappear, pass expect_unchanged: [x, y, width, height] ` +
				`covering the target; the backend aborts the click and returns a fresh screenshot ` +
				`if that region changed since the screenshot you last saw. ` +
				`Each call has a 120-second estimated work budget: waits and held keys, ` +
				`90 ms per Unicode character typed, 300 ms per brief_pause, and 250 ms per step. ` +
				`Split oversized waits, text, or sequences across calls.`,
			// The strict Zod base is the sole source of the model-visible schema;
			// its runtime refinement additionally checks action requirements and work.
			inputSchema: zodToJsonSchema(COMPUTER_TOOL_INPUT_BASE),
			// Journal enrollment (a default 15s publish plus 3s connect), recovery,
			// connection setup, and the action response each need their own budget.
			timeoutMs:
				(options.backendAvailability?.budgetMs ?? 0) +
				ACTION_RESPONSE_TIMEOUT_MS +
				(options.connectTimeoutMs ?? 3_000) +
				JOURNAL_TIMEOUT_MARGIN_MS,
			retryable: false,
			execute: async (input: unknown, context: AgentToolContext) => {
				const parsedInput = COMPUTER_TOOL_INPUT.parse(input);
				context.signal?.throwIfAborted();
				await options.beforeAction?.();
				context.signal?.throwIfAborted();
				if (options.backendAvailability) {
					const readiness = await options.backendAvailability.ensureRunning(
						context.signal,
					);
					if (readiness.status === "failed_to_start") {
						throw new Error(
							`Computer-use backend recovery failed: ${readiness.error}`,
						);
					}
				}
				// Forward the runtime's abort signal so a cancelled agent run
				// stops waiting on the backend. An already-delivered input event
				// cannot be recalled; the caller re-screenshots before trusting
				// screen state after a cancellation.
				const response = await client.send(toComputerUseRequest(parsedInput), {
					signal: context.signal,
					requestTimeoutMs: ACTION_RESPONSE_TIMEOUT_MS,
				});

				if (!response.ok) {
					throw new Error(
						response.error ??
							`Computer-use action "${parsedInput.action}" failed`,
					);
				}

				const resultText =
					response.text ??
					(response.aborted
						? `Action "${parsedInput.action}" aborted. Reassess the screen before continuing.`
						: `Action "${parsedInput.action}" completed.`);
				if (!response.image) {
					return resultText;
				}

				return [
					{
						type: "text" as const,
						text: resultText,
					},
					{
						type: "image" as const,
						data: response.image.data,
						mediaType: response.image.mediaType,
					},
				];
			},
		});
	} catch (error) {
		// Only the private client is ours to dispose when construction fails.
		// Hosts retain lifecycle ownership of any injected client.
		if (!options.client) client.close();
		throw error;
	}
}
