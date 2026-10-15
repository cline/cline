import { randomUUID } from "node:crypto";
import type { AgentMessage, AgentRunResult } from "@cline/shared";
import {
	DIRTY_FILES_BUDGET_MS,
	EXCLUDED_LIMIT,
	REROLL_LIMIT,
	RETAINED_OFFERS_LIMIT,
} from "../config";
import {
	buildManifest,
	collectFacts,
	type Manifest,
	manifestTags,
	withCurrentSources,
} from "../context/manifest";
import { sourceOff } from "../context/policy";
import type { ContextSource, SourceEnv } from "../context/source";
import { withinBudget } from "../deadline";
import type { Log } from "../log";
import type { Settings } from "../settings/settings";
import type { SessionStateStore } from "../store/session-state";
import { errorMessage, isRecord } from "../values";
import { type PlannerLedger, pausedUntil } from "./allowance";
import { type Backlog, EMPTY_BACKLOG } from "./backlog";
import { cueCode, fnv1a32, type Suggestion } from "./candidates";
import { buildPlannerInput } from "./input";
import { offerableKinds } from "./kinds";
import {
	editBucket,
	type LabelEvent,
	type LabelFields,
	type LabelLog,
	labelHeader,
	type OfferTrigger,
	offerRecord,
} from "./labels";
import { type Complete, generatePool, PoolCache } from "./model";
import { buildModelSet } from "./output";
import { type GitHubEvidence, pageSet, rulePool } from "./rules";
import type { OfferedSet, TrayAction, TrayPush, TrayState } from "./tray";
import {
	deriveTurn,
	deriveTurnFromTranscript,
	lastPersonMessage,
	type MessageLike,
	type Turn,
} from "./turn";

export type NextOptions = {
	sessionId: string;
	settings: () => Settings;
	/** This chat's environment before the turn: client, workspace, git, the agent's tools, mode. */
	env: () => SourceEnv;
	sources: () => readonly ContextSource[];
	backlog: (manifest: Manifest) => Promise<Backlog>;
	/** Files with uncommitted changes, or undefined when it cannot tell. */
	dirtyFiles?: (cwd: string) => Promise<number | undefined>;
	/** GitHub's failing checks for this branch, when its Read role has them. */
	github?: (env: SourceEnv) => Omit<GitHubEvidence, "pushed"> | undefined;
	/** The planner's model; without one, the rules answer every set. */
	complete?: Complete;
	ledger?: PlannerLedger;
	labels?: LabelLog;
	store?: SessionStateStore;
	viewerClient?: () => string | undefined;
	/** Whether the plugin is still enabled and installed: work that lands after it is disabled pushes and labels nothing. */
	active?: () => boolean;
	/** Reads the session's transcript and status from the hub on demand when no turn is in memory. */
	readTranscript?: () => Promise<
		{ messages: readonly MessageLike[]; status?: string } | undefined
	>;
	log?: Log;
};

/** Everything one turn's sets are computed from. A newer turn replaces it, and late work for the old one is dropped. */
type TurnState = {
	turn: Turn;
	trigger?: OfferTrigger;
	env: SourceEnv;
	manifest: Manifest;
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
	excludedIds: [string, string][];
	exposedOffers: string[];
};

function snapshotOf(state: TurnState): TurnSnapshot {
	return {
		turn: state.turn,
		trigger: state.trigger,
		manifest: state.manifest,
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
function restore(snapshot: TurnSnapshot, env: SourceEnv): TurnState {
	return {
		...snapshot,
		manifest: snapshot.manifest ?? { sources: {}, capabilities: [] },
		env,
		backlog: EMPTY_BACKLOG,
		restored: true,
		respawned: true,
		excludedIds: new Map(snapshot.excludedIds),
		exposedOffers: new Set(snapshot.exposedOffers),
	};
}

/** Session statuses while a run is still going: a set for it would come before its outcome, and its planner call would be wasted. */
const UNFINISHED_SESSION_STATUSES: ReadonlySet<string> = new Set([
	"running",
	"pending",
]);

/** The label verb a refused Send or Use would have recorded. */
const STALE_VERB: Partial<Record<TrayAction["type"], string>> = {
	send: "do",
	use: "adjust",
};

/** JSON with every object's keys sorted, so the same input always hashes the same. */
function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (isRecord(value)) {
		const fields = Object.keys(value)
			.filter((key) => value[key] !== undefined)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`);
		return `{${fields.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

function rowFields(item: Suggestion, index: number) {
	return {
		candidateId: item.id,
		kind: item.kind,
		rank: index + 1,
		position: index,
	};
}

function rowOf(
	set: OfferedSet,
	candidateId: string,
): { item: Suggestion; index: number } | undefined {
	const index = set.candidates.findIndex((item) => item.id === candidateId);
	return index === -1 ? undefined : { item: set.candidates[index], index };
}

/** Next, for one chat: the plugin's run hooks and the tray's `plugin.invoke` drive it. */
export class NextSession {
	private state: TurnState | undefined;
	private lastPush: TrayPush | undefined;
	private lastTurn: Turn | undefined;
	private lastChat: Turn["chat"];
	private hiddenForChat = false;
	/** A message went out and its run has not ended: the last turn is no longer the chat's latest. */
	private runUnderway = false;
	/**
	 * The last turn was read back from the store, so a run this session never
	 * saw start (a dormant chat's viewer, a respawn mid-run) may be going: the
	 * hub is asked before it is served.
	 */
	private lastTurnFromStore = false;
	private seq = 0;
	private generation = 0;
	private pending: Promise<void> = Promise.resolve();
	private serving:
		| { turnKey: string; gen: number; done: Promise<unknown> }
		| undefined;
	private readonly cache = new PoolCache();
	private readonly listeners = new Set<(push: TrayPush) => void>();

	constructor(private readonly options: NextOptions) {
		this.rehydrate();
	}

	/** The set on screen: the turn's latest offer. */
	private get shown(): OfferedSet | undefined {
		return this.state?.offers.at(-1);
	}

	private rehydrate(): void {
		const saved = this.options.store?.read();
		if (!saved) return;
		this.hiddenForChat = saved.hiddenForChat === true;
		this.seq = saved.seq ?? 0;
		this.lastPush = saved.lastPush;
		this.lastTurn = saved.lastTurn;
		this.lastTurnFromStore = saved.lastTurn !== undefined;
		this.lastChat = saved.lastChat;
		try {
			this.state =
				saved.turnState &&
				restore(saved.turnState, this.turnEnv(saved.turnState.turn));
		} catch (error) {
			this.options.log?.("the saved turn did not restore", error);
		}
	}

	private persist(): void {
		this.options.store?.write({
			viewerClient: this.options.viewerClient?.(),
			hiddenForChat: this.hiddenForChat || undefined,
			seq: this.seq,
			lastPush: this.lastPush,
			lastTurn: this.lastTurn,
			lastChat: this.lastChat,
			turnState: this.state && snapshotOf(this.state),
		});
	}

	private turnEnv(turn: Turn): SourceEnv {
		const base = this.options.env();
		return {
			...base,
			sessionId: this.options.sessionId,
			providerId: (turn.chat ?? this.lastChat)?.providerId ?? base.providerId,
			...(turn.mode ? { mode: turn.mode } : {}),
			turn: {
				editedPaths: [...turn.context.editedPaths],
				request: turn.context.request,
			},
		};
	}

	current(): OfferedSet | undefined {
		return this.shown;
	}

	/**
	 * Drops the set and any in-flight serve, then pushes `off` under this
	 * session's own sequence, so the next push after it is newer. A tray that
	 * is already off gets no second push.
	 */
	off(): TrayPush {
		this.generation += 1;
		if (!this.state && this.lastPush?.state === "off") return this.lastPush;
		this.state = undefined;
		return this.pushState("off");
	}

	/** Stops in-flight serves and planner calls from pushing, and detaches every listener. */
	dispose(): void {
		this.generation += 1;
		this.listeners.clear();
	}

	/** The latest sequenced tray state push, or a fresh `off` when nothing has been pushed yet. */
	currentPush(): TrayPush {
		return (
			this.lastPush ?? {
				sessionId: this.options.sessionId,
				seq: this.seq,
				state: "off",
			}
		);
	}

	/** The chat's provider and model as of the last turn that reported one: the planner's default. */
	chat(): Turn["chat"] {
		return this.lastChat;
	}

	/** The most recently derived turn in this session. */
	turn(): Turn | undefined {
		return this.lastTurn;
	}

	/** Each served set once, and undefined when the tray goes off or has no set. */
	onSet(listener: (set: OfferedSet | undefined) => void): () => void {
		let lastOfferId: string | undefined;
		return this.onPush((push) => {
			if (push.state === "computing") return;
			if (push.set && push.set.offerId === lastOfferId) return;
			lastOfferId = push.set?.offerId;
			listener(push.set);
		});
	}

	onPush(listener: (push: TrayPush) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Resolves once the detached work has settled, including work it started meanwhile; for tests and shutdown. */
	async settled(): Promise<void> {
		let pending: Promise<void>;
		do {
			pending = this.pending;
			await pending;
		} while (pending !== this.pending);
	}

	private track(work: Promise<unknown>): void {
		const done = work.then(
			() => undefined,
			() => undefined,
		);
		this.pending = this.pending.then(() => done);
	}

	private isOn(settings: Settings): boolean {
		return settings.features.next && !this.hiddenForChat;
	}

	/** Whether work started under `gen` (and for `state`) still owns the tray. */
	private isCurrent(gen: number, state?: TurnState): boolean {
		return (
			gen === this.generation &&
			(!state || this.state === state) &&
			(this.options.active?.() ?? true)
		);
	}

	private pushState(
		state: TrayState,
		extra: Omit<TrayPush, "sessionId" | "seq" | "state"> = {},
	): TrayPush {
		this.seq += 1;
		const push: TrayPush = {
			sessionId: this.options.sessionId,
			seq: this.seq,
			state,
			...extra,
		};
		this.lastPush = push;
		this.persist();
		for (const listener of this.listeners) {
			try {
				listener(push);
			} catch (error) {
				this.options.log?.("a push listener failed", error);
			}
		}
		return push;
	}

	private label(raw: Record<string, unknown>): void {
		try {
			this.options.labels?.append(raw);
		} catch (error) {
			this.options.log?.("a label was refused", error);
		}
	}

	/** A label about the set, or about the bare chat when no set is on screen. */
	private labelFor(
		set: OfferedSet | undefined,
		event: LabelEvent,
		fields: LabelFields = {},
	): void {
		this.label({
			...labelHeader(
				event,
				new Date(),
				set ?? { sessionId: this.options.sessionId },
			),
			...fields,
		});
	}

	private async readDirty(env: SourceEnv): Promise<number | undefined> {
		const cwd = env.workspaceRoot;
		const read = this.options.dirtyFiles;
		if (!cwd || !read || !env.git) return undefined;
		return withinBudget(() => read(cwd), DIRTY_FILES_BUDGET_MS, undefined);
	}

	/** The planner's status for a new set: none without a model, paused while the allowance is used, else pending. */
	private plannerModel(settings: Settings): OfferedSet["model"] {
		const { complete, ledger, sessionId } = this.options;
		if (!complete) return undefined;
		const resetsAt = ledger
			? pausedUntil(
					ledger.callsForSession(sessionId),
					settings.planner.callsPerHour,
					Date.now(),
				)
			: undefined;
		return resetsAt === undefined
			? { status: "pending" }
			: { status: "paused", resetsAt };
	}

	private rerollsLeft(state: TurnState): number {
		return Math.max(0, REROLL_LIMIT - state.rerollsUsed);
	}

	private trayState(
		state: TurnState,
		candidates: readonly Suggestion[],
	): TrayState {
		if (candidates.length > 0) return "ready";
		return this.rerollsLeft(state) === 0 ? "exhausted" : "empty";
	}

	/** Serves one set: a new offer, its record, and the push. */
	private serve(
		state: TurnState,
		model?: OfferedSet["model"],
		candidates: readonly Suggestion[] = this.nextPage(state),
	): OfferedSet {
		const { turn } = state;
		const planner = state.pool ? "model" : "rules";
		const previous = this.shown;
		if (
			previous &&
			planner === "model" &&
			previous.planner === "rules" &&
			previous.turnKey === turn.turnKey
		) {
			this.labelFor(previous, "superseded", {
				cause: "model",
				exposedFirst: state.exposedOffers.has(previous.offerId),
			});
		}
		const rerollsLeft = this.rerollsLeft(state);
		const paused =
			model?.status === "paused" && model.resetsAt !== undefined
				? { resetsAt: model.resetsAt }
				: undefined;
		const set: OfferedSet = {
			sessionId: this.options.sessionId,
			offerId: `offer_${randomUUID()}`,
			setId: fnv1a32(
				`${turn.revision}|${candidates.map((item) => item.id).join(",")}`,
			),
			turnKey: turn.turnKey,
			runCount: turn.runCount,
			...(turn.runId ? { runId: turn.runId } : {}),
			...(state.trigger ? { trigger: state.trigger } : {}),
			cueCode: cueCode(turn.facts),
			candidates,
			excluded: [...state.excluded],
			planner,
			revision: turn.revision,
			rerollsLeft,
			...(paused ? { paused } : {}),
			...(model ? { model } : {}),
		};
		const now = Date.now();
		this.label(
			offerRecord(set, {
				turn: turn.facts,
				latencyMs: now - state.endedAt,
				tags: manifestTags(
					planner === "model"
						? (state.poolManifest ?? state.manifest)
						: state.manifest,
				),
				at: new Date(now),
			}),
		);
		state.offers.push(set);
		if (state.offers.length > RETAINED_OFFERS_LIMIT)
			state.offers.splice(0, state.offers.length - RETAINED_OFFERS_LIMIT);
		this.pushState(this.trayState(state, candidates), {
			turnKey: turn.turnKey,
			rerollsLeft,
			set,
		});
		return set;
	}

	/**
	 * A completed root run. Resolves with the rule-based set once it is served,
	 * or with nothing when Next is off, the run left no turn, or the serve is
	 * dropped or fails; the planner call stays detached.
	 */
	async afterRun(result: AgentRunResult): Promise<OfferedSet | undefined> {
		this.runUnderway = false;
		const settings = this.options.settings();
		if (!this.isOn(settings)) {
			this.off();
			return undefined;
		}
		const turn = deriveTurn(this.options.sessionId, result);
		if (!turn) return undefined;
		return this.startTurn(turn, settings, "after_run");
	}

	/**
	 * Pushes `computing` for the turn and serves it behind a new generation,
	 * so a newer turn, a message or `off` drops what this one would serve.
	 * A serve that fails leaves the tray `unavailable`, never `computing`.
	 */
	private startTurn(
		turn: Turn,
		settings: Settings,
		trigger: OfferTrigger,
	): Promise<OfferedSet | undefined> {
		this.lastTurn = turn;
		this.lastTurnFromStore = false;
		if (turn.chat) this.lastChat = turn.chat;
		const endedAt = Date.now();
		this.generation += 1;
		const gen = this.generation;
		this.pushState("computing", {
			turnKey: turn.turnKey,
			rerollsLeft: REROLL_LIMIT,
		});
		const served = this.serveTurn(turn, endedAt, gen, settings, trigger).catch(
			(error: unknown) => {
				this.options.log?.("serving the turn failed", error);
				if (this.isCurrent(gen)) {
					this.state = undefined;
					this.pushState("unavailable", {
						turnKey: turn.turnKey,
						error: errorMessage(error),
					});
				}
				return undefined;
			},
		);
		this.serving = { turnKey: turn.turnKey, gen, done: served };
		this.track(served);
		return served;
	}

	/**
	 * `current` from a viewer: the set for `runCount`, served on demand when
	 * the chat has none (a forked chat after Undo, a reopened session) from the
	 * last turn or the transcript `readTranscript` returns, whichever is newer.
	 * A last turn from the store is served only once the hub says no run is
	 * going.
	 */
	async ensureCurrent(runCount?: number): Promise<TrayPush> {
		const settings = this.options.settings();
		if (!this.isOn(settings)) return this.off();
		const wanted = (candidate: { runCount: number } | undefined) =>
			candidate !== undefined &&
			(runCount === undefined || candidate.runCount === runCount);
		if (wanted(this.shown) || this.runUnderway) return this.currentPush();
		let turn = wanted(this.lastTurn) ? this.lastTurn : undefined;
		const inFlight = this.serving;
		if (
			turn &&
			inFlight?.gen === this.generation &&
			inFlight.turnKey === turn.turnKey
		) {
			await inFlight.done;
			return this.currentPush();
		}
		if ((!turn || this.lastTurnFromStore) && this.options.readTranscript) {
			const gen = this.generation;
			const loaded = await this.options.readTranscript().catch(() => undefined);
			if (
				!this.isCurrent(gen) ||
				!this.isOn(this.options.settings()) ||
				UNFINISHED_SESSION_STATUSES.has(loaded?.status ?? "")
			)
				return this.currentPush();
			const derived =
				loaded &&
				deriveTurnFromTranscript(
					this.options.sessionId,
					loaded.messages,
					loaded.status,
				);
			if (
				derived &&
				wanted(derived) &&
				(!turn || derived.runCount > turn.runCount)
			)
				turn = derived;
		}
		if (!turn) return this.currentPush();
		await this.startTurn(turn, settings, "on_demand");
		return this.currentPush();
	}

	private async serveTurn(
		turn: Turn,
		endedAt: number,
		gen: number,
		settings: Settings,
		trigger: OfferTrigger,
	): Promise<OfferedSet | undefined> {
		const probeEnv = this.turnEnv(turn);
		const [manifest, dirtyFiles] = await Promise.all([
			buildManifest(this.options.sources(), probeEnv, {
				isOff: sourceOff(settings, probeEnv),
			}),
			this.readDirty(probeEnv),
		]);
		if (!this.isCurrent(gen)) return undefined;
		// The git read can move the branch, so the PR and the facts follow the branch the turn ended on.
		const env = this.turnEnv(turn);
		const backlog = await this.options.backlog(manifest);
		if (!this.isCurrent(gen)) return undefined;
		const github = { pushed: turn.pushed, ...this.options.github?.(env) };
		const state: TurnState = {
			turn,
			trigger,
			env,
			manifest,
			backlog,
			rules: rulePool({
				backlog,
				turn: turn.facts,
				manifest,
				dirtyFiles,
				github,
			}),
			excluded: [],
			excludedIds: new Map(),
			rerollsUsed: 0,
			offers: [],
			exposedOffers: new Set(),
			endedAt,
		};
		this.state = state;
		const model = this.plannerModel(settings);
		const set = this.serve(state, model);
		if (model?.status === "pending") this.startPlanner(state, gen);
		return set;
	}

	private startPlanner(state: TurnState, gen: number): void {
		this.track(
			this.planModel(state, gen).catch((error: unknown) =>
				this.options.log?.("the planner failed", error),
			),
		);
	}

	/**
	 * The detached half: facts, one model call (or a cached pool), and the model
	 * set if this turn is still current. A pool is cached by the chat position
	 * and the person's message, so a run resumed on the same message reuses it
	 * and a new message at a position the chat returned to asks again.
	 */
	private async planModel(state: TurnState, gen: number): Promise<void> {
		state.planning = true;
		try {
			await this.requestModelSet(state, gen);
		} finally {
			state.planning = false;
		}
	}

	private async requestModelSet(state: TurnState, gen: number): Promise<void> {
		const complete = this.options.complete;
		if (!complete || !this.isCurrent(gen, state)) return;
		if (state.restored) {
			state.backlog = await this.options.backlog(state.manifest);
			state.restored = false;
			if (!this.isCurrent(gen, state)) return;
		}
		const settings = this.options.settings();
		const sources = this.options.sources();
		const current = withCurrentSources(
			state.manifest,
			sources,
			state.env,
			sourceOff(settings, state.env),
		);
		const manifest = state.respawned
			? { ...current, capabilities: state.manifest.capabilities }
			: current;
		const facts = await collectFacts(sources, manifest, state.env);
		if (!this.isCurrent(gen, state)) return;
		const kinds = offerableKinds(manifest);
		const key = `${state.turn.revision}:${state.turn.userMessageId}:${fnv1a32(stableJson({ backlog: state.backlog, facts, manifest }))}`;
		let pool = this.cache
			.get(key)
			?.filter((item) => !state.excluded.includes(item.prompt));
		if (!pool || pool.length === 0) {
			const input = buildPlannerInput({
				turn: state.turn.facts,
				context: state.turn.context,
				backlog: state.backlog,
				manifest,
				facts,
				names: Object.fromEntries(
					sources.map((source) => [source.id, source.displayName ?? source.id]),
				),
				kinds,
				excluded: state.excluded,
			});
			const slot = this.options.ledger?.reserve(this.options.sessionId);
			const attempt = await generatePool(complete, input, kinds, settings);
			const chat = state.turn.chat ?? this.lastChat;
			if ("reason" in attempt && attempt.reason === "no_provider")
				slot?.release();
			else
				slot?.record({
					costUsd: attempt.costUsd,
					providerId: attempt.providerId ?? chat?.providerId,
					modelId: attempt.modelId ?? chat?.modelId,
				});
			if (!this.isCurrent(gen, state)) return;
			if ("reason" in attempt) {
				this.options.log?.(
					`model suggestions unavailable (${attempt.reason}); the rule-based set stays`,
					attempt.error,
				);
				this.reportPlannerFailure(
					state,
					attempt.reason === "no_provider" ? "no_provider" : "error",
				);
				return;
			}
			pool = attempt.pool;
			this.cache.set(key, pool);
		}
		state.pool = pool;
		state.poolManifest = manifest;
		this.serve(state);
	}

	/** The rule-based set stays on screen; only its model status changes. */
	private reportPlannerFailure(
		state: TurnState,
		status: "no_provider" | "error",
	): void {
		const shown = this.shown;
		if (shown?.turnKey !== state.turn.turnKey) return;
		const { paused: _paused, ...rest } = shown;
		const updated: OfferedSet = { ...rest, model: { status } };
		const index = state.offers.findIndex(
			(offer) => offer.offerId === updated.offerId,
		);
		if (index !== -1) state.offers[index] = updated;
		this.pushState(this.trayState(state, updated.candidates), {
			turnKey: state.turn.turnKey,
			rerollsLeft: this.rerollsLeft(state),
			set: updated,
		});
	}

	/**
	 * A model request is about to go out. When it carries a new message from the
	 * person, that message is labelled against the set on screen (or the explicit
	 * Use/Send intent) and the set is superseded. Later requests in the same run,
	 * and a run on the same message (a resume), find nothing new and label nothing.
	 */
	outgoing(messages: readonly AgentMessage[]): void {
		const message = lastPersonMessage(messages);
		if (!message || message.id === this.lastTurn?.userMessageId) return;
		this.runUnderway = true;
		this.generation += 1;
		const set = this.shown;
		const state = this.state;
		if (set && state) {
			this.labelMessage(set, state, message.text);
			this.labelFor(set, "superseded", { cause: "message" });
		}
		if (set || this.lastPush?.state === "computing") this.off();
	}

	private labelMessage(set: OfferedSet, state: TurnState, text: string): void {
		const intent = state.pendingIntent;
		if (intent?.verb === "send" && intent.candidate.prompt === text) {
			this.labelFor(intent.offer, "do", {
				...rowFields(intent.candidate, intent.position),
				input: intent.input,
				msSinceExposed: intent.msSinceExposed,
			});
			return;
		}
		if (intent?.verb === "use") {
			const bucket = editBucket(intent.candidate.prompt, text);
			if (bucket !== "large") {
				this.labelFor(intent.offer, "adjust_sent", {
					...rowFields(intent.candidate, intent.position),
					bucket,
					chars: text.length,
					msToSend: Math.max(0, Date.now() - intent.at),
					input: intent.input,
				});
				return;
			}
			this.labelFor(intent.offer, "adjust_abandoned", {
				candidateId: intent.candidate.id,
				cause: "different_message",
			});
			this.labelTypedInstead(set, state, text);
			return;
		}
		const buckets = set.candidates.map((item) => editBucket(item.prompt, text));
		const exact = buckets.indexOf("same");
		if (exact !== -1) {
			this.labelFor(set, "do", {
				...rowFields(set.candidates[exact], exact),
				input: "message",
			});
			return;
		}
		const close = buckets.indexOf("small");
		if (close !== -1) {
			this.labelFor(set, "adjust", {
				...rowFields(set.candidates[close], close),
				bucket: "small",
				input: "message",
			});
			return;
		}
		this.labelTypedInstead(set, state, text);
	}

	/** Typed instead counts only when the person saw the set. */
	private labelTypedInstead(
		set: OfferedSet,
		state: TurnState,
		text: string,
	): void {
		if (text && state.exposedOffers.size > 0)
			this.labelFor(set, "typed_instead", { typedText: text });
	}

	/** The offer an action names, or the set on screen when it names none. */
	private resolveOffer(offerId: string | undefined): OfferedSet | undefined {
		if (!offerId) return this.shown;
		return this.state?.offers.findLast((offer) => offer.offerId === offerId);
	}

	/**
	 * A tray action, answered with the push the tray should show next. Skip,
	 * Unskip and Reroll serve a new set from the same turn; Use, Send, Exposed,
	 * Hide and Label update state and labels.
	 */
	invoke(action: Exclude<TrayAction, { type: "current" }>): TrayPush {
		if (action.type === "label") {
			this.label({
				...action.fields,
				...labelHeader(
					action.event,
					new Date(),
					this.resolveOffer(action.offerId) ?? {
						sessionId: this.options.sessionId,
						offerId: action.offerId,
						turnKey: this.lastTurn?.turnKey,
						runCount: this.lastTurn?.runCount,
					},
				),
			});
			return this.currentPush();
		}
		if (action.type === "hide") {
			this.labelFor(this.shown, "hidden_by_user", { scope: action.scope });
			if (action.scope === "chat") {
				this.hiddenForChat = true;
				this.persist();
			}
			return this.off();
		}
		const state = this.state;
		const current = this.shown;
		if (!state || !current) return this.currentPush();
		const computing = this.lastPush?.state === "computing";
		const target = computing ? undefined : this.resolveOffer(action.offerId);
		if (!target) {
			this.labelFor(current, "refused_stale", {
				reason: computing ? "computing" : "set_changed",
				verb: STALE_VERB[action.type],
			});
			return this.currentPush();
		}
		this.apply(state, current, target, action);
		return this.currentPush();
	}

	private apply(
		state: TurnState,
		current: OfferedSet,
		target: OfferedSet,
		action: Exclude<TrayAction, { type: "current" | "label" | "hide" }>,
	): void {
		switch (action.type) {
			case "exposed":
				state.exposedOffers.add(target.offerId);
				this.labelFor(target, "exposed", { candidateId: action.candidateId });
				this.persist();
				return;
			case "use":
			case "send": {
				const row = rowOf(target, action.candidateId);
				if (!row) return;
				if (action.type === "use")
					this.labelFor(target, "adjust", {
						...rowFields(row.item, row.index),
						input: action.input,
						msSinceExposed: action.msSinceExposed,
					});
				state.pendingIntent = {
					verb: action.type,
					offer: target,
					candidate: row.item,
					position: row.index,
					input: action.input,
					msSinceExposed: action.msSinceExposed,
					at: Date.now(),
				};
				this.persist();
				return;
			}
			case "unskip": {
				const prompt = state.excludedIds.get(action.candidateId);
				if (!prompt) return;
				state.excludedIds.delete(action.candidateId);
				const index = state.excluded.indexOf(prompt);
				if (index !== -1) state.excluded.splice(index, 1);
				this.labelFor(target, "undo_skip", {
					candidateId: action.candidateId,
					input: action.input,
				});
				this.serve(state, current.model);
				return;
			}
			case "skip": {
				const row = rowOf(target, action.candidateId);
				if (!row) return;
				this.labelFor(target, "skip", {
					...rowFields(row.item, row.index),
					input: action.input,
					msSinceExposed: action.msSinceExposed,
				});
				this.exclude(state, [row.item]);
				this.serve(state, current.model);
				return;
			}
			case "reroll":
				this.reroll(state, current, target, action);
		}
	}

	private reroll(
		state: TurnState,
		current: OfferedSet,
		target: OfferedSet,
		action: Extract<TrayAction, { type: "reroll" }>,
	): void {
		if (state.rerollsUsed >= REROLL_LIMIT) {
			this.serve(state, current.model, []);
			return;
		}
		state.rerollsUsed += 1;
		const excludedIds = target.candidates.map((item) => item.id);
		this.labelFor(target, "reroll", {
			rerollIndex: state.rerollsUsed,
			excluded: excludedIds.length > 0 ? excludedIds : undefined,
			input: action.input,
			cause: action.cause,
		});
		this.exclude(state, target.candidates);
		const poolLeft = state.pool?.some(
			(item) => !state.excluded.includes(item.prompt),
		);
		if (
			!poolLeft &&
			!state.planning &&
			this.plannerModel(this.options.settings())?.status === "pending"
		)
			this.startPlanner(state, this.generation);
		this.serve(state, current.model);
	}

	/** The turn's next page: from the model's pool once there is one, else from the rules. */
	private nextPage(state: TurnState): Suggestion[] {
		return state.pool
			? buildModelSet({
					pool: state.pool,
					rules: state.rules,
					turn: state.turn.facts,
					excluded: state.excluded,
				})
			: pageSet(state.rules, state.excluded);
	}

	private exclude(state: TurnState, items: readonly Suggestion[]): void {
		for (const item of items) {
			state.excludedIds.set(item.id, item.prompt);
			if (!state.excluded.includes(item.prompt))
				state.excluded.push(item.prompt);
		}
		state.excluded.splice(
			0,
			Math.max(0, state.excluded.length - EXCLUDED_LIMIT),
		);
	}
}
