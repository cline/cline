import { EXCLUDED_LIMIT, REROLL_LIMIT } from "../../config";
import type { CapabilitiesBySource, Manifest } from "../../context/manifest";
import type { SourceEnv } from "../../context/source";
import { type Backlog, EMPTY_BACKLOG } from "../backlog";
import type { Suggestion } from "../candidates";
import type { OfferTrigger } from "../labels/schema";
import { buildModelSet } from "../model/output";
import { pageSet } from "../rules";
import type { OfferedSet, TrayState } from "../tray/tray";
import type { Turn } from "../turn/turn";

/** Everything one turn's sets are computed from. A newer turn replaces it, and late work for the old one is dropped. */
export type TurnState = {
	turn: Turn;
	trigger?: OfferTrigger;
	env: SourceEnv;
	manifest: Manifest;
	/** What each source named when `manifest` was built, so a source turned off later takes its own capabilities with it. */
	capabilitiesBySource: CapabilitiesBySource;
	backlog: Backlog;
	/** Rebuilt after a sandbox respawn, which keeps no backlog: the planner reads it again first. */
	restored?: boolean;
	/** Restored after a sandbox respawn, whose sources and tools may still be loading: its planner calls keep the capabilities the turn saved. */
	respawned?: boolean;
	rules: Suggestion[];
	pool?: readonly Suggestion[];
	/** The manifest the planner saw for `pool`, which tags the model sets served from it. */
	poolManifest?: Manifest;
	excluded: string[];
	excludedIds: Map<string, string>;
	rerollsUsed: number;
	offers: OfferedSet[];
	exposedOffers: Set<string>;
	planning?: boolean;
	pendingIntent?: {
		verb: "use" | "send";
		offer: OfferedSet;
		candidate: Suggestion;
		position: number;
		input?: string;
		msSinceExposed?: number;
		at: number;
	};
	endedAt: number;
};

/** What of a turn's state outlives a sandbox respawn: everything but the live environment and backlog. */
export type TurnSnapshot = Pick<
	TurnState,
	| "turn"
	| "trigger"
	| "rules"
	| "pool"
	| "excluded"
	| "rerollsUsed"
	| "offers"
	| "pendingIntent"
	| "endedAt"
> & {
	/** Missing from state files written before the manifest was persisted. */
	manifest?: Manifest;
	/** Missing from state files written before it was persisted: such a turn, respawned, names only what its sources name now. */
	capabilitiesBySource?: CapabilitiesBySource;
	excludedIds: [string, string][];
	exposedOffers: string[];
};

export function snapshotOf(state: TurnState): TurnSnapshot {
	return {
		turn: state.turn,
		trigger: state.trigger,
		manifest: state.manifest,
		capabilitiesBySource: state.capabilitiesBySource,
		rules: state.rules,
		pool: state.pool,
		excluded: state.excluded,
		excludedIds: [...state.excludedIds],
		rerollsUsed: state.rerollsUsed,
		offers: state.offers,
		exposedOffers: [...state.exposedOffers],
		pendingIntent: state.pendingIntent,
		endedAt: state.endedAt,
	};
}

/** A snapshot back in play; the backlog is read again before the planner asks. */
export function restore(snapshot: TurnSnapshot, env: SourceEnv): TurnState {
	return {
		...snapshot,
		manifest: snapshot.manifest ?? { sources: {}, capabilities: [] },
		capabilitiesBySource: snapshot.capabilitiesBySource ?? {},
		env,
		backlog: EMPTY_BACKLOG,
		restored: true,
		respawned: true,
		excludedIds: new Map(snapshot.excludedIds),
		exposedOffers: new Set(snapshot.exposedOffers),
	};
}

export function rowFields(item: Suggestion, index: number) {
	return {
		candidateId: item.id,
		kind: item.kind,
		rank: index + 1,
		position: index,
	};
}

/** The planner's status on a set the rules answered. */
export type PlannerStatus = NonNullable<OfferedSet["model"]>;

export function pausedOf(model: OfferedSet["model"]): OfferedSet["paused"] {
	return model?.status === "paused" && model.resetsAt !== undefined
		? { resetsAt: model.resetsAt }
		: undefined;
}

export function rowOf(
	set: OfferedSet,
	candidateId: string,
): { item: Suggestion; index: number } | undefined {
	const index = set.candidates.findIndex((item) => item.id === candidateId);
	return index === -1 ? undefined : { item: set.candidates[index], index };
}

export function rerollsLeft(state: TurnState): number {
	return Math.max(0, REROLL_LIMIT - state.rerollsUsed);
}

export function trayState(
	state: TurnState,
	candidates: readonly Suggestion[],
): TrayState {
	if (candidates.length > 0) return "ready";
	return rerollsLeft(state) === 0 ? "exhausted" : "empty";
}

/** The turn's next page: from the model's pool once there is one, else from the rules. */
export function nextPage(state: TurnState): Suggestion[] {
	return state.pool
		? buildModelSet({
				pool: state.pool,
				rules: state.rules,
				turn: state.turn.facts,
				excluded: state.excluded,
			})
		: pageSet(state.rules, state.excluded);
}

export function exclude(state: TurnState, items: readonly Suggestion[]): void {
	for (const item of items) {
		state.excludedIds.set(item.id, item.prompt);
		if (!state.excluded.includes(item.prompt)) state.excluded.push(item.prompt);
	}
	state.excluded.splice(0, Math.max(0, state.excluded.length - EXCLUDED_LIMIT));
}
