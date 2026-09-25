import { Logger } from "@/shared/services/Logger"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"

export type SessionRebuildReason = "provider" | "mcpTools" | "terminalExecutionMode" | "checkpoints"

export interface SdkSessionRebuildSchedulerOptions {
	sessions: Pick<SdkSessionLifecycle, "getActiveSession">
}

export interface SessionRebuildContext {
	isCurrent: () => boolean
}

/** Serializes passive session rebuilds and drains them only while the session is idle. */
export class SdkSessionRebuildScheduler {
	private readonly pending = new Map<SessionRebuildReason, (context: SessionRebuildContext) => Promise<void>>()
	private drainInFlight: Promise<void> | undefined
	private activeReason: SessionRebuildReason | undefined
	private settledWaiters: Array<{ reason?: SessionRebuildReason; resolve: () => void }> = []
	private readonly cancellationGeneration = new Map<SessionRebuildReason, number>()

	constructor(private readonly options: SdkSessionRebuildSchedulerOptions) {}

	request(reason: SessionRebuildReason, rebuild: (context: SessionRebuildContext) => Promise<void>): void {
		this.pending.set(reason, rebuild)
		this.drainIfIdle()
	}

	cancel(reason: SessionRebuildReason): void {
		this.cancellationGeneration.set(reason, (this.cancellationGeneration.get(reason) ?? 0) + 1)
		this.pending.delete(reason)
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

				try {
					await rebuild({ isCurrent: () => generation === (this.cancellationGeneration.get(reason) ?? 0) })
				} catch (error) {
					Logger.error(`[SdkController] Failed scheduled ${reason} session rebuild:`, error)
				} finally {
					this.activeReason = undefined
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
