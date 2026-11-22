import type { Mode } from "./storage/types"

/**
 * One row of the "Scheduled Tasks" queue: a chat the user configured to start
 * when a task completes. The queue is a persisted array whose ORDER IS THE RUN
 * ORDER — the head is started by the next genuine completion, then the next one
 * by the completion after that, and so on (see sdk-auto-next-task-coordinator.ts).
 * `scheduledTasksPaused` gates the whole queue without discarding it.
 */
export interface ScheduledTask {
	/** Stable id so edits, reorders and deletes address one row unambiguously. */
	id: string
	/**
	 * First message of the scheduled chat. Empty means "no extra instruction",
	 * in which case the chat is opened with the previous-task summary alone.
	 */
	message: string
	/** Plan/Act mode the scheduled chat runs in. */
	mode: Mode
	/** Carry a summary of the completed task into the scheduled chat. */
	includeSummary: boolean
	/**
	 * Provider this chat runs on. Empty/undefined means "whatever is configured
	 * when the chat starts", so a queue can mix pinned and inherited models.
	 */
	providerId?: string
	/** Model id for `providerId`; ignored when no provider is pinned. */
	modelId?: string
	/** Creation time, for display only — the run order is the array order. */
	createdAt: number
}

/**
 * Upper bound on the persisted queue. Every entry becomes a future chat, so an
 * unbounded list would be both unusable in the view and an unbounded amount of
 * state to carry across window reloads.
 */
export const MAX_SCHEDULED_TASKS = 25

/** Ids are generated in the extension so rows written by different hosts never collide. */
export function createScheduledTaskId(): string {
	return `scheduled-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Guards one persisted entry: state survives downgrades and window reloads, so
 * anything unexpected must be treated as "not a scheduled task" rather than
 * half-trusted.
 */
export function isScheduledTask(value: unknown): value is ScheduledTask {
	if (typeof value !== "object" || value === null) {
		return false
	}
	const candidate = value as Record<string, unknown>
	if (
		typeof candidate.id !== "string" ||
		!candidate.id ||
		typeof candidate.message !== "string" ||
		(candidate.mode !== "plan" && candidate.mode !== "act") ||
		typeof candidate.includeSummary !== "boolean"
	) {
		return false
	}
	return (
		(candidate.providerId === undefined || typeof candidate.providerId === "string") &&
		(candidate.modelId === undefined || typeof candidate.modelId === "string")
	)
}

/**
 * Normalizes a persisted or wire-supplied queue: drops entries it cannot trust,
 * drops duplicate ids (a duplicated row would run the same chat twice), trims
 * the provider/model pins to `undefined` when blank, and caps the length.
 */
export function normalizeScheduledTasks(value: unknown): ScheduledTask[] {
	if (!Array.isArray(value)) {
		return []
	}
	const seen = new Set<string>()
	const tasks: ScheduledTask[] = []
	for (const entry of value) {
		if (!isScheduledTask(entry) || seen.has(entry.id)) {
			continue
		}
		seen.add(entry.id)
		const providerId = entry.providerId?.trim()
		const modelId = entry.modelId?.trim()
		tasks.push({
			id: entry.id,
			message: entry.message,
			mode: entry.mode,
			includeSummary: entry.includeSummary,
			...(providerId ? { providerId } : {}),
			...(providerId && modelId ? { modelId } : {}),
			createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now(),
		})
		if (tasks.length >= MAX_SCHEDULED_TASKS) {
			break
		}
	}
	return tasks
}
