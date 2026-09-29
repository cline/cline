import { Logger } from "@/shared/services/Logger"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"

export type SessionRebuildReason = "provider" | "mcpTools" | "terminalExecutionMode" | "checkpoints"

export interface SdkSessionRebuildSchedulerOptions {
	sessions: Pick<SdkSessionLifecycle, "getActiveSession">
}

/**
 * A rebuild replaces the session, so it may only run between turns. Core
 * drains its own prompt queue the moment a turn ends, so a session with
 * queued prompts is about to run again: treat it as busy until Core has
 * emptied the queue.
 */
function isIdle(session: ReturnType<SdkSessionLifecycle["getActiveSession"]>): boolean {
	return session !== undefined && !session.isRunning && session.queuedPromptCount === 0
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

/** Serializes passive session rebuilds and drains them only while the session is idle (see isIdle). */
export class SdkSessionRebuildScheduler {
	private readonly pending = new Map<SessionRebuildReason, ScheduledRebuild>()
	private drainInFlight: Promise<void> | undefined
	private readonly stateWaiters = new Set<() => void>()
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

	cancel(reason: SessionRebuildReason): void {
		if (this.pending.delete(reason)) {
			this.notifyStateChanged()
		}
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
			this.notifyStateChanged()
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
		this.notifyStateChanged()
	}

	/** Wakes settlement barriers when the lifecycle removes the active session. */
	activeSessionRemoved(): void {
		this.notifyStateChanged()
	}

	async waitUntilSettled(): Promise<void> {
		while (true) {
			if (this.drainInFlight) {
				await this.drainInFlight
				continue
			}
			if (this.pending.size === 0) {
				return
			}

			const activeSession = this.options.sessions.getActiveSession()
			if (!activeSession) {
				// There is no existing session to rebuild. A future session will
				// start from current configuration, so discard callbacks bound to
				// the vanished session instead of running them against the future one.
				this.pending.clear()
				this.notifyStateChanged()
				return
			}
			if (isIdle(activeSession)) {
				this.drainIfIdle()
				continue
			}

			// Registration is synchronous with the state checks above, so an idle
			// or cancel notification cannot be lost between checking and waiting.
			await new Promise<void>((resolve) => this.stateWaiters.add(resolve))
		}
	}

	private notifyStateChanged(): void {
		for (const resolve of this.stateWaiters) {
			resolve()
		}
		this.stateWaiters.clear()
	}

	private drainIfIdle(): void {
		if (this.drainInFlight || this.pending.size === 0 || !isIdle(this.options.sessions.getActiveSession())) {
			return
		}

		const drain = async (): Promise<void> => {
			while (this.pending.size > 0) {
				const activeSession = this.options.sessions.getActiveSession()
				if (!activeSession) {
					this.pending.clear()
					return
				}
				if (!isIdle(activeSession)) {
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
			this.notifyStateChanged()
		})
	}
}
