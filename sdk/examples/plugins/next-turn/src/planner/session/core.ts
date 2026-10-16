import { randomUUID } from "node:crypto";
import { DIRTY_FILES_BUDGET_MS, RETAINED_OFFERS_LIMIT } from "../../config";
import { manifestTags } from "../../context/manifest";
import type { SourceEnv } from "../../context/source";
import { withinBudget } from "../../deadline";
import type { Settings } from "../../settings/settings";
import { cueCode, fnv1a32, type Suggestion } from "../candidates";
import { labelHeader, offerRecord } from "../labels/labels";
import type { LabelEvent, LabelFields } from "../labels/schema";
import { pausedUntil } from "../model/allowance";
import { PoolCache } from "../model/model";
import type { OfferedSet, OffReason, TrayPush, TrayState } from "../tray/tray";
import type { Turn } from "../turn/turn";
import type { NextOptions } from "./session";
import {
	nextPage,
	pausedOf,
	rerollsLeft as rerollsLeftOf,
	snapshotOf,
	type TurnState,
	trayState,
} from "./turn-state";

export class SessionCore {
	state: TurnState | undefined;
	lastPush: TrayPush | undefined;
	lastTurn: Turn | undefined;
	lastChat: Turn["chat"];
	hiddenForChat = false;
	/** A message went out and its run has not ended: the last turn is no longer the chat's latest. */
	runUnderway = false;
	/**
	 * The last turn was read back from the store, so a run this session never
	 * saw start (a dormant chat's viewer, a respawn mid-run) may be going: the
	 * hub is asked before it is served.
	 */
	lastTurnFromStore = false;
	seq = 0;
	generation = 0;
	pending: Promise<void> = Promise.resolve();
	serving: { turnKey: string; gen: number; done: Promise<unknown> } | undefined;
	readonly cache = new PoolCache();
	readonly listeners = new Set<(push: TrayPush) => void>();

	constructor(readonly options: NextOptions) {}

	/** The set on screen: the turn's latest offer. */
	get shown(): OfferedSet | undefined {
		return this.state?.offers.at(-1);
	}

	persist(): void {
		this.options.store?.write({
			viewerSurface: this.options.viewerSurface?.(),
			hiddenForChat: this.hiddenForChat || undefined,
			seq: this.seq,
			lastPush: this.lastPush,
			lastTurn: this.lastTurn,
			lastChat: this.lastChat,
			turnState: this.state && snapshotOf(this.state),
		});
	}

	turnEnv(turn: Turn): SourceEnv {
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

	/**
	 * Drops the set and any in-flight serve, then pushes `off` under this
	 * session's own sequence, so the next push after it is newer. A tray that
	 * is already off for the same reason gets no second push.
	 */
	off(reason?: OffReason): TrayPush {
		this.generation += 1;
		if (
			!this.state &&
			this.lastPush?.state === "off" &&
			this.lastPush.offReason === reason
		)
			return this.lastPush;
		this.state = undefined;
		return this.pushState("off", reason ? { offReason: reason } : {});
	}

	/** Why Next is off in this chat: the person hid its suggestions, or Next is off in settings. */
	whyOff(): OffReason {
		return this.hiddenForChat ? "hidden" : "disabled";
	}

	/**
	 * The latest sequenced tray state push. Before the first push, Next is on
	 * and no set exists yet, which reads like a set a message superseded, not
	 * like Next turned off.
	 */
	currentPush(): TrayPush {
		return (
			this.lastPush ?? {
				sessionId: this.options.sessionId,
				seq: this.seq,
				state: "off",
				offReason: "message",
			}
		);
	}

	track(work: Promise<unknown>): void {
		const done = work.then(
			() => undefined,
			() => undefined,
		);
		this.pending = this.pending.then(() => done);
	}

	isOn(settings: Settings): boolean {
		return settings.features.next && !this.hiddenForChat;
	}

	/** Whether a viewer is attached: planner calls and network reads wait for one. */
	isViewed(): boolean {
		return this.options.viewed?.() ?? true;
	}

	/** Whether work started under `gen` (and for `state`) still owns the tray. */
	isCurrent(gen: number, state?: TurnState): boolean {
		return (
			gen === this.generation &&
			(!state || this.state === state) &&
			(this.options.active?.() ?? true)
		);
	}

	pushState(
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

	label(raw: Record<string, unknown>): void {
		try {
			this.options.labels?.append(raw);
		} catch (error) {
			this.options.log?.("a label was refused", error);
		}
	}

	/** A label about the set, or about the bare chat when no set is on screen. */
	labelFor(
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

	async readDirty(env: SourceEnv): Promise<number | undefined> {
		const cwd = env.workspaceRoot;
		const read = this.options.dirtyFiles;
		if (!cwd || !read || !env.git) return undefined;
		return withinBudget(() => read(cwd), DIRTY_FILES_BUDGET_MS, undefined);
	}

	/** The planner's status for a new set: none without a model, paused while the allowance is used, else pending. */
	plannerModel(settings: Settings): OfferedSet["model"] {
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

	/** Serves one set: a new offer, its record, and the push. */
	serve(
		state: TurnState,
		model?: OfferedSet["model"],
		candidates: readonly Suggestion[] = nextPage(state),
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
		const rerollsLeft = rerollsLeftOf(state);
		const paused = pausedOf(model);
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
		this.pushState(trayState(state, candidates), {
			turnKey: turn.turnKey,
			rerollsLeft,
			set,
		});
		return set;
	}

	/** The tray shows a reroll's loading state until the planner answers it. */
	awaitingReroll(): boolean {
		return (
			this.lastPush?.state === "computing" &&
			this.lastPush.computingFor === "reroll"
		);
	}
}
