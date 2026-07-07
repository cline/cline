import type { ContentBlock, MessageWithMetadata } from "@cline/shared";

export type BudgetPolicyIntent =
	| "agentic_summary"
	| "basic_compaction_projection"
	| "normal_provider_request";

export type BudgetActionKind =
	| "truncated_text"
	| "dropped_block"
	| "dropped_message"
	| "preserved";

export type BudgetActionReason =
	| "over_budget"
	| "unsafe_to_truncate"
	| "tool_pair_boundary"
	| "protected_live_tail";

export type LiveTailHandling =
	| "included_verbatim"
	| "included_degraded"
	| "summarized_as_context"
	| "omitted_with_warning"
	| "preserved_out_of_band";

export type BlockBudgetClass =
	| "text"
	| "thinking"
	| "tool_use"
	| "tool_result"
	| "unsafe_binary"
	| "unsafe_encrypted"
	| "opaque";

export interface BudgetPath {
	messageIndex: number;
	blockIndex?: number;
}

interface BaseBudgetAction {
	path: BudgetPath;
	originalSize: number;
	finalSize: number;
}

export type BudgetMutationAction =
	| (BaseBudgetAction & {
			kind: "truncated_text";
			reason: Extract<BudgetActionReason, "over_budget">;
	  })
	| (BaseBudgetAction & {
			kind: "dropped_block";
			path: Required<BudgetPath>;
			reason: Exclude<BudgetActionReason, "protected_live_tail">;
	  })
	| (BaseBudgetAction & {
			kind: "dropped_message";
			reason: Exclude<BudgetActionReason, "protected_live_tail">;
	  });

export interface BudgetPreservedAction extends BaseBudgetAction {
	kind: "preserved";
	reason: Extract<
		BudgetActionReason,
		"protected_live_tail" | "tool_pair_boundary"
	>;
}

export type BudgetAction = BudgetMutationAction | BudgetPreservedAction;

export type BudgetProjectionWarningCode =
	| "budget_impossible"
	| "budget_unachievable_with_protections";

export interface BudgetProjectionWarning {
	code: BudgetProjectionWarningCode;
	message: string;
	path?: BudgetPath;
}

export interface BudgetProjectionOptions {
	messages: MessageWithMetadata[];
	targetTokens: number;
	policyIntent: BudgetPolicyIntent;
	estimateMessageTokens: (message: MessageWithMetadata) => number;
}

export interface BudgetProjectionResult {
	messages: MessageWithMetadata[];
	actions: BudgetAction[];
	liveTailHandling: LiveTailHandling;
	estimatedTokens: number;
	warnings: BudgetProjectionWarning[];
}

export interface ContentBlockBudgetClassification {
	block: ContentBlock;
	budgetClass: BlockBudgetClass;
	canStringTruncate: boolean;
	canDropWholeBlock: boolean;
}
