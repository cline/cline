import {
	type BasicLogger,
	type ITelemetryService,
	PLUGIN_UI_LIMITS,
	type PluginUiAction,
	type PluginUiGetInput,
	type PluginUiInvokeInput,
	type PluginUiInvokeResult,
	type PluginUiSlot,
	type PluginUiStateEnvelope,
	type PluginUiViewer,
	parsePluginUiAction,
} from "@cline/shared";
import type { PluginUiHostApi } from "../../../../services/plugin-ui-api";
import type { CoreSessionConfig } from "../../../../types/config";
import type { SessionRuntime } from "../../../orchestration/session-runtime-orchestrator";
import { applyPresence } from "./presence";
import {
	createSessionUiChain,
	Deadline,
	enqueue,
	findQueuedAttach,
	type PerformOptions,
	type SessionUiChain,
	type SystemDetach,
	takeToken,
} from "./session-chain";
import { callSlotHandler, knownSlot, resolveSlotHandler } from "./slot-handler";
import { PluginUiStore, type PluginUiStorePush } from "./store";
import { PluginUiTelemetry } from "./telemetry";

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
	private readonly now: () => number;
	private readonly telemetry: PluginUiTelemetry;

	constructor(private readonly options: PluginUiServiceOptions) {
		this.now = options.now ?? Date.now;
		this.store = new PluginUiStore({
			emit: options.emit,
			onDrop: (drop) => this.telemetry.reportDrop(drop),
			now: options.now,
		});
		this.telemetry = new PluginUiTelemetry({
			store: this.store,
			now: () => this.now(),
			loggerFor: (sessionId) => this.loggerFor(sessionId),
			telemetryFor: (sessionId) =>
				options.sessions(sessionId)?.config.telemetry ?? options.telemetry,
		});
	}

	begin(sessionId: string, slots: readonly PluginUiSlot[]): number {
		const epoch = this.store.begin(sessionId, slots);
		this.chains.set(sessionId, createSessionUiChain(epoch, this.now()));
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
		this.telemetry.captureGesture(
			sessionId,
			slot,
			verb,
			result,
			startedAt,
			caller,
		);
		return result;
	}

	detachViewer(viewerId: string, connectionId?: string): void {
		try {
			const leased = new Set(
				this.store.sessionsViewedBy(viewerId, connectionId),
			);
			for (const [sessionId, chain] of this.chains) {
				if (chain.closing) continue;
				const viewer = leased.has(sessionId)
					? this.store.viewer(sessionId, viewerId)
					: findQueuedAttach(chain, viewerId, connectionId)?.viewer;
				if (!viewer) continue;
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
		if (chain && !takeToken(chain, this.now())) {
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
		const queuedAttach =
			action.verb === "attach" ? { viewer, connectionId } : undefined;
		if (queuedAttach) chain.queuedAttaches.add(queuedAttach);
		const performed = enqueue(chain, async () => {
			chain.waiting.delete(closedWhileWaiting);
			try {
				return await this.perform(
					chain,
					session,
					sessionId,
					slot,
					action,
					viewer,
					{ connectionId, deadline },
				);
			} finally {
				if (queuedAttach) chain.queuedAttaches.delete(queuedAttach);
			}
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
			const handler = resolveSlotHandler(
				this.store,
				session.agent.getExtensionRegistry().uiSlots ?? [],
				sessionId,
				slot,
			);
			if (!handler) {
				return this.reply(sessionId, slot, { outcome: "unavailable" }, chain);
			}
			deadline?.cancel();
			const presence = applyPresence(
				{ store: this.store, telemetry: this.telemetry },
				chain,
				sessionId,
				slot,
				action,
				viewer,
				options,
			);
			if (!presence) return undefined;
			const outcome = await callSlotHandler(
				handler,
				action,
				{ sessionId, viewer: presence.viewer, viewers: presence.viewers },
				{
					sessionId,
					logger,
					cancelled: () => chain.closing || !this.options.sessions(sessionId),
				},
			);
			return this.reply(sessionId, slot, outcome, chain);
		} catch (error) {
			logger?.debug("Plugin UI invoke failed", { sessionId, slot, error });
			return this.reply(sessionId, slot, { outcome: "unavailable" }, chain);
		}
	}

	/** The slot is read on the detach's turn, so a queued attach ahead of it has recorded its own. */
	private enqueueSystemDetach(
		chain: SessionUiChain,
		sessionId: string,
		viewer: PluginUiViewer,
		system: SystemDetach,
	): void {
		const session = this.options.sessions(sessionId);
		if (!session) return;
		void enqueue(chain, async () => {
			const slot =
				chain.attachedSlots.get(viewer.id) ?? this.store.slots(sessionId)[0];
			if (!slot) return undefined;
			return this.perform(
				chain,
				session,
				sessionId,
				slot,
				{ verb: "detach" },
				viewer,
				{ system },
			);
		});
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
			this.telemetry.captureSessionSummary(sessionId, chain);
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

	private loggerFor(sessionId: string): BasicLogger | undefined {
		return (
			this.options.sessions(sessionId)?.config.logger ?? this.options.logger
		);
	}
}
