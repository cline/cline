/**
 * The auto-approve presentation layer, shared by Settings and the composer.
 * See `policy-copy.ts` for why the copy is centralised here.
 */
export {
	ApprovalTierRow,
	type ApprovalTierRowProps,
} from "./ApprovalTierRow";
export {
	matchesPreset,
	POLICY_PRESETS,
	type PolicyPreset,
	type PolicySummary,
	type PolicyTone,
	summarizeApprovalPolicy,
	TIER_COPY,
	type TierCopy,
} from "./policy-copy";
