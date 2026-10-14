/**
 * Every input the planner may see is a source: the turn, git, the
 * person's Cline setup, the hub's state, and each connector. Connectors are
 * additive because they implement the same interface.
 */

/**
 * - `present`: read; may be empty, and the planner is told so;
 * - `unknown`: exists here but is unreadable just now; the planner is told to treat it as unknown;
 * - `absent`: not in this environment; the planner is told nothing;
 * - `off`: the person turned it off in settings; treated like absent and never probed.
 */
export const SOURCE_STATES = ["present", "unknown", "absent", "off"] as const;
export type SourceState = (typeof SOURCE_STATES)[number];

/** T0 in the hook · T1 workspace · T2 local Cline · T3 remote. */
export type SourceTier = "T0" | "T1" | "T2" | "T3";

/** What a source can learn about the environment without reading content. */
export type SourceEnv = {
	client?: string;
	/** This chat; history never offers it back to itself. */
	sessionId?: string;
	/** The chat's provider; sources that read the person's other chats follow the planner-provider rule. */
	providerId?: string;
	workspaceRoot?: string;
	cwd?: string;
	git?: { branch?: string; commit?: string; remotes: string[] };
	/** Names of the tools the agent has this turn, from `beforeModel` → `request.tools`. */
	tools: string[];
	mode?: "act" | "plan";
	/** What the turn touched, for sources that search: edited paths and the request. Absent before a chat's first turn. */
	turn?: { editedPaths: string[]; request?: string };
};

/** Where a connector's facts came from, for the why line, the source link and the label log. */
export type Provenance = {
	connector: string;
	/** The Cline connection it went through, such as `gh`, `composio` or `mcp:github`. */
	route: string;
	url?: string;
};

/** A bounded, typed, redacted block a source hands the planner. */
export type Facts = {
	heading: string;
	lines: string[];
	/** For facts read in the background: when they were fetched. */
	fetchedAt?: number;
	provenance?: Provenance;
};

export interface ContextSource {
	readonly id: string;
	readonly tier: SourceTier;
	/** Cheap: is this source here at all? Called once per run, under the tier's budget. */
	probe(env: SourceEnv): Promise<SourceState> | SourceState;
	/** Tags the planner may name, such as `github`, `workflow:/release-notes`, `mcp:sentry`. */
	capabilities?(env: SourceEnv): string[];
	/** The facts, within `budgetMs`; "unknown" when they could not be read in time. */
	facts?(
		env: SourceEnv,
		budgetMs: number,
	): Promise<Facts | "unknown"> | Facts | "unknown";
}
