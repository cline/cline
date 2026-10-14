import { MINUTE_MS } from "../config";
import type { SourceEnv } from "../context/source";
import type { Access, Connector, ReadScope } from "./connector";

/**
 * The read path, kept out of every hook. A connector's chosen
 * scopes refresh:
 * - all of them when a chat starts and when the branch changes;
 * - the scopes marked `onPush` after the agent pushes or opens a PR;
 * - each on its own cadence while the chat is open (a one-minute tick
 *   refreshes whatever is due).
 *
 * One refresh per connector and scope runs at a time; a failure leaves the
 * last facts, which state their age.
 */

const PUSH = /\bgit\s+push\b|\bgh\s+pr\s+(?:create|merge|ready)\b/;

/** True when a finished tool call pushed or opened a PR, from its input; nothing of the input is kept. */
export function isPushCommand(input: unknown): boolean {
	try {
		return PUSH.test(
			typeof input === "string" ? input : JSON.stringify(input ?? ""),
		);
	} catch {
		return false;
	}
}

export type RefresherOptions = {
	/** Read on every refresh, so connectors found after start are included. */
	connectors: () => readonly Connector[];
	access: (connectorId: string) => Access;
	env: () => SourceEnv;
	/** How often due scopes are looked for. */
	tickMs: number;
	log?: (message: string, error?: unknown) => void;
	now?: () => number;
	setTimer?: (run: () => void, ms: number) => unknown;
	clearTimer?: (timer: unknown) => void;
};

export class Refresher {
	private readonly inFlight = new Set<string>();
	private readonly lastRefreshed = new Map<string, number>();
	private timer: unknown;
	private branch: string | undefined;

	constructor(private readonly options: RefresherOptions) {}

	start(): Promise<void> {
		const setTimer =
			this.options.setTimer ?? ((run, ms) => setInterval(run, ms));
		this.timer = setTimer(
			() => void this.refresh("due", (scope, key) => this.due(scope, key)),
			this.options.tickMs,
		);
		this.branch = this.options.env().git?.branch;
		return this.refreshAll("start");
	}

	stop(): void {
		if (this.timer !== undefined)
			(
				this.options.clearTimer ??
				((timer) => clearInterval(timer as ReturnType<typeof setInterval>))
			)(this.timer);
		this.timer = undefined;
	}

	/** Call on each turn; refreshes when the branch moved since the last one, or when the turn pushed. */
	async onTurn(options?: { pushed?: boolean }): Promise<void> {
		const branch = this.options.env().git?.branch;
		if (branch !== this.branch) {
			this.branch = branch;
			await this.refreshAll("branch");
			return;
		}
		if (options?.pushed)
			await this.refresh("push", (scope) => scope.onPush === true);
	}

	/** Call from `afterTool`; refreshes the push-sensitive scopes after a push or a new PR. */
	onToolFinished(input: unknown): Promise<void> {
		return isPushCommand(input)
			? this.refresh("push", (scope) => scope.onPush === true)
			: Promise.resolve();
	}

	refreshAll(reason: string): Promise<void> {
		return this.refresh(reason, () => true);
	}

	private now(): number {
		return (this.options.now ?? Date.now)();
	}

	private due(scope: ReadScope, key: string): boolean {
		const last = this.lastRefreshed.get(key);
		return (
			last === undefined || this.now() - last >= scope.everyMinutes * MINUTE_MS
		);
	}

	private async refresh(
		reason: string,
		wanted: (scope: ReadScope, key: string) => boolean,
	): Promise<void> {
		const env = this.options.env();
		const work: Promise<void>[] = [];
		for (const connector of this.options.connectors()) {
			const access = this.options.access(connector.id);
			if (!connector.refresh || access.role !== "read" || !access.readAllowed)
				continue;
			for (const scope of connector.scopes) {
				const key = `${connector.id}/${scope.id}`;
				if (
					!access.scopes.includes(scope.id) ||
					this.inFlight.has(key) ||
					!wanted(scope, key)
				)
					continue;
				this.inFlight.add(key);
				this.lastRefreshed.set(key, this.now());
				work.push(
					connector
						.refresh(scope.id, env)
						.catch((error: unknown) =>
							this.options.log?.(
								`${key} refresh failed (${reason}); keeping the last facts`,
								error,
							),
						)
						.finally(() => this.inFlight.delete(key)),
				);
			}
		}
		await Promise.all(work);
	}
}
