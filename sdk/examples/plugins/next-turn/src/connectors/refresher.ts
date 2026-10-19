import { MINUTE_MS } from "../config";
import type { SourceEnv } from "../context/source";
import type { Log } from "../log";
import type { Access, Connector, ReadScope } from "./connector";

/**
 * The read path, kept out of every hook. A connector's chosen
 * scopes refresh:
 * - all of them when a chat starts and when the branch changes;
 * - the scopes marked `onPush` after the agent pushes or opens a PR;
 * - each on its own cadence while the chat is open (a one-minute tick
 *   refreshes whatever is due).
 *
 * One refresh per connector and scope runs at a time; a request that arrives
 * meanwhile runs once that refresh ends, with the env as it is then. A
 * failure leaves the last facts, which state their age.
 */

type RefresherOptions = {
	/** Read on every refresh, so connectors found after start are included. */
	connectors: () => readonly Connector[];
	access: (connectorId: string) => Access;
	env: () => SourceEnv;
	/** Whether the plugin is still enabled and installed: a disabled plugin reads no connector. */
	active?: () => boolean;
	log?: Log;
	now?: () => number;
	/** Runs `tick` every minute until the returned function is called. */
	startTicking?: (tick: () => void) => () => void;
};

function tickEveryMinute(tick: () => void): () => void {
	const timer = setInterval(tick, MINUTE_MS).unref();
	return () => clearInterval(timer);
}

type LastRefresh = { at: number; revision?: string };

export class Refresher {
	private readonly inFlight = new Set<string>();
	/** Keys whose refresh was requested while one was in flight, with the request's reason. */
	private readonly missed = new Map<string, string>();
	/** Per instance: a connector found again after it was removed has read nothing yet, so its scopes are due. */
	private readonly lastRefreshed = new WeakMap<
		Connector,
		Map<string, LastRefresh>
	>();
	private stopTicking: (() => void) | undefined;
	private branch: string | undefined;

	constructor(private readonly options: RefresherOptions) {}

	start(): Promise<void> {
		this.stop();
		this.stopTicking = (this.options.startTicking ?? tickEveryMinute)(
			() => void this.refresh("due", (scope, last) => this.due(scope, last)),
		);
		this.branch = this.options.env().git?.branch;
		return this.refreshAll("start");
	}

	stop(): void {
		this.stopTicking?.();
		this.stopTicking = undefined;
		this.missed.clear();
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

	private refreshAll(reason: string): Promise<void> {
		return this.refresh(reason, () => true);
	}

	private now(): number {
		return (this.options.now ?? Date.now)();
	}

	private due(scope: ReadScope, last: number | undefined): boolean {
		return (
			last === undefined || this.now() - last >= scope.everyMinutes * MINUTE_MS
		);
	}

	private async refresh(
		reason: string,
		wanted: (scope: ReadScope, lastRefreshed: number | undefined) => boolean,
		onlyKey?: string,
	): Promise<void> {
		if (this.options.active?.() === false) return;
		const env = this.options.env();
		const work: Promise<void>[] = [];
		for (const connector of this.options.connectors()) {
			const access = this.options.access(connector.id);
			if (!access.readAllowed) continue;
			const refreshed =
				this.lastRefreshed.get(connector) ?? new Map<string, LastRefresh>();
			this.lastRefreshed.set(connector, refreshed);
			for (const scope of connector.scopes) {
				const key = `${connector.id}/${scope.id}`;
				const last = refreshed.get(scope.id);
				if (
					(onlyKey !== undefined && key !== onlyKey) ||
					!access.scopes.includes(scope.id) ||
					!wanted(
						scope,
						last?.revision === scope.revision ? last?.at : undefined,
					)
				)
					continue;
				if (this.inFlight.has(key)) {
					this.missed.set(key, reason);
					continue;
				}
				this.inFlight.add(key);
				refreshed.set(scope.id, { at: this.now(), revision: scope.revision });
				work.push(
					connector
						.refresh(scope.id, env)
						.catch((error: unknown) =>
							this.options.log?.(
								`${key} refresh failed (${reason}); keeping the last facts`,
								error,
							),
						)
						.finally(() => this.settle(key)),
				);
			}
		}
		await Promise.all(work);
	}

	/** Ends a key's refresh, then runs the request it held back, if any. */
	private settle(key: string): Promise<void> | undefined {
		this.inFlight.delete(key);
		const reason = this.missed.get(key);
		if (reason === undefined) return undefined;
		this.missed.delete(key);
		return this.refresh(reason, () => true, key);
	}
}
