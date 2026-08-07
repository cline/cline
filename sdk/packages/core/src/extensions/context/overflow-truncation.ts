import type { BasicLogger, MessageWithMetadata } from "@cline/shared";
import { countUserRunMessages } from "../../session/user-run-messages";
import type {
	CoreCompactionContext,
	CoreCompactionResult,
} from "../../types/config";
import { buildBudgetProjection } from "./budget-projection";
import {
	type EstimateMessageTokens,
	isTurnStartMessage,
} from "./compaction-shared";

/**
 * Message-token budget for overflow recovery, as a share of the model's
 * input limit. Deliberately far below the trigger threshold: recovery runs
 * only after the provider has *proven* the request does not fit, which means
 * the token estimate undercounted reality (token-dense scripts like CJK cost
 * ~1 token per character against the estimator's chars-per-token divisor).
 * Aiming this low keeps the retry under the real window even when the
 * estimate is off by several times.
 */
export const OVERFLOW_RECOVERY_WINDOW_RATIO = 0.2;

/**
 * Starting the kept tail here cannot orphan half of a tool_use/tool_result
 * pair: an assistant's tool_use keeps its results in the user message that
 * follows it, and typed user turns carry no pairs. (Same rule as the cut
 * boundary in compaction-shared's findCutIndex.)
 */
function isSafeKeepBoundary(message: MessageWithMetadata): boolean {
	return message.role === "assistant" || isTurnStartMessage(message);
}

function buildDroppedContextNotice(input: {
	droppedCount: number;
	droppedUserRuns: number;
}): MessageWithMetadata {
	return {
		role: "user",
		content: [
			{
				type: "text",
				text: `<SYSTEM_NOTICE>\nThe conversation exceeded the model's context window (this often happens when a tool call returns a very large output), so the oldest ${input.droppedCount} message(s) were removed and oversized content may have been truncated to make room. If you need those earlier details, re-read the relevant files or re-run the commands.\n</SYSTEM_NOTICE>`,
			},
		],
		metadata: {
			kind: "overflow_truncation",
			displayRole: "system",
			// Keeps checkpoint run counting aligned: the notice stands in for
			// however many real user turns were dropped.
			userRunSpan: input.droppedUserRuns,
		},
	};
}

/**
 * Deterministic overflow recovery: the provider rejected the request as
 * exceeding the context window, so keep only the newest messages that fit
 * the recovery budget, drop everything older, and replace it with a short
 * notice. No summarizer call and no trust in the token estimate being
 * right — recovery must always end with a strictly smaller request.
 *
 * When even the newest messages alone exceed the budget (a single massive
 * tool output can outweigh the whole window), the kept tail is additionally
 * run through the budget projection, which truncates oversized text while
 * keeping tool pairs intact and the live typed prompt verbatim.
 */
export function runOverflowTruncation(options: {
	context: CoreCompactionContext;
	estimateMessageTokens: EstimateMessageTokens;
	logger?: BasicLogger;
}): CoreCompactionResult | undefined {
	const messages = options.context.messages;
	const estimate = options.estimateMessageTokens;
	if (messages.length === 0) {
		return undefined;
	}
	const targetTokens = Math.max(
		1,
		options.context.budget.messages.targetTokens,
	);

	// Keep the newest messages that fit the budget (reserving room for the
	// notice). Index 0 is never kept: the provider rejected this transcript,
	// so at least one message must go even when the (already disproven)
	// estimate claims everything fits.
	const noticeCost = estimate(
		buildDroppedContextNotice({ droppedCount: 1, droppedUserRuns: 1 }),
	);
	let cut = messages.length;
	let keptTokens = noticeCost;
	for (let index = messages.length - 1; index >= 1; index -= 1) {
		const cost = estimate(messages[index]);
		if (keptTokens + cost > targetTokens) {
			break;
		}
		keptTokens += cost;
		cut = index;
	}
	// Never split a tool pair: advance to the next safe boundary.
	while (cut < messages.length && !isSafeKeepBoundary(messages[cut])) {
		cut += 1;
	}

	// Nothing fits under the budget (e.g. one enormous recent tool result).
	// Fall back to the tail from the last safe boundary and let the budget
	// projection truncate its oversized text.
	if (cut >= messages.length) {
		for (cut = messages.length - 1; cut >= 1; cut -= 1) {
			if (isSafeKeepBoundary(messages[cut])) {
				break;
			}
		}
		if (cut < 1) {
			// Only the transcript's first message remains; dropping it would
			// erase the request being retried.
			return undefined;
		}
	}

	const dropped = messages.slice(0, cut);
	const notice = buildDroppedContextNotice({
		droppedCount: dropped.length,
		droppedUserRuns: countUserRunMessages(dropped),
	});
	const budgeted = buildBudgetProjection({
		messages: [notice, ...messages.slice(cut)],
		targetTokens,
		policyIntent: "basic_compaction_projection",
		estimateMessageTokens: estimate,
	});
	options.logger?.log("Performed overflow truncation", {
		severity: "info",
		messagesBefore: messages.length,
		messagesDropped: dropped.length,
		messagesAfter: budgeted.messages.length,
		targetTokens,
		projectedTokens: budgeted.estimatedTokens,
		budgetStatus: budgeted.status,
		budgetWarnings: budgeted.warnings.map((warning) => warning.code),
	});
	const budgetActionCount = budgeted.actions.filter(
		(action) =>
			action.reason === "over_budget" || action.reason === "tool_pair_boundary",
	).length;
	return {
		messages: budgeted.messages,
		budget: {
			policyIntent: "basic_compaction_projection",
			actionCount: budgetActionCount,
			warningCount: budgeted.warnings.length,
			liveTailHandling: budgeted.liveTailHandling,
		},
	};
}
