import { FeatureFlagsService, NoOpFeatureFlagsProvider } from "@cline/core";
import {
	buildClinePostHogClient,
	PostHogFeatureFlagsProvider,
} from "@cline/core/services/feature-flags/posthog";
import { FeatureFlag } from "@cline/shared";
import { type CloudScope, cloudScopeKey } from "./storage";

export const CLOUD_FLAG_REFRESH_MS = 60_000;
export const CLOUD_FLAG_LEASE_MS = 300_000;
type FlagService = Pick<
	FeatureFlagsService,
	"poll" | "getBooleanFlagEnabled" | "getCacheSnapshot" | "dispose"
>;
export type CloudEligibilityState = {
	available: boolean;
	enabled: boolean;
	checking: boolean;
	scopeKey?: string;
};
function createService(scope: CloudScope): FlagService {
	const key = process.env.TELEMETRY_SERVICE_API_KEY;
	const provider =
		key && process.env.IS_TEST !== "true" && process.env.E2E_TEST !== "true"
			? new PostHogFeatureFlagsProvider({
					config: {},
					client: buildClinePostHogClient(key),
				})
			: new NoOpFeatureFlagsProvider();
	return new FeatureFlagsService({
		provider,
		cacheTtlMs: 30_000,
		context: {
			distinctId: scope.accountId,
			userId: scope.accountId,
			clientName: "cline-cli",
		},
	});
}

/** An account/org epoch owns a fresh memory-only cache. No persisted flag can admit a task. */
export class CloudEligibility {
	private epoch = 0;
	private service?: FlagService;
	private pending?: Promise<void>;
	private teardown: Promise<void> = Promise.resolve();
	private positiveUntil = 0;
	private timer?: ReturnType<typeof setInterval>;
	private leaseTimer?: ReturnType<typeof setTimeout>;
	private state: CloudEligibilityState = {
		available: false,
		enabled: false,
		checking: false,
	};
	private listeners = new Set<() => void>();
	constructor(
		private readonly options: {
			createService?: (scope: CloudScope) => FlagService;
			now?: () => number;
		} = {},
	) {}
	getSnapshot = (): CloudEligibilityState => this.state;
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};
	private publish(state: CloudEligibilityState): void {
		this.state = state;
		for (const listener of this.listeners) listener();
	}
	async setScope(scope?: CloudScope): Promise<void> {
		const epoch = ++this.epoch;
		clearInterval(this.timer);
		clearTimeout(this.leaseTimer);
		const old = this.service;
		this.service = undefined;
		this.pending = undefined;
		this.positiveUntil = 0;
		this.publish({
			available: false,
			enabled: false,
			checking: Boolean(scope),
			scopeKey: scope ? cloudScopeKey(scope) : undefined,
		});
		this.teardown = this.teardown.then(() => old?.dispose()).catch(() => {});
		await this.teardown;
		if (epoch !== this.epoch || !scope) return;
		this.service = (this.options.createService ?? createService)(scope);
		await this.refresh();
		if (epoch !== this.epoch) return;
		this.timer = setInterval(() => void this.refresh(), CLOUD_FLAG_REFRESH_MS);
		this.timer.unref?.();
	}
	refresh(): Promise<void> {
		if (this.pending) return this.pending;
		const service = this.service;
		const epoch = this.epoch;
		if (!service) return Promise.resolve();
		const now = this.options.now ?? Date.now;
		const pending = (async () => {
			let available = false;
			try {
				await service.poll();
				if (epoch !== this.epoch) return;
				available = service.getBooleanFlagEnabled(FeatureFlag.CLI_CLOUD_AGENTS);
				// A cache hit cannot extend the lease of an older successful fetch.
				this.positiveUntil = available
					? service.getCacheSnapshot().updateTime + CLOUD_FLAG_LEASE_MS
					: 0;
				available = available && now() < this.positiveUntil;
			} catch {
				if (epoch !== this.epoch) return;
				available = now() < this.positiveUntil;
			}
			clearTimeout(this.leaseTimer);
			if (available) {
				this.leaseTimer = setTimeout(
					() => {
						if (epoch === this.epoch)
							this.publish({
								...this.state,
								available: false,
								enabled: false,
								checking: false,
							});
					},
					Math.max(0, this.positiveUntil - now()),
				);
				this.leaseTimer.unref?.();
			}
			this.publish({
				...this.state,
				available,
				enabled: available,
				checking: false,
			});
		})().finally(() => {
			if (this.pending === pending) this.pending = undefined;
		});
		this.pending = pending;
		return pending;
	}
	assertEnabled(): void {
		if (
			this.service &&
			(this.options.now ?? Date.now)() >= this.positiveUntil &&
			this.state.enabled
		)
			this.publish({ ...this.state, available: false, enabled: false });
		if (!this.state.enabled)
			throw new Error("Cloud agents are unavailable for this account.");
	}
	async dispose(): Promise<void> {
		await this.setScope(undefined);
		this.listeners.clear();
	}
}
