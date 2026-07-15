import { createTool } from "@cline/shared";
import type { Config } from "../../utils/types";
import { resolveSystemPrompt } from "../prompt";

export type InteractiveUiMode = "plan" | "act";

/**
 * Pending mode change plus who requested it. The switch_to_act_mode tool and
 * the TUI mode toggle share this slot, but only a tool-initiated switch means
 * "the user approved the plan" -- a UI toggle that lands as a turn finishes
 * must not trigger plan execution.
 */
export type PendingModeChange = {
	current: InteractiveUiMode | null;
	source: "tool" | "ui" | null;
};

export type AppliedModeChange = {
	mode: InteractiveUiMode;
	source: "tool" | "ui";
};

/**
 * Canned prompt that drives the auto-continue turn after the model calls
 * switch_to_act_mode. It is a synthetic user message, so transcript hydration
 * filters it out of the chat display.
 */
export const ACT_MODE_CONTINUATION_PROMPT =
	"The user approved switching to act mode. Continue with the approved plan now.";

export function createInteractiveModeSwitchTool(input: {
	config: Config;
	pendingModeChange: PendingModeChange;
	tuiModeChanged: { current: ((mode: InteractiveUiMode) => void) | null };
}) {
	return createTool({
		name: "switch_to_act_mode",
		description:
			"Switch from plan mode to act mode. Switching to act mode immediately starts executing the plan, so only call this after the user has explicitly approved the plan in a message sent AFTER you presented it (e.g. 'looks good', 'go ahead', 'switch to act mode'). " +
			"Never call this in the same turn you present a plan, never call it proactively, and never treat the original task request as approval.",
		inputSchema: {
			type: "object",
			properties: {},
		},
		timeoutMs: 5000,
		retryable: false,
		maxRetries: 0,
		// The act-mode tools only exist after the session is rebuilt with the
		// new mode config, which can't happen mid-run. End the run right after
		// the tool result so the model never keeps working with plan-mode tools
		// it was just told it no longer has; run-interactive applies the pending
		// change and auto-continues on the rebuilt session.
		lifecycle: {
			completesRun: true,
		},
		execute: async () => {
			if (input.config.mode === "act") {
				// Throw instead of returning: a successful result would end the
				// run via completesRun even though nothing changed.
				throw new Error("Already in act mode.");
			}
			input.pendingModeChange.current = "act";
			input.pendingModeChange.source = "tool";
			input.tuiModeChanged.current?.("act");
			return "You successfully switched to act mode, proceed with the plan. You now have access to editing files and running commands. (The switch_to_act_mode tool is only available in plan mode.)";
		},
	});
}

/**
 * Runs one interactive turn, and when the model ended it by calling
 * switch_to_act_mode, continues the approved plan on the rebuilt act-mode
 * session instead of waiting for the user to prompt again.
 *
 * The continuation only fires for a tool-initiated switch on a turn that
 * finished "completed": a UI toggle mid-run aborts the turn, and even if the
 * toggle races a natural completion its source is "ui", so the user's Tab
 * press can never start executing a plan they did not approve.
 */
export async function sendTurnWithActModeContinuation<
	T extends { finishReason: string; iterations: number },
>(input: {
	sendInitialTurn: () => Promise<T | undefined>;
	sendContinuationTurn: (prompt: string) => Promise<T | undefined>;
	applyPendingModeChange: () => Promise<AppliedModeChange | undefined>;
}): Promise<T | undefined> {
	const result = await input.sendInitialTurn();
	const switched = await input.applyPendingModeChange();
	if (
		switched?.mode !== "act" ||
		switched.source !== "tool" ||
		result?.finishReason !== "completed"
	) {
		return result;
	}
	const continuation = await input.sendContinuationTurn(
		ACT_MODE_CONTINUATION_PROMPT,
	);
	// Honor a mode toggle made while the continuation was running.
	await input.applyPendingModeChange();
	if (!continuation) {
		return result;
	}
	return {
		...continuation,
		iterations: result.iterations + continuation.iterations,
	};
}

// The tracker moved to @cline/shared so the VSCode extension can share the
// exact round-trip-cancelling semantics; re-exported here to keep the CLI's
// import surface stable.
export {
	createModeSwitchNoticeTracker,
	type ModeSwitchNotice,
} from "@cline/shared";

export async function applyInteractiveModeConfig(input: {
	config: Config;
	mode: InteractiveUiMode;
	switchToActModeTool: NonNullable<Config["extraTools"]>[number];
}): Promise<void> {
	input.config.mode = input.mode;
	input.config.extraTools =
		input.mode === "plan" ? [input.switchToActModeTool] : [];
	input.config.systemPrompt = await resolveSystemPrompt({
		cwd: input.config.cwd,
		providerId: input.config.providerId,
		mode: input.mode,
	});
}
