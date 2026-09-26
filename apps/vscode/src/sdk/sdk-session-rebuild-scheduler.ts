import { Logger } from "@/shared/services/Logger"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"

export type SessionRebuildReason = "provider" | "mcpTools" | "terminalExecutionMode" | "checkpoints"

export interface SdkSessionRebuildSchedulerOptions {
	sessions: Pick<SdkSessionLifecycle, "getActiveSession">
}

export interface SessionRebuildContext {
	/**
	 * True until a newer request for the same reason arrives. A superseded
	 * rebuild should stop before replacing the session, or leave work it has
	 * not yet started to the newer rebuild, which runs next in the same drain.
	 */
	isCurrent: () => boolean
}

interface ScheduledRebuild {
	run: (context: SessionRebuildContext) => Promise<void>
	generation: number
}

/** Serializes passive session rebuilds and drains them only while the session is idle. */
export class SdkSessionRebuildScheduler {
	private readonly pending = new Map<SessionRebuildReason, ScheduledRebuild>()
	private drainInFlight: Promise<void> | undefined
	private readonly latestGeneration = new Map<SessionRebuildReason, number>()

	constructor(private readonly options: SdkSessionRebuildSchedulerOptions) {}

	/**
	 * Queues a rebuild, replacing any queued rebuild for the same reason. A
	 * rebuild for the same reason that is already running is superseded: its
	 * context.isCurrent() turns false and this request runs after it.
	 */
	request(reason: SessionRebuildReason, run: (context: SessionRebuildContext) => Promise<void>): void {
		const generation = (this.latestGeneration.get(reason) ?? 0) + 1
		this.latestGeneration.set(reason, generation)
		this.pending.set(reason, { run, generation })
		this.drainIfIdle()
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
			this.pending.clear()
			return operation()
		})
	}

	sessionBecameIdle(): void {
		this.drainIfIdle()
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

				try {
					await rebuild.run({ isCurrent: () => rebuild.generation === this.latestGeneration.get(reason) })
				} catch (error) {
					Logger.error(`[SdkController] Failed scheduled ${reason} session rebuild:`, error)
				}
			}
		}

		this.drainInFlight = drain().finally(() => {
			this.drainInFlight = undefined
			this.drainIfIdle()
		})
	}
}
