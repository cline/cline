import { randomUUID } from "node:crypto";
import type { AgentMessage, AgentRunResult } from "@cline/shared";
import {
	DIRTY_FILES_BUDGET_MS,
	EXCLUDED_LIMIT,
	LABEL_SCHEMA_VERSION,
	REROLL_LIMIT,
	RETAINED_OFFERS_LIMIT,
	TYPED_TEXT_LIMIT,
} from "../config";
import {
	buildManifest,
	collectFacts,
	type Manifest,
	type ManifestOptions,
	manifestTags,
	withinBudget,
} from "../context/manifest";
import { sourceOff } from "../context/policy";
import type { ContextSource, SourceEnv } from "../context/source";
import {
	type ModelStatus,
	TRAY_PASSTHROUGH_LABEL_EVENTS,
	type TrayPassthroughLabelEvent,
	type TrayState,
} from "../contracts";
import {
	type AllowanceState,
	allowance,
	type PlannerLedger,
} from "../engine/allowance";
import { isRecord } from "../hub/fold";
import type { Settings } from "../settings/settings";
import type { SessionStateStore } from "../store/session-state";
import type { Backlog } from "./backlog";
import { cueCode, fnv1a32, type Suggestion, stableJson } from "./candidates";
import { buildPlannerInput } from "./input";
import { offerableKinds } from "./kinds";
import {
	editBucket,
	isToken,
	type LabelLog,
	type Offer,
	type OfferTrigger,
	offerRecord,
} from "./labels";
import { type Complete, generatePool, PoolCache } from "./model";
import { buildModelSet } from "./output";
import { type GitHubEvidence, pageSet, rulePool } from "./rules";
import {
	deriveTurn,
	deriveTurnFromTranscript,
	lastPersonMessage,
	type MessageLike,
	type Turn,
} from "./turn";

/**
 * Next, for one chat. The plugin's run hooks drive it:
 *
 * 1. **`afterRun`**, on a completed root run: derive the turn synchronously,
 *    push `computing`, and defer the manifest, backlog, rule-based set and
 *    model planner work with `setImmediate` so the hook stays O(ms).
 * 2. **The person's next message**, as the first `beforeModel` of the next run
 *    carries it (`beforeRun`'s snapshot predates it): label it against the set
 *    on screen (`do`, `adjust_sent` / `adjust_abandoned`, or `typed_instead`)
 *    and supersede the set.
 * 3. **Tray actions** (`current`, `skip`, `unskip`, `use`, `send`, `reroll`,
 *    `exposed`, `hide`, `label`) arrive through `invoke`, the UI slot's
 *    `plugin.invoke`.
 *
 * Each served set mints its own `offerId` (ADR-0021). The last two offers for
 * the current turn (rules and model) are kept so actions against a rules row
 * after the model swap still resolve against the rules offer.
 */

export type OfferedSet = Offer & {
	revision: string;
	rerollsLeft?: number;
	/** Set when the chat has used its planner allowance: the rules keep answering. */
	paused?: { resetsAt: number };
	model?: { status: ModelStatus; resetsAt?: number };
};

export type TrayPush = {
	sessionId: string;
	seq: number;
	state: TrayState;
	turnKey?: string;
	rerollsLeft?: number;
	set?: OfferedSet;
	error?: string;
};

export type TrayAction =
	| { type: "current"; client?: string; runCount?: number }
	| {
			type: "skip";
			candidateId: string;
			offerId?: string;
			input?: string;
			msSinceExposed?: number;
	  }
	| { type: "unskip"; candidateId: string; offerId?: string; input?: string }
	| {
			type: "use";
			candidateId: string;
			offerId?: string;
			input?: string;
			msSinceExposed?: number;
	  }
	| {
			type: "send";
			candidateId: string;
			offerId?: string;
			input?: string;
			msSinceExposed?: number;
	  }
	| { type: "reroll"; offerId?: string; input?: string; cause?: string }
	| { type: "exposed"; offerId?: string; candidateId?: string }
	| { type: "hide"; scope?: "chat" }
	| {
			type: "label";
			event: TrayPassthroughLabelEvent;
			offerId?: string;
			fields?: Record<string, unknown>;
	  };

const PASSTHROUGH_EVENTS: ReadonlySet<string> = new Set(
	TRAY_PASSTHROUGH_LABEL_EVENTS,
);

/** Validates an incoming `plugin.invoke` payload against `NextTurnTrayAction`. */
export function parseTrayAction(raw: unknown): TrayAction | null {
	if (!isRecord(raw) || typeof raw.type !== "string") return null;
	const offerId =
		typeof raw.offerId === "string" && raw.offerId ? raw.offerId : undefined;
	const input = isToken(raw.input) ? raw.input : undefined;
	const msSinceExposed =
		typeof raw.msSinceExposed === "number" &&
		Number.isFinite(raw.msSinceExposed)
			? raw.msSinceExposed
			: undefined;
	switch (raw.type) {
		case "current": {
			const client =
				typeof raw.client === "string" && raw.client ? raw.client : undefined;
			const runCount =
				typeof raw.runCount === "number" &&
				Number.isInteger(raw.runCount) &&
				raw.runCount >= 0
					? raw.runCount
					: undefined;
			return {
				type: "current",
				...(client ? { client } : {}),
				...(runCount !== undefined ? { runCount } : {}),
			};
		}
		case "skip":
		case "unskip":
		case "use":
		case "send": {
			if (typeof raw.candidateId !== "string" || !raw.candidateId) return null;
			return {
				type: raw.type,
				candidateId: raw.candidateId,
				...(offerId ? { offerId } : {}),
				...(input ? { input } : {}),
				...(msSinceExposed !== undefined && raw.type !== "unskip"
					? { msSinceExposed }
					: {}),
			};
		}
		case "reroll": {
			const cause = isToken(raw.cause) ? raw.cause : undefined;
			return {
				type: "reroll",
				...(offerId ? { offerId } : {}),
				...(input ? { input } : {}),
				...(cause ? { cause } : {}),
			};
		}
		case "exposed": {
			const candidateId =
				typeof raw.candidateId === "string" && raw.candidateId
					? raw.candidateId
					: undefined;
			return {
				type: "exposed",
				...(offerId ? { offerId } : {}),
				...(candidateId ? { candidateId } : {}),
			};
		}
		case "hide": {
			if (raw.scope !== undefined && raw.scope !== "chat") return null;
			return {
				type: "hide",
				...(raw.scope === "chat" ? { scope: "chat" } : {}),
			};
		}
		case "label": {
			if (typeof raw.event !== "string" || !PASSTHROUGH_EVENTS.has(raw.event))
				return null;
			if (raw.fields !== undefined && !isRecord(raw.fields)) return null;
			return {
				type: "label",
				event: raw.event as TrayPassthroughLabelEvent,
				...(offerId ? { offerId } : {}),
				...(raw.fields ? { fields: raw.fields } : {}),
			};
		}
		default:
			return null;
	}
}

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
	/** Reads the session's transcript and status from the hub on demand when no turn is in memory. */
	readTranscript?: () => Promise<
		{ messages: readonly MessageLike[]; status?: string } | undefined
	>;
	now?: () => number;
	log?: (message: string, error?: unknown) => void;
	/** Overrides for tests: probe and facts budgets, the dirty-count budget, the model deadline. */
	budgets?: {
		probe?: ManifestOptions["budgetMs"];
		facts?: ManifestOptions["budgetMs"];
		dirtyMs?: number;
		modelMs?: number;
	};
};

/** Everything one turn's sets are computed from. A newer turn replaces it, and late work for the old one is dropped. */
type TurnState = {
	turn: Turn;
	trigger?: OfferTrigger;
	env: SourceEnv;
	manifest: Manifest;
	backlog: Backlog;
	dirtyFiles?: number;
	rules: Suggestion[];
	pool?: readonly Suggestion[];
	excluded: string[];
	excludedIds: Map<string, string>;
	rerollsUsed: number;
	offers: OfferedSet[];
	exposedOffers: Set<string>;
	pendingIntent?: {
		verb: "use" | "send";
		offer: OfferedSet;
		candidate: Suggestion;
		rank: number;
		position: number;
		input?: string;
		msSinceExposed?: number;
		at: number;
	};
	endedAt: number;
};

export class NextSession {
	private state: TurnState | undefined;
	private shown: OfferedSet | undefined;
	private lastPush: TrayPush | undefined;
	private lastTurn: Turn | undefined;
	private lastChat: Turn["chat"];
	private hiddenForChat = false;
	private seq = 0;
	private generation = 0;
	private pending: Promise<void> = Promise.resolve();
	private readonly cache = new PoolCache();
	private readonly listeners = new Set<(set: OfferedSet | undefined) => void>();
	private readonly pushListeners = new Set<(push: TrayPush) => void>();

	constructor(
		private readonly options: NextOptions,
		initialTurn?: Turn,
	) {
		this.rehydrate();
		if (!this.lastTurn && initialTurn) {
			this.lastTurn = initialTurn;
			if (initialTurn.chat) this.lastChat = initialTurn.chat;
		}
	}

	private rehydrate(): void {
		const saved = this.options.store?.read();
		if (!saved) return;
		this.hiddenForChat = saved.hiddenForChat === true;
		this.seq = saved.seq ?? 0;
		this.lastPush = saved.lastPush;
		this.lastTurn = saved.lastTurn;
		this.lastChat = saved.lastChat;
		this.shown = saved.shown;
		if (saved.turnState) {
			const ts = saved.turnState;
			const base = this.options.env();
			this.state = {
				turn: ts.turn,
				env: {
					...base,
					sessionId: this.options.sessionId,
					providerId:
						(ts.turn.chat ?? saved.lastChat)?.providerId ?? base.providerId,
					turn: {
						editedPaths: [...ts.turn.context.editedPaths],
						request: ts.turn.context.request,
					},
				},
				manifest: { sources: {}, capabilities: [] },
				backlog: {
					statusRows: [],
					otherStatusRows: [],
					tasks: [],
					bank: null,
					plan: [],
				},
				rules: [...ts.rules],
				...(ts.pool ? { pool: [...ts.pool] } : {}),
				excluded: [...ts.excluded],
				excludedIds: new Map(ts.excludedIds),
				rerollsUsed: ts.rerollsUsed,
				offers: [...ts.offers],
				exposedOffers: new Set(ts.exposedOffers),
				endedAt: ts.endedAt,
			};
		}
	}

	private persist(): void {
		const store = this.options.store;
		if (!store) return;
		const viewerClient = this.options.viewerClient?.();
		const state = this.state;
		store.write({
			...(viewerClient ? { viewerClient } : {}),
			...(this.hiddenForChat ? { hiddenForChat: true } : {}),
			seq: this.seq,
			...(this.lastPush ? { lastPush: this.lastPush } : {}),
			...(this.lastTurn ? { lastTurn: this.lastTurn } : {}),
			...(this.lastChat ? { lastChat: this.lastChat } : {}),
			...(this.shown ? { shown: this.shown } : {}),
			...(state
				? {
						turnState: {
							turn: state.turn,
							rules: [...state.rules],
							...(state.pool ? { pool: [...state.pool] } : {}),
							excluded: [...state.excluded],
							excludedIds: [...state.excludedIds.entries()],
							rerollsUsed: state.rerollsUsed,
							offers: [...state.offers],
							exposedOffers: [...state.exposedOffers],
							endedAt: state.endedAt,
						},
					}
				: {}),
		});
	}

	private now(): number {
		return (this.options.now ?? Date.now)();
	}

	current(): OfferedSet | undefined {
		return this.shown;
	}

	/** The latest sequenced tray state push, or a fresh `off` when nothing has been pushed yet. */
	currentPush(): TrayPush {
		if (this.lastPush) return this.lastPush;
		return { sessionId: this.options.sessionId, seq: this.seq, state: "off" };
	}

	/** The chat's provider and model as of the last turn that reported one: the planner's default. */
	chat(): Turn["chat"] {
		return this.state?.turn.chat ?? this.lastTurn?.chat ?? this.lastChat;
	}

	/** The most recently derived turn in this session. */
	turn(): Turn | undefined {
		return this.state?.turn ?? this.lastTurn;
	}

	onSet(listener: (set: OfferedSet | undefined) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	onPush(listener: (push: TrayPush) => void): () => void {
		this.pushListeners.add(listener);
		return () => this.pushListeners.delete(listener);
	}

	/** Resolves when the detached planner work for the latest turn is done; for tests and shutdown. */
	settled(): Promise<void> {
		return this.pending;
	}

	private emit(): void {
		for (const listener of this.listeners) {
			try {
				listener(this.shown);
			} catch (error) {
				this.options.log?.("a set listener failed", error);
			}
		}
	}

	private pushState(
		state: TrayState,
		extra: {
			turnKey?: string;
			rerollsLeft?: number;
			set?: OfferedSet;
			error?: string;
		} = {},
	): TrayPush {
		this.seq += 1;
		const push: TrayPush = {
			sessionId: this.options.sessionId,
			seq: this.seq,
			state,
			...(extra.turnKey ? { turnKey: extra.turnKey } : {}),
			...(extra.rerollsLeft !== undefined
				? { rerollsLeft: extra.rerollsLeft }
				: {}),
			...(extra.set ? { set: extra.set } : {}),
			...(extra.error ? { error: extra.error } : {}),
		};
		this.lastPush = push;
		this.persist();
		for (const listener of this.pushListeners) {
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

	private labelFor(
		set: OfferedSet,
		event: string,
		fields: Record<string, unknown> = {},
	): void {
		this.label({ ...this.labelKeys(set), event, ...fields });
	}

	private labelKeys(set: OfferedSet): Record<string, unknown> {
		return {
			v: LABEL_SCHEMA_VERSION,
			at: new Date(this.now()).toISOString(),
			sessionId: set.sessionId,
			offerId: set.offerId,
			setId: set.setId,
			turnKey: set.turnKey,
			runCount: set.runCount,
		};
	}

	private async readDirty(env: SourceEnv): Promise<number | undefined> {
		const cwd = env.workspaceRoot ?? env.cwd;
		if (!cwd || !this.options.dirtyFiles || !env.git) return undefined;
		const read = this.options.dirtyFiles;
		return withinBudget(
			() => read(cwd),
			this.options.budgets?.dirtyMs ?? DIRTY_FILES_BUDGET_MS,
			undefined,
		);
	}

	private allowanceState(settings: Settings): AllowanceState | undefined {
		const ledger = this.options.ledger;
		if (!ledger) return undefined;
		const calls =
			typeof ledger.callsForSession === "function"
				? ledger.callsForSession(this.options.sessionId)
				: ledger.calls();
		return allowance(
			calls,
			this.options.sessionId,
			settings.planner.callsPerHour,
			this.now(),
		);
	}

	private rerollsLeft(state: TurnState): number {
		return Math.max(0, REROLL_LIMIT - state.rerollsUsed);
	}

	/** Serves one set: a new offer, its record, and the listeners. */
	private serve(
		state: TurnState,
		candidates: readonly Suggestion[],
		planner: Offer["planner"],
		options: {
			paused?: OfferedSet["paused"];
			model?: OfferedSet["model"];
			exhausted?: boolean;
		} = {},
	): OfferedSet {
		const { turn } = state;
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
			options.paused ??
			(options.model?.status === "paused" &&
			options.model.resetsAt !== undefined
				? { resetsAt: options.model.resetsAt }
				: undefined);
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
			...(options.model ? { model: options.model } : {}),
		};
		this.label(
			offerRecord(set, {
				turn: turn.facts,
				latencyMs: this.now() - state.endedAt,
				fallback: false,
				tags: manifestTags(state.manifest),
				...(state.trigger ? { trigger: state.trigger } : {}),
				at: new Date(this.now()),
			}),
		);
		state.offers.push(set);
		if (state.offers.length > RETAINED_OFFERS_LIMIT)
			state.offers.splice(0, state.offers.length - RETAINED_OFFERS_LIMIT);
		this.shown = set;
		const trayState: TrayState =
			candidates.length > 0
				? "ready"
				: options.exhausted ||
						(state.rerollsUsed >= REROLL_LIMIT && state.excluded.length > 0)
					? "exhausted"
					: "empty";
		this.pushState(trayState, { turnKey: turn.turnKey, rerollsLeft, set });
		this.emit();
		return set;
	}

	/**
	 * `afterRun` for a root run: derive the turn synchronously, push `computing`,
	 * and defer the manifest, backlog, rule-based set and planner call with
	 * `setImmediate` so the hook stays O(ms) behind a generation guard.
	 */
	async afterRun(result: AgentRunResult): Promise<OfferedSet | undefined> {
		const settings = this.options.settings();
		if (!settings.features.next || this.hiddenForChat) {
			this.shown = undefined;
			this.state = undefined;
			this.pushState("off");
			this.emit();
			return undefined;
		}
		const turn = deriveTurn(this.options.sessionId, result);
		if (!turn) return undefined;
		this.lastTurn = turn;
		if (turn.chat) this.lastChat = turn.chat;
		const endedAt = this.now();
		this.generation += 1;
		const gen = this.generation;
		this.pushState("computing", {
			turnKey: turn.turnKey,
			rerollsLeft: REROLL_LIMIT,
		});
		const deferred = new Promise<OfferedSet | undefined>((resolve) => {
			setImmediate(() => {
				void this.serveTurn(turn, endedAt, gen, settings).then(
					resolve,
					(error) => {
						this.options.log?.("afterRun failed", error);
						resolve(undefined);
					},
				);
			});
		});
		const modelSettled = deferred.then(() => this.modelPending);
		this.pending = modelSettled;
		return deferred;
	}

	private modelPending: Promise<void> = Promise.resolve();

	/**
	 * Serves a set on demand when `current` is invoked by a viewer on a chat that
	 * has no set for the requested `runCount` (for example, a forked chat after
	 * Undo or a reopened session). Uses the dormant turn if one was already
	 * recorded, otherwise reads the transcript and status via `readTranscript`.
	 */
	async ensureCurrent(runCount?: number): Promise<TrayPush> {
		const settings = this.options.settings();
		if (!settings.features.next || this.hiddenForChat) {
			return { sessionId: this.options.sessionId, seq: this.seq, state: "off" };
		}
		if (this.shown) {
			if (runCount === undefined || this.shown.runCount === runCount) {
				return this.currentPush();
			}
		}
		let turn =
			this.lastTurn &&
			(runCount === undefined || this.lastTurn.runCount === runCount)
				? this.lastTurn
				: undefined;
		if (!turn && this.options.readTranscript) {
			const loaded = await this.options.readTranscript().catch(() => undefined);
			if (loaded && loaded.messages.length > 0) {
				const derived = deriveTurnFromTranscript(
					this.options.sessionId,
					loaded.messages,
					loaded.status,
				);
				if (
					derived &&
					(runCount === undefined || derived.runCount === runCount)
				) {
					turn = derived;
				}
			}
		}
		if (!turn || turn.runCount === 0) {
			return this.currentPush();
		}
		this.lastTurn = turn;
		if (turn.chat) this.lastChat = turn.chat;
		const endedAt = this.now();
		this.generation += 1;
		const gen = this.generation;
		this.pushState("computing", {
			turnKey: turn.turnKey,
			rerollsLeft: REROLL_LIMIT,
		});
		const served = this.serveTurn(turn, endedAt, gen, settings, "on_demand");
		this.pending = served.then(() => this.modelPending);
		await served;
		return this.currentPush();
	}

	private async serveTurn(
		turn: Turn,
		endedAt: number,
		gen: number,
		settings: Settings,
		trigger: OfferTrigger = "after_run",
	): Promise<OfferedSet | undefined> {
		const base = this.options.env();
		const chat = turn.chat ?? this.lastChat;
		const env: SourceEnv = {
			...base,
			sessionId: this.options.sessionId,
			providerId: chat?.providerId ?? base.providerId,
			turn: {
				editedPaths: [...turn.context.editedPaths],
				request: turn.context.request,
			},
		};
		const [manifest, dirtyFiles] = await Promise.all([
			buildManifest(this.options.sources(), env, {
				isOff: sourceOff(settings, env),
				budgetMs: this.options.budgets?.probe,
			}),
			this.readDirty(env),
		]);
		if (gen !== this.generation) return undefined;
		const backlog = await this.options.backlog(manifest);
		if (gen !== this.generation) return undefined;
		const github = { pushed: turn.pushed, ...this.options.github?.(env) };
		const rules = rulePool({
			backlog,
			turn: turn.facts,
			manifest,
			dirtyFiles,
			github,
		});
		const state: TurnState = {
			turn,
			trigger,
			env,
			manifest,
			backlog,
			dirtyFiles,
			rules,
			excluded: [],
			excludedIds: new Map(),
			rerollsUsed: 0,
			offers: [],
			exposedOffers: new Set(),
			endedAt,
		};
		this.state = state;
		const allowanceState = this.options.complete
			? this.allowanceState(settings)
			: undefined;
		const paused =
			allowanceState?.kind === "used"
				? { resetsAt: allowanceState.resetsAt }
				: undefined;
		const model: OfferedSet["model"] = this.options.complete
			? paused
				? { status: "paused", resetsAt: paused.resetsAt }
				: { status: "pending" }
			: undefined;
		const set = this.serve(state, pageSet(rules, []), "rules", {
			paused,
			model,
		});
		if (this.options.complete && !paused) {
			this.modelPending = this.planModel(state, gen).catch((error) =>
				this.options.log?.("the planner failed", error),
			);
		} else {
			this.modelPending = Promise.resolve();
		}
		return set;
	}

	/**
	 * The detached half: facts, one model call (or a cached pool), and the model
	 * set if this turn is still current. A pool is cached by the chat position
	 * and the person's message, so a run resumed on the same message reuses it
	 * and a new message at a position the chat returned to asks again.
	 */
	private async planModel(state: TurnState, gen: number): Promise<void> {
		const complete = this.options.complete;
		if (!complete || gen !== this.generation || this.state !== state) return;
		const facts = await collectFacts(
			this.options.sources(),
			state.manifest,
			state.env,
			{ budgetMs: this.options.budgets?.facts },
		);
		if (gen !== this.generation || this.state !== state) return;
		const kinds = offerableKinds(state.manifest);
		const key = `${this.options.sessionId}:${state.turn.revision}:${state.turn.userMessageId}:${fnv1a32(stableJson({ backlog: state.backlog, facts, manifest: state.manifest }))}`;
		let pool = this.cache
			.get(key)
			?.filter((item) => !state.excluded.includes(item.prompt));
		if (!pool || pool.length === 0) {
			const input = buildPlannerInput({
				turn: state.turn.facts,
				context: state.turn.context,
				backlog: state.backlog,
				manifest: state.manifest,
				facts,
				kinds,
				excluded: state.excluded,
			});
			const attempt = await generatePool(
				complete,
				input,
				kinds,
				this.options.budgets?.modelMs,
			);
			const model = {
				providerId:
					attempt.providerId ??
					state.turn.chat?.providerId ??
					this.lastChat?.providerId,
				modelId:
					attempt.modelId ?? state.turn.chat?.modelId ?? this.lastChat?.modelId,
			};
			if (!("reason" in attempt) || attempt.reason !== "no_provider") {
				this.options.ledger?.record(
					this.options.sessionId,
					attempt.costUsd,
					model,
				);
			}
			if (gen !== this.generation || this.state !== state) return;
			if ("reason" in attempt) {
				this.options.log?.(
					`model suggestions unavailable (${attempt.reason}); the rule-based set stays`,
					attempt.error,
				);
				const status: ModelStatus =
					attempt.reason === "no_provider" ? "no_provider" : "error";
				if (this.shown && this.shown.turnKey === state.turn.turnKey) {
					const updated: OfferedSet = { ...this.shown, model: { status } };
					this.shown = updated;
					const idx = state.offers.findIndex(
						(offer) => offer.offerId === updated.offerId,
					);
					if (idx !== -1) state.offers[idx] = updated;
					const trayState: TrayState =
						updated.candidates.length > 0 ? "ready" : "empty";
					this.pushState(trayState, {
						turnKey: state.turn.turnKey,
						rerollsLeft: this.rerollsLeft(state),
						set: updated,
					});
				}
				return;
			}
			pool = attempt.pool;
			this.cache.set(key, pool);
		}
		if (gen !== this.generation || this.state !== state) return;
		state.pool = pool;
		this.serve(
			state,
			buildModelSet({
				pool,
				rules: state.rules,
				turn: state.turn.facts,
				excluded: state.excluded,
			}),
			"model",
		);
	}

	/**
	 * A model request is about to go out. When it carries a new message from the
	 * person, that message is labelled against the set on screen (or the explicit
	 * Use/Send intent) and the set is superseded. Later requests in the same run,
	 * and a run on the same message (a resume), find nothing new and label nothing.
	 */
	outgoing(messages: readonly AgentMessage[]): void {
		const message = lastPersonMessage(messages);
		const lastTurn = this.state?.turn ?? this.lastTurn;
		if (!message) return;
		if (lastTurn && message.id === lastTurn.userMessageId) return;
		this.generation += 1;
		const set = this.shown;
		const state = this.state;
		if (!set || !state) return;
		const text = message.text;
		const intent = state.pendingIntent;
		state.pendingIntent = undefined;
		if (intent && intent.verb === "send" && intent.candidate.prompt === text) {
			this.labelFor(intent.offer, "do", {
				candidateId: intent.candidate.id,
				kind: intent.candidate.kind,
				rank: intent.rank,
				position: intent.position,
				...(intent.input ? { input: intent.input } : {}),
				...(intent.msSinceExposed !== undefined
					? { msSinceExposed: intent.msSinceExposed }
					: {}),
			});
		} else if (intent && intent.verb === "use") {
			const bucket = editBucket(intent.candidate.prompt, text);
			if (bucket === "large") {
				this.labelFor(intent.offer, "adjust_abandoned", {
					candidateId: intent.candidate.id,
					cause: "different_message",
				});
				if (text && state.exposedOffers.size > 0) {
					this.labelFor(set, "typed_instead", {
						typedText: text.slice(0, TYPED_TEXT_LIMIT),
					});
				}
			} else {
				this.labelFor(intent.offer, "adjust_sent", {
					candidateId: intent.candidate.id,
					kind: intent.candidate.kind,
					rank: intent.rank,
					position: intent.position,
					bucket,
					chars: text.length,
					msToSend: Math.max(0, this.now() - intent.at),
					...(intent.input ? { input: intent.input } : {}),
				});
			}
		} else {
			const exact = set.candidates.findIndex((item) => item.prompt === text);
			const scored = set.candidates.map((item, index) => ({
				item,
				index,
				bucket: editBucket(item.prompt, text),
			}));
			const close = scored.find((entry) => entry.bucket === "small");
			if (exact !== -1) {
				const item = set.candidates[exact];
				this.labelFor(set, "do", {
					candidateId: item?.id,
					kind: item?.kind,
					rank: exact + 1,
					position: exact,
					input: "message",
				});
			} else if (close) {
				this.labelFor(set, "adjust", {
					candidateId: close.item.id,
					kind: close.item.kind,
					rank: close.index + 1,
					position: close.index,
					bucket: "small",
					input: "message",
				});
			} else if (
				text &&
				(state.exposedOffers.size > 0 || this.pushListeners.size === 0)
			) {
				this.labelFor(set, "typed_instead", {
					typedText: text.slice(0, TYPED_TEXT_LIMIT),
				});
			}
		}
		this.labelFor(set, "superseded", { cause: "message" });
		this.state = undefined;
		this.shown = undefined;
		this.pushState("off");
		this.emit();
	}

	private resolveOffer(
		state: TurnState | undefined,
		offerId: string | undefined,
	): OfferedSet | undefined {
		if (!state) return undefined;
		if (!offerId) return this.shown;
		return state.offers.findLast((offer) => offer.offerId === offerId);
	}

	/** A tray action. Skip, Unskip and Reroll serve a new set from the same turn; Use, Send, Exposed, Hide and Label update state and labels. */
	async invoke(action: TrayAction): Promise<OfferedSet | undefined> {
		if (action.type === "current") return this.shown;
		if (action.type === "label") {
			const target =
				this.resolveOffer(this.state, action.offerId) ?? this.shown;
			const base: Record<string, unknown> = target
				? this.labelKeys(target)
				: {
						v: LABEL_SCHEMA_VERSION,
						at: new Date(this.now()).toISOString(),
						sessionId: this.options.sessionId,
						...(action.offerId ? { offerId: action.offerId } : {}),
						...(this.lastTurn
							? {
									turnKey: this.lastTurn.turnKey,
									runCount: this.lastTurn.runCount,
								}
							: {}),
					};
			this.label({ ...base, ...(action.fields ?? {}), event: action.event });
			return this.shown;
		}
		if (action.type === "hide") {
			const target = this.shown;
			if (target) {
				this.labelFor(target, "hidden_by_user", {
					...(action.scope ? { scope: action.scope } : {}),
				});
			} else {
				this.label({
					v: LABEL_SCHEMA_VERSION,
					at: new Date(this.now()).toISOString(),
					sessionId: this.options.sessionId,
					event: "hidden_by_user",
					...(action.scope ? { scope: action.scope } : {}),
				});
			}
			if (action.scope === "chat") this.hiddenForChat = true;
			this.shown = undefined;
			this.state = undefined;
			this.pushState("off");
			this.emit();
			return undefined;
		}
		const state = this.state;
		const current = this.shown;
		if (!state || !current) return undefined;
		const target = this.resolveOffer(state, action.offerId);
		if (!target) {
			const fallbackVerb =
				action.type === "send"
					? "do"
					: action.type === "use"
						? "adjust"
						: undefined;
			this.labelFor(current, "refused_stale", {
				reason: "set_changed",
				...(fallbackVerb ? { verb: fallbackVerb } : {}),
			});
			return current;
		}
		return this.invokeWithOffer(state, current, target, action);
	}

	private async invokeWithOffer(
		state: TurnState,
		current: OfferedSet,
		target: OfferedSet,
		action: Exclude<TrayAction, { type: "current" | "label" | "hide" }>,
	): Promise<OfferedSet | undefined> {
		if (action.type === "exposed") {
			state.exposedOffers.add(target.offerId);
			this.labelFor(target, "exposed", {
				...(action.candidateId ? { candidateId: action.candidateId } : {}),
			});
			this.persist();
			return current;
		}
		if (action.type === "use" || action.type === "send") {
			const index = target.candidates.findIndex(
				(item) => item.id === action.candidateId,
			);
			const item = target.candidates[index];
			if (!item) return current;
			const rank = index + 1;
			if (action.type === "use") {
				this.labelFor(target, "adjust", {
					candidateId: item.id,
					kind: item.kind,
					rank,
					position: index,
					...(action.input ? { input: action.input } : {}),
					...(action.msSinceExposed !== undefined
						? { msSinceExposed: action.msSinceExposed }
						: {}),
				});
			}
			state.pendingIntent = {
				verb: action.type,
				offer: target,
				candidate: item,
				rank,
				position: index,
				input: action.input,
				msSinceExposed: action.msSinceExposed,
				at: this.now(),
			};
			return current;
		}
		if (action.type === "unskip") {
			const prompt = state.excludedIds.get(action.candidateId);
			if (!prompt) return current;
			state.excludedIds.delete(action.candidateId);
			const idx = state.excluded.indexOf(prompt);
			if (idx !== -1) state.excluded.splice(idx, 1);
			this.labelFor(target, "undo_skip", {
				candidateId: action.candidateId,
				...(action.input ? { input: action.input } : {}),
			});
			const next = state.pool
				? buildModelSet({
						pool: state.pool,
						rules: state.rules,
						turn: state.turn.facts,
						excluded: state.excluded,
					})
				: pageSet(state.rules, state.excluded);
			return this.serve(state, next, state.pool ? "model" : "rules", {
				paused: current.paused,
				model: current.model,
			});
		}
		if (action.type === "skip") {
			const index = target.candidates.findIndex(
				(item) => item.id === action.candidateId,
			);
			const item = target.candidates[index];
			if (!item) return current;
			this.labelFor(target, "skip", {
				candidateId: item.id,
				kind: item.kind,
				rank: index + 1,
				position: index,
				...(action.input ? { input: action.input } : {}),
				...(action.msSinceExposed !== undefined
					? { msSinceExposed: action.msSinceExposed }
					: {}),
			});
			state.excludedIds.set(item.id, item.prompt);
			this.exclude(state, [item.prompt]);
			const next = state.pool
				? buildModelSet({
						pool: state.pool,
						rules: state.rules,
						turn: state.turn.facts,
						excluded: state.excluded,
					})
				: pageSet(state.rules, state.excluded);
			const exhausted = next.length === 0 && this.rerollsLeft(state) === 0;
			return this.serve(state, next, state.pool ? "model" : "rules", {
				paused: current.paused,
				model: current.model,
				exhausted,
			});
		}
		if (state.rerollsUsed >= REROLL_LIMIT) {
			return this.serve(state, [], state.pool ? "model" : "rules", {
				paused: current.paused,
				model: current.model,
				exhausted: true,
			});
		}
		state.rerollsUsed += 1;
		const excludedIds = target.candidates.map((item) => item.id);
		for (const item of target.candidates)
			state.excludedIds.set(item.id, item.prompt);
		this.labelFor(target, "reroll", {
			rerollIndex: state.rerollsUsed,
			...(excludedIds.length > 0 ? { excluded: excludedIds } : {}),
			...(action.input ? { input: action.input } : {}),
			...(action.cause ? { cause: action.cause } : {}),
		});
		this.exclude(
			state,
			target.candidates.map((item) => item.prompt),
		);
		const pool =
			state.pool?.filter((item) => !state.excluded.includes(item.prompt)) ?? [];
		if (pool.length === 0 && this.options.complete) {
			if (this.allowanceState(this.options.settings())?.kind !== "used") {
				const modelWork = this.planModel(state, this.generation).catch(
					(error) => this.options.log?.("the planner failed", error),
				);
				this.modelPending = modelWork;
				this.pending = modelWork;
			}
		}
		const next = state.pool
			? buildModelSet({
					pool: state.pool,
					rules: state.rules,
					turn: state.turn.facts,
					excluded: state.excluded,
				})
			: pageSet(state.rules, state.excluded);
		const exhausted = next.length === 0 && this.rerollsLeft(state) === 0;
		return this.serve(state, next, state.pool ? "model" : "rules", {
			paused: current.paused,
			model: current.model,
			exhausted,
		});
	}

	private exclude(state: TurnState, prompts: readonly string[]): void {
		for (const prompt of prompts)
			if (!state.excluded.includes(prompt)) state.excluded.push(prompt);
		state.excluded.splice(
			0,
			Math.max(0, state.excluded.length - EXCLUDED_LIMIT),
		);
	}
}
