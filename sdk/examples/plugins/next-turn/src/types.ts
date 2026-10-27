export const NEXT_TURN_KINDS = [
	"fix_failure",
	"continue",
	"next_step",
	"verify",
	"review_diff",
	"wrap_up",
	"commit",
] as const;
export type NextTurnKind = (typeof NEXT_TURN_KINDS)[number];

export const NEXT_TURN_LABELS: Readonly<Record<NextTurnKind, string>> = {
	fix_failure: "Fix",
	continue: "Resume",
	next_step: "Next step",
	verify: "Verify",
	review_diff: "Review",
	wrap_up: "Wrap up",
	commit: "Commit",
};

export type NextTurnStatus = "completed" | "cancelled" | "failed";

export interface NextTurnSuggestion {
	kind: NextTurnKind;
	label: string;
	prompt: string;
	reason: string;
}

/** `rules` is the immediate set; `model` replaces it for the same run. */
export type NextTurnSource = "rules" | "model";

export interface NextTurnSuggestionsEvent {
	runId: string;
	status: NextTurnStatus;
	source: NextTurnSource;
	suggestions: NextTurnSuggestion[];
}

/** What the turn did, from the run result alone. */
export type TurnFacts = {
	status: NextTurnStatus;
	filesEdited: number;
	toolErrored: boolean;
};

export type ToolFact = { name: string; failed: boolean; error?: string };

/** What the planner reads of the turn: redacted and bounded, because a transcript is a trust boundary. */
export type TurnContext = {
	request: string;
	reply: string;
	tools: readonly ToolFact[];
	editedPaths: readonly string[];
};

/** The provider and model the chat answered with. */
export type ProviderChoice = { providerId: string; modelId: string };

/** A headed block of bounded, redacted lines the planner reads. */
export type Facts = { heading: string; lines: string[] };

/** A source that exists here but could not be read in time: the planner is told it is unknown, not empty. */
export type FactsRead = Facts | "unknown" | undefined;

export type PlannerInput = { system: string; user: string };
