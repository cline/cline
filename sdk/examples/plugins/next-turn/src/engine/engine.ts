import {
	SEED_EXECUTION_LIMIT,
	SEED_SESSION_LIMIT,
	SEED_TASK_LIMIT,
	SEED_UPCOMING_LIMIT,
} from "../config";
import type { CursorWriter } from "../hub/cursor";
import { emptyFold, FOLDED_EVENTS, foldEvent, type HubFold } from "../hub/fold";
import type { HubEvent, HubLinkStatus } from "../hub/link";
import {
	seedExecutions,
	seedSessions,
	seedTasks,
	seedUpcoming,
} from "../hub/seed";
import { type NeedsYouItem, needsYou, newItems } from "../model/needs-you";
import { type UpcomingRun, upcomingRuns } from "../model/schedules";
import {
	type BoardScope,
	type ExplicitStatus,
	type StatusBoard,
	statusBoard,
} from "../model/session-rows";
import type { NotifyGate } from "./notify";

/** What the engine needs from `HubLink`; tests pass a fake. */
export interface EngineLink {
	onStatus(listener: (status: HubLinkStatus) => void): () => void;
	start(): Promise<void>;
	subscribe(
		names: ReadonlySet<string>,
		listener: (event: HubEvent) => void,
	): () => void;
	command(
		name: string,
		payload?: Record<string, unknown>,
		sessionId?: string,
	): Promise<Record<string, unknown>>;
	dispose(): Promise<void>;
}

export type EngineOptions = {
	link: EngineLink;
	cursor?: CursorWriter;
	scope?: BoardScope;
	/** This sandbox's session: the only one it sends notifications for. */
	sessionId?: string;
	notify?: { enabled: () => boolean; gate: NotifyGate };
	log?: (message: string, error?: unknown) => void;
};

/**
 * The engine's live view of the hub. One subscription folds the
 * allowlisted events; each time the link comes up, session, task and
 * schedule commands seed what live events have not supplied. Planner
 * backlogs, the Status Hub's session rows and Needs you all read this fold
 * instead of querying the hub per offer.
 */
export class NextTurnEngine {
	private current: HubFold = emptyFold();
	private needs: NeedsYouItem[] = [];
	private readonly listeners = new Set<(fold: HubFold) => void>();
	private readonly teardown: Array<() => void> = [];
	private started?: Promise<void>;
	private disposed = false;

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
			link.onStatus((status) => {
				if (status === "up") void this.seed();
			}),
		);
		this.started = link.start();
		return this.started;
	}

	/**
	 * Seeds sessions, tasks and schedules from the hub. `task.list` scopes workspace
	 * tasks from the connection's registered authority and ignores a payload `workspaceRoot`.
	 */
	async seed(): Promise<void> {
		const { link } = this.options;
		const seeds = [
			{
				command: "session.list",
				payload: { rootOnly: true, limit: SEED_SESSION_LIMIT },
				seed: seedSessions,
			},
			{
				command: "task.list",
				payload: { limit: SEED_TASK_LIMIT },
				seed: seedTasks,
			},
			{
				command: "schedule.upcoming",
				payload: { allWorkspaces: true, limit: SEED_UPCOMING_LIMIT },
				seed: seedUpcoming,
			},
			{
				command: "schedule.list_executions",
				payload: { allWorkspaces: true, limit: SEED_EXECUTION_LIMIT },
				seed: seedExecutions,
			},
		] as const;
		const replies = await Promise.allSettled(
			seeds.map(({ command, payload }) => link.command(command, payload)),
		);
		if (this.disposed) return;
		let next = this.current;
		replies.forEach((reply, index) => {
			const { command, seed } = seeds[index] as (typeof seeds)[number];
			if (reply.status === "fulfilled") next = seed(next, reply.value);
			else
				this.options.log?.(
					`${command} failed; it fills from live events`,
					reply.reason,
				);
		});
		this.apply(next);
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
		this.current = next;
		if (sequence !== undefined) this.options.cursor?.advance(sequence);
		for (const listener of this.listeners) {
			try {
				listener(next);
			} catch (error) {
				this.options.log?.("a fold listener threw", error);
			}
		}
		this.notify();
	}

	private notify(): void {
		const { notify, sessionId, link } = this.options;
		if (!notify || !sessionId) return;
		const own = this.needsYou().filter(
			(item) =>
				(item.kind === "approval" || item.kind === "question") &&
				item.sessionId === sessionId,
		);
		const fresh = newItems(this.needs, own);
		this.needs = own;
		if (fresh.length === 0 || !notify.enabled()) return;
		const payload = notify.gate.take(fresh);
		if (!payload) return;
		link
			.command("ui.notify", payload)
			.catch((error: unknown) => this.options.log?.("ui.notify failed", error));
	}
}
