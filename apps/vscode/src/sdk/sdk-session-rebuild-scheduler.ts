import { Logger } from "@/shared/services/Logger"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"

export type SessionRebuildReason = "provider" | "mcpTools" | "terminalExecutionMode" | "checkpoints"

export interface SdkSessionRebuildSchedulerOptions {
	sessions: Pick<SdkSessionLifecycle, "getActiveSession">
}

export interface SessionRebuildContext {
	isCurrent: () => boolean
}

interface ScheduledRebuild {
	run: (context: SessionRebuildContext) => Promise<void>
	onCancel?: () => void
}

/** Serializes passive session rebuilds and drains them only while the session is idle. */
export class SdkSessionRebuildScheduler {
	private readonly pending = new Map<SessionRebuildReason, ScheduledRebuild>()
	private drainInFlight: Promise<void> | undefined
	private activeReason: SessionRebuildReason | undefined
	private activeRebuild: ScheduledRebuild | undefined
	private settledWaiters: Array<{ reason?: SessionRebuildReason; resolve: () => void }> = []
	private readonly cancellationGeneration = new Map<SessionRebuildReason, number>()

	constructor(private readonly options: SdkSessionRebuildSchedulerOptions) {}

	request(reason: SessionRebuildReason, run: (context: SessionRebuildContext) => Promise<void>, onCancel?: () => void): void {
		const previous = this.pending.get(reason)
		if (previous?.onCancel !== onCancel) {
			previous?.onCancel?.()
		}
		this.pending.set(reason, { run, onCancel })
		this.drainIfIdle()
	}

	cancel(reason: SessionRebuildReason): void {
		this.cancellationGeneration.set(reason, (this.cancellationGeneration.get(reason) ?? 0) + 1)
		this.pending.get(reason)?.onCancel?.()
		this.pending.delete(reason)
		if (this.activeReason === reason) {
			this.activeRebuild?.onCancel?.()
		}
		this.resolveSettledWaitersIfSettled()
	}

	hasPendingRebuild(reason?: SessionRebuildReason): boolean {
		return reason
			? this.pending.has(reason) || this.activeReason === reason
			: this.pending.size > 0 || this.drainInFlight !== undefined
	}

	async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
		while (this.drainInFlight) {
			await this.drainInFlight
		}
		let resolveExclusive: () => void = () => {}
		const exclusive = new Promise<void>((resolve) => {
			resolveExclusive = resolve
		})
		this.drainInFlight = exclusive
		try {
			return await operation()
		} finally {
			resolveExclusive()
			if (this.drainInFlight === exclusive) {
				this.drainInFlight = undefined
			}
			this.drainIfIdle()
			this.resolveSettledWaitersIfSettled()
		}
	}

	/**
	 * Moves the displayed task at the session-rebuild consistency boundary.
	 * Queued rebuilds belong to the outgoing session, so the transition drops
	 * them before ending that session. Rebuilds requested during the transition
	 * remain queued until the new task view is complete.
	 */
	async runTaskTransition<T>(operation: () => Promise<T>): Promise<T> {
		return this.runExclusive(async () => {
			this.cancelPending()
			return operation()
		})
	}

	sessionBecameIdle(): void {
		this.drainIfIdle()
	}

	async waitUntilSettled(reason?: SessionRebuildReason): Promise<void> {
		if (!this.hasPendingRebuild(reason)) {
			return
		}
		await new Promise<void>((resolve) => this.settledWaiters.push({ reason, resolve }))
	}

	private drainIfIdle(): void {
		const activeSession = this.options.sessions.getActiveSession()
		if (this.drainInFlight || this.pending.size === 0 || !activeSession || activeSession.isRunning) {
			return
		}

		const drain = async (): Promise<void> => {
			while (this.pending.size > 0) {
				const activeSession = this.options.sessions.getActiveSession()
				if (!activeSession) {
					this.pending.clear()
					return
				}
				if (activeSession.isRunning) {
					return
				}

				const next = this.pending.entries().next().value
				if (!next) {
					return
				}
				const [reason, rebuild] = next
				this.pending.delete(reason)
				const generation = this.cancellationGeneration.get(reason) ?? 0
				this.activeReason = reason
				this.activeRebuild = rebuild

				try {
					await rebuild.run({ isCurrent: () => generation === (this.cancellationGeneration.get(reason) ?? 0) })
				} catch (error) {
					Logger.error(`[SdkController] Failed scheduled ${reason} session rebuild:`, error)
				} finally {
					this.activeReason = undefined
					this.activeRebuild = undefined
					this.resolveSettledWaitersIfSettled()
				}
			}
		}

		this.drainInFlight = drain().finally(() => {
			this.drainInFlight = undefined
			this.drainIfIdle()
			this.resolveSettledWaitersIfSettled()
		})
	}

	private cancelPending(): void {
		for (const reason of [...this.pending.keys()]) {
			this.cancel(reason)
		}
	}

	private resolveSettledWaitersIfSettled(): void {
		const remaining: typeof this.settledWaiters = []
		for (const waiter of this.settledWaiters) {
			if (this.hasPendingRebuild(waiter.reason)) {
				remaining.push(waiter)
			} else {
				waiter.resolve()
			}
		}
		this.settledWaiters = remaining
	}
}
