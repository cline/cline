import type {
	AgentMessage,
	AgentRunResult,
	PluginUiSurface,
} from "@cline/shared";
import { REROLL_LIMIT } from "../../config";
import {
	buildManifest,
	capabilitiesBySource,
	type Manifest,
} from "../../context/manifest";
import { sourceOff } from "../../context/policy";
import type { ContextSource, SourceEnv } from "../../context/source";
import type { Log } from "../../log";
import type { Settings } from "../../settings/settings";
import type { SessionStateStore } from "../../store/session-state";
import { errorMessage } from "../../values";
import type { Backlog } from "../backlog";
import type { LabelLog } from "../labels/labels";
import type { OfferTrigger } from "../labels/schema";
import type { PlannerLedger } from "../model/allowance";
import type { Complete } from "../model/model";
import { type GitHubEvidence, rulePool } from "../rules";
import type { OfferedSet, OffReason, TrayAction, TrayPush } from "../tray/tray";
import type { MessageLike } from "../turn/run-count";
import { deriveTurn, deriveTurnFromTranscript, type Turn } from "../turn/turn";
import { SessionCore } from "./core";
import { outgoing } from "./outgoing";
import { resumePlanner, startPlanner } from "./planner-call";
import { invoke, type TrayRefusal } from "./tray-actions";
import { restore, type TurnState } from "./turn-state";

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
	/** The surface of the viewer the chat has while one is attached, persisted so a respawn knows the chat is viewed. */
	viewerSurface?: () => PluginUiSurface | undefined;
	/** Whether a viewer is attached: an unviewed chat's turn is recorded, never served. Viewed when absent. */
	viewed?: () => boolean;
	/** Whether the plugin is still enabled and installed: work that lands after it is disabled pushes and labels nothing. */
	active?: () => boolean;
	/** Reads the session's transcript and status from the hub on demand when no turn is in memory. */
	readTranscript?: () => Promise<
		{ messages: readonly MessageLike[]; status?: string } | undefined
	>;
	log?: Log;
};

/** Session statuses while a run is still going: a set for it would come before its outcome, and its planner call would be wasted. */
const UNFINISHED_SESSION_STATUSES: ReadonlySet<string> = new Set([
	"running",
	"pending",
]);

/** Next, for one chat: the plugin's run hooks and the `composer.suggestions` verbs drive it. */
export class NextSession {
	private readonly core: SessionCore;

	constructor(options: NextOptions) {
		this.core = new SessionCore(options);
		this.rehydrate();
	}

	private rehydrate(): void {
		const saved = this.core.options.store?.read();
		if (!saved) return;
		this.core.hiddenForChat = saved.hiddenForChat === true;
		this.core.seq = saved.seq ?? 0;
		this.core.lastPush = saved.lastPush;
		this.core.lastTurn = saved.lastTurn;
		this.core.lastTurnFromStore = saved.lastTurn !== undefined;
		this.core.lastChat = saved.lastChat;
		try {
			this.core.state =
				saved.turnState &&
				restore(saved.turnState, this.core.turnEnv(saved.turnState.turn));
		} catch (error) {
			this.core.options.log?.("the saved turn did not restore", error);
		}
		if (this.core.state && this.core.lastPush?.state === "computing")
			this.resumeComputing();
	}

	/**
	 * A `computing` push read back from the store has nothing working on it
	 * any more. A reroll asks the planner again, or takes the turn's next page
	 * when the planner cannot answer now. A turn's first set is served on
	 * demand instead, so the set the store holds, which is an older turn's,
	 * is dropped.
	 */
	private resumeComputing(): void {
		if (this.core.lastPush?.computingFor !== "reroll") {
			this.core.state = undefined;
			return;
		}
		resumePlanner(this.core, this.core.options.settings());
	}

	current(): OfferedSet | undefined {
		return this.core.shown;
	}

	off(reason?: OffReason): TrayPush {
		return this.core.off(reason);
	}

	/**
	 * Undoes "hide for this chat". A tray still showing that hide turns into a
	 * plain off at once, so a viewer that asks for the current set while a run
	 * is going or before any turn is known is not handed the hide back.
	 */
	show(): void {
		this.core.hiddenForChat = false;
		if (
			this.core.lastPush?.state === "off" &&
			this.core.lastPush.offReason === "hidden"
		)
			this.core.off("message");
		else this.core.persist();
	}

	/** Stops in-flight serves and planner calls from pushing, and detaches every listener. */
	dispose(): void {
		this.core.generation += 1;
		this.core.listeners.clear();
	}

	currentPush(): TrayPush {
		return this.core.currentPush();
	}

	/** The chat's provider and model as of the last turn that reported one: the planner's default. */
	chat(): Turn["chat"] {
		return this.core.lastChat;
	}

	/** The most recently derived turn in this session. */
	turn(): Turn | undefined {
		return this.core.lastTurn;
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
		this.core.listeners.add(listener);
		return () => this.core.listeners.delete(listener);
	}

	/** Resolves once the detached work has settled, including work it started meanwhile; for tests and shutdown. */
	async settled(): Promise<void> {
		let pending: Promise<void>;
		do {
			pending = this.core.pending;
			await pending;
		} while (pending !== this.core.pending);
	}

	/**
	 * A completed root run. Resolves with the rule-based set once it is served,
	 * or with nothing when Next is off, the run left no turn, or the serve is
	 * dropped or fails; the planner call stays detached.
	 */
	async afterRun(result: AgentRunResult): Promise<OfferedSet | undefined> {
		this.core.runUnderway = false;
		if (!this.core.isViewed()) {
			const turn = deriveTurn(this.core.options.sessionId, result);
			if (turn) this.recordUnviewedTurn(turn);
			return undefined;
		}
		const settings = this.core.options.settings();
		if (!this.core.isOn(settings)) {
			this.core.off(this.core.whyOff());
			return undefined;
		}
		const turn = deriveTurn(this.core.options.sessionId, result);
		if (!turn) return undefined;
		return this.startTurn(turn, settings, "after_run");
	}

	/**
	 * A turn nobody is viewing: remembered, so the next viewer is served this
	 * turn rather than the set before it, with no set, planner call or push.
	 */
	private recordUnviewedTurn(turn: Turn): void {
		this.core.generation += 1;
		this.core.state = undefined;
		this.core.lastTurn = turn;
		this.core.lastTurnFromStore = false;
		if (turn.chat) this.core.lastChat = turn.chat;
		this.core.persist();
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
		this.core.lastTurn = turn;
		this.core.lastTurnFromStore = false;
		if (turn.chat) this.core.lastChat = turn.chat;
		const endedAt = Date.now();
		this.core.generation += 1;
		const gen = this.core.generation;
		this.core.pushState("computing", {
			turnKey: turn.turnKey,
			rerollsLeft: REROLL_LIMIT,
			computingFor: "turn",
		});
		const served = this.serveTurn(turn, endedAt, gen, settings, trigger).catch(
			(error: unknown) => {
				this.core.options.log?.("serving the turn failed", error);
				if (this.core.isCurrent(gen)) {
					this.core.state = undefined;
					this.core.pushState("unavailable", {
						turnKey: turn.turnKey,
						error: errorMessage(error),
					});
				}
				return undefined;
			},
		);
		this.core.serving = { turnKey: turn.turnKey, gen, done: served };
		this.core.track(served);
		return served;
	}

	/**
	 * A viewer's attach or show: the current set, served on demand when the
	 * chat has none (a forked chat after Undo, a reopened session) from the
	 * last turn or the transcript `readTranscript` returns, whichever is newer.
	 * A last turn from the store is served only once the hub says no run is
	 * going. A planner answer the set on screen still waits for, which a detach
	 * or a respawn left unasked, is asked for again.
	 */
	async ensureCurrent(): Promise<TrayPush> {
		const settings = this.core.options.settings();
		if (!this.core.isOn(settings)) return this.core.off(this.core.whyOff());
		if (this.core.shown || this.core.runUnderway) {
			resumePlanner(this.core, settings);
			return this.core.currentPush();
		}
		let turn = this.core.lastTurn;
		const inFlight = this.core.serving;
		if (
			turn &&
			inFlight?.gen === this.core.generation &&
			inFlight.turnKey === turn.turnKey
		) {
			await inFlight.done;
			return this.core.currentPush();
		}
		if (
			(!turn || this.core.lastTurnFromStore) &&
			this.core.options.readTranscript
		) {
			const gen = this.core.generation;
			const loaded = await this.core.options
				.readTranscript()
				.catch(() => undefined);
			if (
				!this.core.isCurrent(gen) ||
				!this.core.isViewed() ||
				!this.core.isOn(this.core.options.settings()) ||
				UNFINISHED_SESSION_STATUSES.has(loaded?.status ?? "")
			)
				return this.core.currentPush();
			const derived =
				loaded &&
				deriveTurnFromTranscript(
					this.core.options.sessionId,
					loaded.messages,
					loaded.status,
				);
			if (derived && (!turn || derived.runCount > turn.runCount))
				turn = derived;
		}
		if (!turn) return this.core.currentPush();
		await this.startTurn(turn, settings, "on_demand");
		return this.core.currentPush();
	}

	private async serveTurn(
		turn: Turn,
		endedAt: number,
		gen: number,
		settings: Settings,
		trigger: OfferTrigger,
	): Promise<OfferedSet | undefined> {
		const probeEnv = this.core.turnEnv(turn);
		const sources = this.core.options.sources();
		const [manifest, dirtyFiles] = await Promise.all([
			buildManifest(sources, probeEnv, {
				isOff: sourceOff(settings, probeEnv),
			}),
			this.core.readDirty(probeEnv),
		]);
		if (!this.core.isCurrent(gen)) return undefined;
		// The git read can move the branch, so the PR and the facts follow the branch the turn ended on.
		const env = this.core.turnEnv(turn);
		const backlog = await this.core.options.backlog(manifest);
		if (!this.core.isCurrent(gen)) return undefined;
		const github = { pushed: turn.pushed, ...this.core.options.github?.(env) };
		const state: TurnState = {
			turn,
			trigger,
			env,
			manifest,
			capabilitiesBySource: capabilitiesBySource(sources, manifest, probeEnv),
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
		this.core.state = state;
		const model = this.core.plannerModel(settings);
		const set = this.core.serve(state, model);
		if (model?.status === "pending") startPlanner(this.core, state, gen);
		return set;
	}

	outgoing(messages: readonly AgentMessage[]): void {
		outgoing(this.core, messages);
	}

	invoke(action: TrayAction): { push: TrayPush; refused?: TrayRefusal } {
		return invoke(this.core, action);
	}
}
