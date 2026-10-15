import {
	type AgentExtensionUiSlot,
	type BasicLogger,
	type ITelemetryService,
	PLUGIN_UI_LIMITS,
	type PluginUiAction,
	type PluginUiActionContext,
	type PluginUiActionReply,
	type PluginUiGetInput,
	type PluginUiInvokeInput,
	type PluginUiInvokeResult,
	type PluginUiSlot,
	type PluginUiStateEnvelope,
	type PluginUiSurface,
	type PluginUiViewer,
	parsePluginUiAction,
	readPluginUiSlotCatalog,
} from "@cline/shared";
import type { PluginUiHostApi } from "../../../services/plugin-ui-api";
import {
	capturePluginUiInvoke,
	capturePluginUiSessionSummary,
	capturePluginUiStateDropped,
	capturePluginUiViewersChanged,
} from "../../../services/telemetry/core-events";
import type { CoreSessionConfig } from "../../../types/config";
import type { SessionRuntime } from "../../orchestration/session-runtime-orchestrator";
import {
	type PluginUiStateDrop,
	PluginUiStore,
	type PluginUiStorePush,
} from "./plugin-ui-store";

/** What the service reads from a resident session; `ActiveSession` satisfies it. */
export interface PluginUiSession {
	agent: Pick<SessionRuntime, "initializeExtensions" | "getExtensionRegistry">;
	config: Pick<CoreSessionConfig, "logger" | "telemetry">;
}

export interface PluginUiServiceOptions {
	sessions(sessionId: string): PluginUiSession | undefined;
	/** The host's event sink; `LocalRuntimeHost.emit` is private, so it is passed in. */
	emit(envelope: PluginUiStateEnvelope): void;
	telemetry?: ITelemetryService;
	logger?: BasicLogger;
	now?: () => number;
}

const GESTURE_VERBS: ReadonlySet<string> = new Set([
	"use",
	"send",
	"skip",
	"unskip",
	"refresh",
	"hide",
	"show",
	"undo",
	"clear",
]);
const DROP_REPORT_INTERVAL_MS = 60_000;
const DROP_REPORTS_BEFORE_PRUNE = 256;

interface SlotActivity {
	attaches: number;
	detaches: number;
	exposed: number;
	keyInert: number;
	peakViewers: number;
	surfaces: Set<PluginUiSurface>;
}

/**
 * One session epoch's UI chain. Invokes run on it one at a time, apart from
 * any other plugin call, so a slow slash command never freezes the tray.
 */
interface SessionUiChain {
	epoch: number;
	tail: Promise<unknown>;
	closing: boolean;
	closed?: Promise<void>;
	/** Ordinary invokes still waiting for their turn; closing answers them at once. */
	waiting: Set<() => void>;
	tokens: number;
	tokensAt: number;
	/** The slot each viewer last attached through, where its synthesized detach goes. */
	attachedSlots: Map<string, PluginUiSlot>;
	activity: Map<PluginUiSlot, SlotActivity>;
}

/**
 * A detach core synthesizes, at teardown or on a hub disconnect (carrying
 * that connection). It skips the rate limit, the closing checks and the
 * arrival deadline, and is dropped when its lease is gone or has moved to
 * another connection.
 */
interface SystemDetach {
	connectionId?: string;
}

interface PerformOptions {
	connectionId?: string;
	deadline?: Deadline;
	system?: SystemDetach;
}

/** Resolves `reached` once `ms` pass, unless cancelled first. */
class Deadline {
	expired = false;
	readonly reached: Promise<undefined>;
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(ms: number) {
		this.reached = new Promise((resolve) => {
			this.timer = setTimeout(() => {
				this.expired = true;
				resolve(undefined);
			}, ms);
			this.timer.unref?.();
		});
	}

	cancel(): void {
		clearTimeout(this.timer);
	}
}

function toInvokeResult(reply: PluginUiActionReply): PluginUiInvokeResult {
	if (reply?.outcome !== "refused") return { outcome: "ok" };
	return reply.reason === "stale" || reply.reason === "unsendable"
		? { outcome: "refused", reason: reply.reason }
		: { outcome: "refused" };
}

function knownSlot(value: unknown): PluginUiSlot | undefined {
	return readPluginUiSlotCatalog([value])[0];
}

function rawVerb(action: unknown): string | undefined {
	const verb = (action as { verb?: unknown } | null | undefined)?.verb;
	return typeof verb === "string" ? verb : undefined;
}

/**
 * Plugin UI slots for the sessions of one `LocalRuntimeHost`: the store,
 * per-session rate limits, and a per-session chain that serializes invokes
 * and bounds every reply to 2 × `invokeTimeoutMs`. Never throws to callers.
 */
export class PluginUiService implements PluginUiHostApi {
	private readonly store: PluginUiStore;
	private readonly chains = new Map<string, SessionUiChain>();
	private readonly dropReportedAt = new Map<string, number>();
	private readonly now: () => number;

	constructor(private readonly options: PluginUiServiceOptions) {
		this.now = options.now ?? Date.now;
		this.store = new PluginUiStore({
			emit: options.emit,
			onDrop: (drop) => this.reportDrop(drop),
			now: options.now,
		});
	}

	begin(sessionId: string, slots: readonly PluginUiSlot[]): number {
		const epoch = this.store.begin(sessionId, slots);
		this.chains.set(sessionId, {
			epoch,
			tail: Promise.resolve(),
			closing: false,
			waiting: new Set(),
			tokens: PLUGIN_UI_LIMITS.invokeBurst,
			tokensAt: this.now(),
			attachedSlots: new Map(),
			activity: new Map(),
		});
		return epoch;
	}

	activate(sessionId: string, epoch: number): void {
		this.store.activate(sessionId, epoch);
	}

	record(sessionId: string, epoch: number, push: PluginUiStorePush): void {
		this.store.record(sessionId, epoch, push);
	}

	clearPlugin(sessionId: string, plugin: string): void {
		this.store.clearPlugin(sessionId, plugin);
	}

	/**
	 * Refuses new invokes, detaches the remaining viewers, waits up to
	 * `closeWaitMs` for them and the in-flight invoke, then ends the epoch.
	 * Work still queued after that wait is dropped: the session's worker is
	 * torn down next, and a same-id restart may already own the id.
	 */
	closeSession(sessionId: string, epoch: number): Promise<void> {
		const chain = this.chains.get(sessionId);
		if (!chain || chain.epoch !== epoch) return Promise.resolve();
		chain.closed ??= this.close(sessionId, epoch, chain);
		return chain.closed;
	}

	/** Drops a closed chain once the session is gone. */
	release(sessionId: string, epoch: number): void {
		if (this.chains.get(sessionId)?.epoch === epoch) {
			this.chains.delete(sessionId);
		}
		this.store.end(sessionId, epoch);
	}

	async get(input: PluginUiGetInput): Promise<PluginUiStateEnvelope[]> {
		try {
			const sessionId = input?.sessionId;
			if (typeof sessionId !== "string" || !this.options.sessions(sessionId)) {
				return [];
			}
			return this.store.get(sessionId);
		} catch {
			return [];
		}
	}

	async invoke(
		input: PluginUiInvokeInput,
		viewer?: PluginUiViewer,
		connectionId?: string,
	): Promise<PluginUiInvokeResult> {
		const startedAt = this.now();
		const sessionId =
			typeof input?.sessionId === "string" ? input.sessionId : "";
		const slot = knownSlot(input?.slot);
		const caller = viewer ?? {
			id:
				typeof input?.viewerId === "string" && input.viewerId
					? input.viewerId
					: "local",
		};
		let result: PluginUiInvokeResult;
		let verb = rawVerb(input?.action);
		try {
			const parsed = parsePluginUiAction(input?.slot, input?.action);
			if (parsed.ok) {
				verb = parsed.action.verb;
				result = await this.dispatch(
					sessionId,
					parsed.slot,
					parsed.action,
					caller,
					connectionId,
				);
			} else {
				result = this.reply(sessionId, slot, { outcome: "rejected" });
			}
		} catch (error) {
			this.loggerFor(sessionId)?.debug("Plugin UI invoke failed", {
				sessionId,
				error,
			});
			result = { outcome: "unavailable" };
		}
		this.captureGesture(sessionId, slot, verb, result, startedAt, caller);
		return result;
	}

	detachViewer(viewerId: string, connectionId?: string): void {
		try {
			for (const sessionId of this.store.sessionsViewedBy(
				viewerId,
				connectionId,
			)) {
				const chain = this.chains.get(sessionId);
				const viewer = this.store.viewer(sessionId, viewerId);
				if (!chain || chain.closing || !viewer) continue;
				this.enqueueSystemDetach(chain, sessionId, viewer, { connectionId });
			}
		} catch (error) {
			this.options.logger?.debug("Plugin UI viewer detach failed", {
				viewerId,
				error,
			});
		}
	}

	private async dispatch(
		sessionId: string,
		slot: PluginUiSlot,
		action: PluginUiAction,
		viewer: PluginUiViewer,
		connectionId: string | undefined,
	): Promise<PluginUiInvokeResult> {
		const chain = this.chains.get(sessionId);
		if (chain && !this.takeToken(chain)) {
			return this.reply(sessionId, slot, { outcome: "rejected" });
		}
		const session = this.options.sessions(sessionId);
		if (!session || !chain || chain.closing) return { outcome: "unavailable" };
		if (!this.store.slots(sessionId).includes(slot)) {
			return this.reply(sessionId, slot, { outcome: "unavailable" }, chain);
		}
		const deadline = new Deadline(PLUGIN_UI_LIMITS.invokeTimeoutMs);
		let closedWhileWaiting!: () => void;
		const cancelled = new Promise<PluginUiInvokeResult>((resolve) => {
			closedWhileWaiting = () => resolve({ outcome: "unavailable" });
		});
		chain.waiting.add(closedWhileWaiting);
		const performed = this.enqueue(chain, () => {
			chain.waiting.delete(closedWhileWaiting);
			return this.perform(chain, session, sessionId, slot, action, viewer, {
				connectionId,
				deadline,
			});
		});
		const result = await Promise.race([performed, deadline.reached, cancelled]);
		deadline.cancel();
		chain.waiting.delete(closedWhileWaiting);
		return result ?? this.reply(sessionId, slot, { outcome: "timeout" }, chain);
	}

	/**
	 * Runs one action on its turn of the chain. Resolves undefined, without
	 * calling the plugin, when the action was skipped: an ordinary invoke
	 * whose arrival deadline passed, or a synthesized detach with no lease or
	 * whose epoch has ended.
	 */
	private async perform(
		chain: SessionUiChain,
		session: PluginUiSession,
		sessionId: string,
		slot: PluginUiSlot,
		action: PluginUiAction,
		viewer: PluginUiViewer,
		options: PerformOptions,
	): Promise<PluginUiInvokeResult | undefined> {
		const { deadline, system } = options;
		if (deadline?.expired) return undefined;
		if (!this.mayProceed(chain, sessionId, options)) {
			return system ? undefined : { outcome: "unavailable" };
		}
		const logger = session.config.logger ?? this.options.logger;
		try {
			const initialized = Promise.resolve().then(() =>
				session.agent.initializeExtensions(),
			);
			await (deadline
				? Promise.race([initialized, deadline.reached])
				: initialized);
		} catch (error) {
			// The registry already recorded the setup failure.
			logger?.debug("Plugin UI invoke found no initialized extensions", {
				sessionId,
				slot,
				error,
			});
			return this.reply(sessionId, slot, { outcome: "unavailable" }, chain);
		}
		if (deadline?.expired) return undefined;
		if (!this.mayProceed(chain, sessionId, options)) {
			return system ? undefined : { outcome: "unavailable" };
		}
		try {
			const handler = this.resolveHandler(session, sessionId, slot);
			if (!handler) {
				return this.reply(sessionId, slot, { outcome: "unavailable" }, chain);
			}
			deadline?.cancel();
			const presence = this.applyPresence(
				chain,
				sessionId,
				slot,
				action,
				viewer,
				options,
			);
			if (!presence) return undefined;
			const outcome = await this.callHandler(
				chain,
				sessionId,
				handler,
				action,
				{ sessionId, viewer: presence.viewer, viewers: presence.viewers },
				logger,
			);
			return this.reply(sessionId, slot, outcome, chain);
		} catch (error) {
			logger?.debug("Plugin UI invoke failed", { sessionId, slot, error });
			return this.reply(sessionId, slot, { outcome: "unavailable" }, chain);
		}
	}

	/** The slot's owner's handler; with no owner yet, the first registered one claims the slot. */
	private resolveHandler(
		session: PluginUiSession,
		sessionId: string,
		slot: PluginUiSlot,
	): (AgentExtensionUiSlot & { plugin: string }) | undefined {
		const registered = session.agent.getExtensionRegistry().uiSlots ?? [];
		const owner = this.store.owner(sessionId, slot);
		if (owner !== undefined) {
			return registered.find(
				(handler) => handler.plugin === owner && handler.slot === slot,
			);
		}
		const first = registered.find((handler) => handler.slot === slot);
		return first && this.store.claim(sessionId, slot, first.plugin)
			? first
			: undefined;
	}

	/** Records the viewer before the plugin hears the verb; undefined drops a synthesized detach. */
	private applyPresence(
		chain: SessionUiChain,
		sessionId: string,
		slot: PluginUiSlot,
		action: PluginUiAction,
		viewer: PluginUiViewer,
		options: PerformOptions,
	): { viewer: PluginUiViewer; viewers: number } | undefined {
		const activity = this.activityFor(chain, slot);
		if (action.verb === "attach") {
			const attached = { ...viewer, surface: action.surface };
			const before = this.store.viewers(sessionId).length;
			const viewers = this.store.attachViewer(
				sessionId,
				attached,
				options.connectionId,
			);
			chain.attachedSlots.set(viewer.id, slot);
			activity.attaches += 1;
			activity.surfaces.add(action.surface);
			activity.peakViewers = Math.max(activity.peakViewers, viewers);
			if (before === 0) {
				this.captureViewersChanged(sessionId, slot, viewers, action.surface);
			}
			return { viewer: attached, viewers };
		}
		const surface = this.store.viewer(sessionId, viewer.id)?.surface;
		const stamped = surface ? { ...viewer, surface } : { ...viewer };
		if (action.verb === "detach") {
			const viewers = this.store.detachViewer(
				sessionId,
				viewer.id,
				options.system?.connectionId,
			);
			if (viewers === undefined) {
				if (options.system) return undefined;
				return {
					viewer: stamped,
					viewers: this.store.viewers(sessionId).length,
				};
			}
			chain.attachedSlots.delete(viewer.id);
			activity.detaches += 1;
			if (viewers === 0) {
				this.captureViewersChanged(sessionId, slot, 0, stamped.surface);
			}
			return { viewer: stamped, viewers };
		}
		if (action.verb === "exposed") activity.exposed += 1;
		if (action.verb === "signal") activity.keyInert += 1;
		return { viewer: stamped, viewers: this.store.viewers(sessionId).length };
	}

	/** Core's own bound, in every plugin mode; a late result is discarded. */
	private async callHandler(
		chain: SessionUiChain,
		sessionId: string,
		handler: AgentExtensionUiSlot & { plugin: string },
		action: PluginUiAction,
		context: PluginUiActionContext,
		logger: BasicLogger | undefined,
	): Promise<PluginUiInvokeResult> {
		const bound = new Deadline(PLUGIN_UI_LIMITS.invokeTimeoutMs);
		try {
			const reply = await Promise.race([
				Promise.resolve().then(() => handler.onAction(action, context)),
				bound.reached,
			]);
			return bound.expired ? { outcome: "timeout" } : toInvokeResult(reply);
		} catch (error) {
			// Plugin error text stays in the session's debug log; the host gets a fixed outcome.
			logger?.debug("Plugin UI slot handler failed", {
				sessionId,
				slot: handler.slot,
				plugin: handler.plugin,
				error,
			});
			const cancelled = chain.closing || !this.options.sessions(sessionId);
			return { outcome: cancelled ? "unavailable" : "rejected" };
		} finally {
			bound.cancel();
		}
	}

	private enqueue<T>(
		chain: SessionUiChain,
		work: () => Promise<T>,
	): Promise<T> {
		const run = chain.tail.then(work);
		chain.tail = run.catch(() => undefined);
		return run;
	}

	private enqueueSystemDetach(
		chain: SessionUiChain,
		sessionId: string,
		viewer: PluginUiViewer,
		system: SystemDetach,
	): void {
		const session = this.options.sessions(sessionId);
		const slot =
			chain.attachedSlots.get(viewer.id) ?? this.store.slots(sessionId)[0];
		if (!session || !slot) return;
		void this.enqueue(chain, () =>
			this.perform(
				chain,
				session,
				sessionId,
				slot,
				{ verb: "detach" },
				viewer,
				{
					system,
				},
			),
		);
	}

	private async close(
		sessionId: string,
		epoch: number,
		chain: SessionUiChain,
	): Promise<void> {
		chain.closing = true;
		for (const closedWhileWaiting of chain.waiting) closedWhileWaiting();
		chain.waiting.clear();
		try {
			for (const viewer of this.store.viewers(sessionId)) {
				this.enqueueSystemDetach(chain, sessionId, viewer, {});
			}
			const bound = new Deadline(PLUGIN_UI_LIMITS.closeWaitMs);
			await Promise.race([chain.tail, bound.reached]);
			bound.cancel();
			this.captureSessionSummary(sessionId, chain);
		} catch (error) {
			this.loggerFor(sessionId)?.debug("Plugin UI session close failed", {
				sessionId,
				error,
			});
		} finally {
			this.store.end(sessionId, epoch);
		}
	}

	/**
	 * Whether queued work may still touch the store: its chain is the
	 * session's current one and its epoch has not ended. The store's presence
	 * and ownership calls take no epoch, so stale work would otherwise land in
	 * a same-id restart. Closing also stops ordinary invokes, not system ones.
	 */
	private mayProceed(
		chain: SessionUiChain,
		sessionId: string,
		options: PerformOptions,
	): boolean {
		return (
			this.isCurrent(chain, sessionId) && (!!options.system || !chain.closing)
		);
	}

	private isCurrent(chain: SessionUiChain, sessionId: string): boolean {
		return (
			this.chains.get(sessionId) === chain &&
			this.store.epoch(sessionId) === chain.epoch
		);
	}

	/**
	 * Adds the slot's current envelope and the session's epoch while the
	 * session is resident and the chain the reply belongs to is still its
	 * open chain. Before residency the store holds setup state back from
	 * every renderer, so a reply must not leak it either.
	 */
	private reply(
		sessionId: string,
		slot: PluginUiSlot | undefined,
		result: PluginUiInvokeResult,
		chain = this.chains.get(sessionId),
	): PluginUiInvokeResult {
		if (
			!chain ||
			chain.closing ||
			!this.isCurrent(chain, sessionId) ||
			!this.options.sessions(sessionId)
		) {
			return result;
		}
		const state = slot ? this.store.current(sessionId, slot) : undefined;
		return { ...result, ...(state ? { state } : {}), epoch: chain.epoch };
	}

	private takeToken(chain: SessionUiChain): boolean {
		const now = this.now();
		const refilled =
			((now - chain.tokensAt) / 1000) * PLUGIN_UI_LIMITS.invokesPerSecond;
		chain.tokens = Math.min(
			PLUGIN_UI_LIMITS.invokeBurst,
			chain.tokens + Math.max(0, refilled),
		);
		chain.tokensAt = now;
		if (chain.tokens < 1) return false;
		chain.tokens -= 1;
		return true;
	}

	private activityFor(chain: SessionUiChain, slot: PluginUiSlot): SlotActivity {
		let activity = chain.activity.get(slot);
		if (!activity) {
			activity = {
				attaches: 0,
				detaches: 0,
				exposed: 0,
				keyInert: 0,
				peakViewers: 0,
				surfaces: new Set(),
			};
			chain.activity.set(slot, activity);
		}
		return activity;
	}

	private loggerFor(sessionId: string): BasicLogger | undefined {
		return (
			this.options.sessions(sessionId)?.config.logger ?? this.options.logger
		);
	}

	private telemetryFor(sessionId: string): ITelemetryService | undefined {
		return (
			this.options.sessions(sessionId)?.config.telemetry ??
			this.options.telemetry
		);
	}

	/** Logs and counts a dropped push, at most once per (session, plugin, reason) a minute. */
	private reportDrop(drop: PluginUiStateDrop): void {
		const now = this.now();
		const key = JSON.stringify([drop.sessionId, drop.plugin, drop.reason]);
		const reportedAt = this.dropReportedAt.get(key);
		if (
			reportedAt !== undefined &&
			now - reportedAt < DROP_REPORT_INTERVAL_MS
		) {
			return;
		}
		if (this.dropReportedAt.size >= DROP_REPORTS_BEFORE_PRUNE) {
			for (const [reported, at] of this.dropReportedAt) {
				if (now - at >= DROP_REPORT_INTERVAL_MS) {
					this.dropReportedAt.delete(reported);
				}
			}
		}
		this.dropReportedAt.set(key, now);
		const logger = this.loggerFor(drop.sessionId);
		const metadata = {
			sessionId: drop.sessionId,
			plugin: drop.plugin,
			slot: drop.slot,
			reason: drop.reason,
		};
		if (drop.reason === "not_owner") {
			logger?.log("Plugin UI slot belongs to another plugin; state dropped", {
				...metadata,
				severity: "warn",
			});
		} else {
			logger?.debug("Plugin UI state dropped", metadata);
		}
		capturePluginUiStateDropped(this.telemetryFor(drop.sessionId), {
			plugin_name: drop.plugin,
			slot: knownSlot(drop.slot) ?? "unknown",
			reason: drop.reason,
		});
	}

	private captureGesture(
		sessionId: string,
		slot: PluginUiSlot | undefined,
		verb: string | undefined,
		result: PluginUiInvokeResult,
		startedAt: number,
		viewer: PluginUiViewer,
	): void {
		if (!slot || !verb || !GESTURE_VERBS.has(verb)) return;
		const plugin = this.store.owner(sessionId, slot);
		const surface =
			this.store.viewer(sessionId, viewer.id)?.surface ?? viewer.surface;
		capturePluginUiInvoke(this.telemetryFor(sessionId), {
			...(plugin ? { plugin_name: plugin } : {}),
			slot,
			verb,
			outcome: result.outcome,
			...(result.reason ? { reason: result.reason } : {}),
			latency_ms: Math.max(0, this.now() - startedAt),
			...(surface ? { surface } : {}),
		});
	}

	private captureViewersChanged(
		sessionId: string,
		slot: PluginUiSlot,
		count: number,
		surface: PluginUiSurface | undefined,
	): void {
		capturePluginUiViewersChanged(this.telemetryFor(sessionId), {
			slot,
			count,
			...(surface ? { surface } : {}),
		});
	}

	private captureSessionSummary(
		sessionId: string,
		chain: SessionUiChain,
	): void {
		const telemetry = this.telemetryFor(sessionId);
		for (const slot of this.store.slots(sessionId)) {
			const activity = this.activityFor(chain, slot);
			const plugin = this.store.owner(sessionId, slot);
			capturePluginUiSessionSummary(telemetry, {
				...(plugin ? { plugin_name: plugin } : {}),
				slot,
				attaches: activity.attaches,
				detaches: activity.detaches,
				exposed: activity.exposed,
				key_inert: activity.keyInert,
				peak_viewers: activity.peakViewers,
				surfaces: [...activity.surfaces].sort(),
			});
		}
	}
}
