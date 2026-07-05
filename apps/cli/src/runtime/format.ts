import { askQuestionInTerminal } from "../utils/approval";
import type { Config } from "../utils/types";

export function describeAbortSource(input: {
	abortRequested: boolean;
	timedOut: boolean;
}): string {
	if (input.timedOut) {
		return "aborted after timeout";
	}
	if (input.abortRequested) {
		return "aborted";
	}
	return "aborted by another client";
}

export async function resolveMistakeLimitDecision(
	config: Config,
	context: {
		iteration: number;
		consecutiveMistakes: number;
		maxConsecutiveMistakes: number;
		reason: "api_error" | "invalid_tool_call" | "tool_execution_failed";
		details?: string;
	},
): Promise<
	| { action: "continue"; guidance?: string }
	| { action: "stop"; reason?: string }
> {
	const yoloEnabled = config.toolPolicies["*"]?.autoApprove !== false;
	if (yoloEnabled) {
		return {
			action: "stop",
			reason: `max consecutive mistakes reached (${context.maxConsecutiveMistakes}) in yolo mode`,
		};
	}
	const detail = context.details?.trim();
	const summary = detail
		? `${context.reason}: ${detail}`
		: `${context.reason} at iteration ${context.iteration}`;
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return {
			action: "stop",
			reason: `mistake_limit_reached: ${summary}`,
		};
	}
	const answer = await askQuestionInTerminal(
		`mistake_limit_reached (${context.consecutiveMistakes}/${context.maxConsecutiveMistakes})\nLatest: ${summary}\nHow should Cline continue?`,
		["Try a different approach", "Stop this run"],
	);
	const normalized = answer.trim().toLowerCase();
	if (
		normalized === "2" ||
		normalized === "stop this run" ||
		normalized === "stop" ||
		normalized === "n" ||
		normalized === "no"
	) {
		return {
			action: "stop",
			reason: "stopped after mistake_limit_reached prompt",
		};
	}
	if (
		normalized === "1" ||
		normalized === "try a different approach" ||
		normalized.length === 0
	) {
		return {
			action: "continue",
			guidance:
				"mistake_limit_reached: retry with a different approach, validate tool parameters before calls, and avoid repeating failed steps.",
		};
	}
	return {
		action: "continue",
		guidance: `mistake_limit_reached: ${answer.trim()}`,
	};
}
