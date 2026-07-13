export const COURSE_NAV_INTENT_MAX_AGE_MS = 10_000

export interface CourseNavigationIntent {
	courseId: string
	moduleId: string
	reason: string
	timestamp: number
}

export interface CourseNavigationIntentDecision {
	lastTimestamp: number
	intent?: CourseNavigationIntent
}

/** Validate replay/freshness before an agent navigation intent reaches UI state. */
export function resolveCourseNavigationIntent(
	value: unknown,
	lastTimestamp: number,
	nowMs = Date.now(),
): CourseNavigationIntentDecision {
	if (!value || typeof value !== "object") return { lastTimestamp }
	const raw = value as Record<string, unknown>
	const timestamp = typeof raw.timestamp === "number" && Number.isFinite(raw.timestamp) ? raw.timestamp : 0
	if (timestamp <= lastTimestamp) return { lastTimestamp }
	if (nowMs - timestamp > COURSE_NAV_INTENT_MAX_AGE_MS) return { lastTimestamp: timestamp }

	const moduleId = typeof raw.moduleId === "string" ? raw.moduleId.trim() : ""
	if (!moduleId) return { lastTimestamp: timestamp }
	return {
		lastTimestamp: timestamp,
		intent: {
			courseId: typeof raw.courseId === "string" ? raw.courseId : "",
			moduleId,
			reason: typeof raw.reason === "string" ? raw.reason : "",
			timestamp,
		},
	}
}
