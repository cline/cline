/**
 * The user-facing half of `session/approval-policy.ts`, in one place.
 *
 * Two surfaces now read the auto-approve policy — the Settings screen and the
 * composer's pill + sheet — and the failure mode of duplicating this copy is
 * worse than usual: two screens that describe the *same* blast radius in
 * different words teach the user that one of them is lying. So the tier labels,
 * the risk lines, the pill summary and the presets all live here, and both
 * surfaces render them through {@link import("./ApprovalTierRow").ApprovalTierRow}.
 *
 * Everything in this file is pure and free of React, so the pill label is
 * unit-testable across all eight policy combinations.
 */

import { Files, Pencil, Terminal } from "lucide-react-native";
import type { ComponentType } from "react";
import {
	APPROVAL_TIERS,
	type ApprovalPolicy,
	type ApprovalTier,
} from "@/session";

export interface TierCopy {
	/** Row heading. */
	label: string;
	/**
	 * One word for the pill, where three tiers have to fit next to a text input.
	 * Deliberately a verb-ish noun (`read`/`write`/`run`) rather than the row's
	 * full label, which would not fit.
	 */
	short: string;
	/** One line on what auto-approving this tier lets the agent do. */
	risk: string;
	icon: ComponentType<{ size?: number; color?: string }>;
}

export const TIER_COPY: Record<ApprovalTier, TierCopy> = {
	read: {
		label: "Read files",
		short: "read",
		risk: "Read files, search the codebase, list directories — cannot change anything.",
		icon: Files,
	},
	write: {
		label: "Edit files",
		short: "write",
		risk: "Create, rewrite and patch files — changes the workspace on disk.",
		icon: Pencil,
	},
	execute: {
		label: "Run commands",
		short: "run",
		risk: "Run shell commands — can modify or delete anything in the workspace.",
		icon: Terminal,
	},
};

/**
 * How loud the pill should be. Escalates with the widest auto-approved tier, so
 * a phone in a pocket that can run shell commands never looks the same as one
 * that can only read.
 */
export type PolicyTone = "neutral" | "accent" | "warning" | "danger";

export interface PolicySummary {
	/** Glanceable pill text, e.g. `Auto: read+write`. */
	label: string;
	tone: PolicyTone;
	/**
	 * Sentence form for the pill's accessibility label — "read" alone is not a
	 * useful thing for a screen reader to announce.
	 */
	spoken: string;
}

/**
 * Collapse a policy into the pill.
 *
 * The two extremes get named states rather than a tier list: `Auto: read+write+run`
 * is both too long for the pill and a worse description of "nothing will stop"
 * than `Auto: all`, and an empty list has to read as a positive assertion
 * (`Ask always`) rather than as `Auto: ` with nothing after it.
 */
export function summarizeApprovalPolicy(policy: ApprovalPolicy): PolicySummary {
	const auto = APPROVAL_TIERS.filter((tier) => policy[tier] === "auto");

	if (auto.length === 0) {
		return {
			label: "Ask always",
			tone: "neutral",
			spoken: "every tool call asks you first",
		};
	}
	if (auto.length === APPROVAL_TIERS.length) {
		return {
			label: "Auto: all",
			tone: "danger",
			spoken:
				"every tool call runs automatically, including shell commands and file edits",
		};
	}

	const shorts = auto.map((tier) => TIER_COPY[tier].short);
	return {
		label: `Auto: ${shorts.join("+")}`,
		// `execute` outranks `write`: a tier that can run `rm` is the headline even
		// when the safer tiers are also on.
		tone:
			policy.execute === "auto"
				? "danger"
				: policy.write === "auto"
					? "warning"
					: "accent",
		spoken: `${joinWords(shorts)} run automatically, everything else asks you first`,
	};
}

/** `["a"] → "a"`, `["a","b"] → "a and b"`. Only ever called with 1–2 items. */
function joinWords(words: string[]): string {
	if (words.length <= 1) {
		return words[0] ?? "";
	}
	return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export interface PolicyPreset {
	id: string;
	label: string;
	/** One line on what the preset trades away. */
	description: string;
	policy: ApprovalPolicy;
	/**
	 * Marks the preset that leaves shell commands running unattended, so the UI
	 * can paint it as the destructive choice it is.
	 */
	danger?: true;
}

/** One-tap policies, ordered least to most permissive. */
export const POLICY_PRESETS: readonly PolicyPreset[] = [
	{
		id: "ask-everything",
		label: "Ask for everything",
		description: "Nothing runs without a tap from you.",
		policy: { read: "ask", write: "ask", execute: "ask" },
	},
	{
		id: "auto-reads",
		label: "Auto-approve reads",
		description: "Reads and searches run; edits and commands still ask.",
		policy: { read: "auto", write: "ask", execute: "ask" },
	},
	{
		id: "auto-everything",
		label: "Auto-approve everything",
		description:
			"Shell commands run unattended, from a phone you may have pocketed.",
		policy: { read: "auto", write: "auto", execute: "auto" },
		danger: true,
	},
];

/** True when `policy` is exactly this preset, so the sheet can mark it active. */
export function matchesPreset(
	policy: ApprovalPolicy,
	preset: PolicyPreset,
): boolean {
	return APPROVAL_TIERS.every((tier) => policy[tier] === preset.policy[tier]);
}
