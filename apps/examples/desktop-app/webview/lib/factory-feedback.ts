import type { FactoryFeedbackAnalysis, FactoryRunState } from "@cline/shared";
import { factoryFeedbackAnalysisStatus } from "@cline/shared/browser";
import { FACTORY_FEEDBACK, FACTORY_GUIDANCE } from "./factory-copy";

type Audit = FactoryRunState["audit"];

/**
 * A card's rule proposed from feedback the person chose to give, waiting for
 * their Save or Discard; undefined otherwise. Reads the board's attention
 * outcome (or a run's state), so the home can count and open these.
 */
export function factoryProposedRule(item: {
	taskId: string;
	outcome?: { audit?: Audit };
}): { taskId: string; summary: string } | undefined {
	const audit = item.outcome?.audit;
	const analysis = audit?.analysis;
	if (!audit?.finding || !analysis?.proposal) return undefined;
	if (factoryFeedbackAnalysisStatus(analysis) !== "proposed") return undefined;
	return {
		taskId: item.taskId,
		summary: analysis.summary ?? analysis.proposal.summary,
	};
}

/** What the feedback row shows for a note; a stale `running` reads `failed`. */
export type FactoryFeedbackRowState =
	| { kind: "note" }
	| { kind: "running" }
	| {
			kind: "proposed";
			summary?: string;
			target: string;
			evidence: string[];
			proposal: NonNullable<FactoryFeedbackAnalysis["proposal"]>;
	  }
	| { kind: "no_rule"; summary?: string }
	| { kind: "failed"; message: string }
	| { kind: "saved"; summary?: string }
	| { kind: "discarded" };

export function factoryFeedbackTarget(
	proposal: Pick<
		NonNullable<FactoryFeedbackAnalysis["proposal"]>,
		"role" | "scope"
	>,
): string {
	const label =
		proposal.role === "factory"
			? FACTORY_FEEDBACK.routing
			: FACTORY_GUIDANCE.roleLabel[proposal.role];
	return FACTORY_FEEDBACK.target(label, proposal.scope);
}

export function factoryFeedbackRowState(
	analysis: FactoryFeedbackAnalysis | undefined,
	now = Date.now(),
): FactoryFeedbackRowState {
	if (!analysis) return { kind: "note" };
	const status = factoryFeedbackAnalysisStatus(analysis, now);
	switch (status) {
		case "running":
			return { kind: "running" };
		case "proposed":
			return analysis.proposal
				? {
						kind: "proposed",
						summary: analysis.summary,
						target: factoryFeedbackTarget(analysis.proposal),
						evidence: analysis.evidence ?? [],
						proposal: analysis.proposal,
					}
				: { kind: "failed", message: FACTORY_FEEDBACK.failed };
		case "no_rule":
			return { kind: "no_rule", summary: analysis.summary };
		case "saved":
			return { kind: "saved", summary: analysis.summary };
		case "discarded":
			return { kind: "discarded" };
		default:
			return {
				kind: "failed",
				message:
					analysis.status === "running"
						? FACTORY_FEEDBACK.stopped
						: (analysis.error ?? FACTORY_FEEDBACK.failed),
			};
	}
}

/** Asks the app to open Ask Factory about a card with a draft in its composer. */
export type FactoryDiscussRequest = {
	taskId: string;
	shortId?: string;
	draft: string;
};

const FACTORY_DISCUSS_EVENT = "cline:factory-discuss";

/**
 * The composer text after Discuss hands it a draft: the draft below what the
 * person already typed, never in place of it.
 */
export function withFactoryDiscussionDraft(
	current: string,
	draft: string,
): string {
	if (!current.trim()) return draft;
	if (current.includes(draft)) return current;
	return `${current.trimEnd()}\n\n${draft}`;
}

export function requestFactoryDiscussion(request: FactoryDiscussRequest): void {
	window.dispatchEvent(
		new CustomEvent<FactoryDiscussRequest>(FACTORY_DISCUSS_EVENT, {
			detail: request,
		}),
	);
}

export function subscribeFactoryDiscussion(
	handler: (request: FactoryDiscussRequest) => void,
): () => void {
	const listener = (event: Event) => {
		const detail = (event as CustomEvent<FactoryDiscussRequest>).detail;
		if (detail && typeof detail.taskId === "string") handler(detail);
	};
	window.addEventListener(FACTORY_DISCUSS_EVENT, listener);
	return () => window.removeEventListener(FACTORY_DISCUSS_EVENT, listener);
}
