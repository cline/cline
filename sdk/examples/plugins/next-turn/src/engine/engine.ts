import type { HubEventName } from "@cline/shared";
import type { CursorWriter } from "../hub/cursor";
import {
	emptyFold,
	FOLDED_EVENTS,
	foldEvent,
	type HubFold,
	type SessionFold,
} from "../hub/fold";
import type { HubLink } from "../hub/link";
import { HUB_SEEDS, seedUpcoming, UPCOMING_READS } from "../hub/seed";
import type { Log } from "../log";
import { type NeedsYouItem, needsYou } from "../model/needs-you";
import { type UpcomingRun, upcomingRuns } from "../model/schedules";
import {
	type BoardScope,
	type ExplicitStatus,
	type StatusBoard,
	statusBoard,
} from "../model/session-rows";
import { type NotifyGate, waitingOn } from "./notify";

export type EngineLink = Pick<
	HubLink,
	"onStatus" | "start" | "subscribe" | "command" | "dispose"
>;

/** Events after which a schedule's next run may have moved: a run ended, or a schedule was added, edited, enabled, disabled or removed. Only their names are read. */
const UPCOMING_CHANGED: ReadonlySet<HubEventName> = new Set([
	"schedule.created",
	"schedule.updated",
	"schedule.deleted",
	"schedule.execution_completed",
	"schedule.execution_failed",
]);

type EngineOptions = {
	link: EngineLink;
	cursor?: CursorWriter;
	scope?: BoardScope;
	/** This sandbox's session: the only one it sends notifications for. */
	sessionId?: string;
	notify?: NotifyGate;
	log?: Log;
};

/**
 * The engine's live view of the hub. One subscription folds the
 * allowlisted events; each time the link comes up, session, task and
 * schedule commands seed what live events have not supplied, and after a
 * reconnect, replace what went stale while the link was down. The upcoming
 * runs are read then too, and again whenever a schedule changes or runs.
 * Planner backlogs, the Status Hub's session rows and Needs you all read this
 * fold instead of querying the hub per offer.
 */
export class NextTurnEngine {
	private current: HubFold = emptyFold();
	private readonly listeners = new Set<(fold: HubFold) => void>();
	private readonly teardown: Array<() => void> = [];
	private started?: Promise<void>;
	private disposed = false;
	private linkUp = false;
	private linkUps = 0;
	private foldAtDrop?: HubFold;
	private readingUpcoming = false;
	private upcomingMoved = false;

	constructor(private readonly options: EngineOptions) {}

	fold(): HubFold {
		return this.current;
	}

	board(reports: readonly ExplicitStatus[] = []): StatusBoard {
		return statusBoard(this.current, reports, this.options.scope);
	}

	needsYou(reports: readonly ExplicitStatus[] = []): NeedsYouItem[] {
		return needsYou(this.current, reports, this.options.scope);
	}

	upcoming(): UpcomingRun[] {
		return upcomingRuns(this.current);
	}

	onChange(listener: (fold: HubFold) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	start(): Promise<void> {
		if (this.started) return this.started;
		const { link } = this.options;
		this.teardown.push(
			link.subscribe(FOLDED_EVENTS, (event) =>
				this.apply(foldEvent(this.current, event), event.sequence),
			),
		);
		this.teardown.push(
			link.subscribe(UPCOMING_CHANGED, () => void this.readUpcoming()),
		);
		this.teardown.push(
			link.onStatus((status) => {
				if (status === "up") {
					this.linkUp = true;
					this.linkUps += 1;
					void this.seed(this.foldAtDrop);
					void this.readUpcoming();
					this.foldAtDrop = undefined;
				} else if (this.linkUp) {
					this.linkUp = false;
					this.foldAtDrop = this.current;
				}
			}),
		);
		this.started = link.start();
		return this.started;
	}

	/**
	 * Seeds sessions, tasks and schedules from the hub; `stale` is the fold as it stood
	 * when the link dropped. A seed whose link dropped again before it answered is
	 * discarded, so the next drop's `stale` holds no half-applied seed.
	 */
	private async seed(stale?: HubFold): Promise<void> {
		const { link } = this.options;
		const up = this.linkUps;
		const replies = await Promise.allSettled(
			HUB_SEEDS.map(({ command, payload }) => link.command(command, payload)),
		);
		if (this.disposed || up !== this.linkUps || !this.linkUp) return;
		let next = this.current;
		HUB_SEEDS.forEach(({ command, seed }, index) => {
			const reply = replies[index];
			if (reply?.status === "fulfilled") next = seed(next, reply.value, stale);
			else
				this.options.log?.(
					`${command} failed; it fills from live events`,
					reply?.reason,
				);
		});
		this.apply(next);
	}

	/** Asks the hub for the upcoming runs, one read at a time; a change while one is out asks once more after it. */
	private async readUpcoming(): Promise<void> {
		if (this.readingUpcoming) {
			this.upcomingMoved = true;
			return;
		}
		this.readingUpcoming = true;
		const { link, log } = this.options;
		const { runs, enabled } = UPCOMING_READS;
		try {
			do {
				this.upcomingMoved = false;
				const replies = await Promise.all([
					link.command(runs.command, runs.payload),
					link.command(enabled.command, enabled.payload),
				]).catch((error: unknown) => {
					log?.("the upcoming runs could not be read; they stay", error);
					return undefined;
				});
				if (replies) this.apply(seedUpcoming(this.current, ...replies));
			} while (this.upcomingMoved && !this.disposed);
		} finally {
			this.readingUpcoming = false;
		}
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		for (const stop of this.teardown.splice(0)) stop();
		this.listeners.clear();
		this.options.cursor?.flush();
		await this.options.link.dispose();
	}

	private apply(next: HubFold, sequence?: number): void {
		if (this.disposed || next === this.current) return;
		const previous = this.current;
		this.current = next;
		if (sequence !== undefined) this.options.cursor?.advance(sequence);
		for (const listener of this.listeners) {
			try {
				listener(next);
			} catch (error) {
				this.options.log?.("a fold listener threw", error);
			}
		}
		const { sessionId } = this.options;
		if (sessionId && previous.sessions[sessionId] !== next.sessions[sessionId])
			this.notify(next.sessions[sessionId]);
	}

	private notify(session: SessionFold | undefined): void {
		const payload = session && this.options.notify?.take(waitingOn(session));
		if (!payload) return;
		this.options.link
			.command("ui.notify", payload)
			.catch((error: unknown) => this.options.log?.("ui.notify failed", error));
	}
}
