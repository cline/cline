/**
 * useCourseProgress — webview hook for per-course persisted progress.
 *
 * Counterpart to useCourse: where useCourse loads the static course manifest,
 * useCourseProgress loads (and mutates) the per-user progress state for that
 * course. State lives on disk at ~/.aihydro/course_progress/<courseId>.json
 * — see src/services/htmlPreview/courseProgressStore.ts.
 *
 * Mutations (markComplete / markUncomplete / reset / setCurrent) round-trip
 * through the extension host, then update local state with the freshly-saved
 * snapshot returned by the host. This keeps the webview as a "view" over the
 * canonical disk state, never the source of truth.
 *
 * The hook also exposes derived helpers (isCompleted, canAccess) so prerequisite
 * gating logic lives in one place and both CourseHeader and CourseNavigator
 * stay declarative.
 */

import { useCallback, useEffect, useState } from "react"
import { PLATFORM_CONFIG } from "../../config/platform.config"
import type { CourseManifest, CourseModuleEntry } from "./useCourse"

export interface ModuleCompletion {
	completedAt: number
	timeSpentMs?: number
}

export interface CourseProgress {
	courseId: string
	startedAt: number
	lastVisitedAt: number
	currentModuleId: string | null
	completed: Record<string, ModuleCompletion>
}

export type ProgressAction = "load" | "complete" | "uncomplete" | "reset" | "set-current"

interface ProgressRequest {
	action: ProgressAction
	courseId: string
	moduleId?: string | null
	timeSpentMs?: number
}

const COURSE_PROGRESS_CHANGED_EVENT = "aihydro-course-progress-changed"

function publishProgress(progress: CourseProgress): void {
	window.dispatchEvent(
		new CustomEvent(COURSE_PROGRESS_CHANGED_EVENT, {
			detail: { courseId: progress.courseId, progress },
		}),
	)
}

function emptyProgress(courseId: string): CourseProgress {
	const now = Date.now()
	return { courseId, startedAt: now, lastVisitedAt: now, currentModuleId: null, completed: {} }
}

function sendProgress(req: ProgressRequest): Promise<CourseProgress | null> {
	const requestId = `prog-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
	return new Promise((resolve) => {
		const cleanup = () => {
			window.clearTimeout(timeout)
			window.removeEventListener("message", onMessage)
		}
		const timeout = window.setTimeout(() => {
			cleanup()
			resolve(null)
		}, 4000)
		const onMessage = (e: MessageEvent) => {
			const d = e.data
			if (!d || d.type !== "aihydro-course-progress-result" || d.requestId !== requestId) {
				return
			}
			cleanup()
			resolve((d.progress as CourseProgress | null) ?? null)
		}
		window.addEventListener("message", onMessage)
		try {
			PLATFORM_CONFIG.postMessage({
				type: "aihydro-course-progress",
				requestId,
				...req,
			})
		} catch (err) {
			console.warn("[useCourseProgress] postMessage failed:", err)
			cleanup()
			resolve(null)
		}
	})
}

export interface CourseProgressHook {
	progress: CourseProgress
	loading: boolean
	isCompleted: (moduleId: string) => boolean
	/** True if this module's prerequisites are all completed (or it has none) */
	canAccess: (module: CourseModuleEntry) => boolean
	/** Module IDs blocking access to the given module (empty if accessible) */
	missingPrerequisites: (module: CourseModuleEntry) => string[]
	/** 0–100 percentage of completed modules */
	completionPct: number
	markComplete: (moduleId: string, timeSpentMs?: number) => Promise<void>
	markUncomplete: (moduleId: string) => Promise<void>
	reset: () => Promise<void>
	setCurrent: (moduleId: string | null) => Promise<void>
	/** Force-refresh from disk (e.g. after agent updates progress out-of-band) */
	refresh: () => Promise<void>
}

export function useCourseProgress(course: CourseManifest | null): CourseProgressHook {
	const courseId = course?.courseId ?? ""
	const [progress, setProgress] = useState<CourseProgress>(() => emptyProgress(courseId))
	const [loading, setLoading] = useState<boolean>(false)

	const refresh = useCallback(async () => {
		if (!courseId) {
			setProgress(emptyProgress(""))
			return
		}
		setLoading(true)
		const fresh = await sendProgress({ action: "load", courseId })
		if (fresh) {
			setProgress(fresh)
		}
		setLoading(false)
	}, [courseId])

	useEffect(() => {
		if (!courseId) {
			setProgress(emptyProgress(""))
			setLoading(false)
			return
		}
		let cancelled = false
		setLoading(true)
		sendProgress({ action: "load", courseId }).then((fresh) => {
			if (cancelled) {
				return
			}
			if (fresh) {
				setProgress(fresh)
			} else {
				setProgress(emptyProgress(courseId))
			}
			setLoading(false)
		})
		return () => {
			cancelled = true
		}
	}, [courseId])

	useEffect(() => {
		const onProgressChanged = (event: Event) => {
			const detail = (event as CustomEvent<{ courseId?: string; progress?: CourseProgress }>).detail
			if (detail?.courseId === courseId && detail.progress) {
				setProgress(detail.progress)
			}
		}
		window.addEventListener(COURSE_PROGRESS_CHANGED_EVENT, onProgressChanged)
		return () => window.removeEventListener(COURSE_PROGRESS_CHANGED_EVENT, onProgressChanged)
	}, [courseId])

	const markComplete = useCallback(
		async (moduleId: string, timeSpentMs?: number) => {
			if (!courseId) {
				return
			}
			const fresh = await sendProgress({ action: "complete", courseId, moduleId, timeSpentMs })
			if (fresh) {
				setProgress(fresh)
				publishProgress(fresh)
			}
		},
		[courseId],
	)

	const markUncomplete = useCallback(
		async (moduleId: string) => {
			if (!courseId) {
				return
			}
			const fresh = await sendProgress({ action: "uncomplete", courseId, moduleId })
			if (fresh) {
				setProgress(fresh)
				publishProgress(fresh)
			}
		},
		[courseId],
	)

	const reset = useCallback(async () => {
		if (!courseId) {
			return
		}
		const fresh = await sendProgress({ action: "reset", courseId })
		if (fresh) {
			setProgress(fresh)
			publishProgress(fresh)
		}
	}, [courseId])

	const setCurrent = useCallback(
		async (moduleId: string | null) => {
			if (!courseId) {
				return
			}
			const fresh = await sendProgress({ action: "set-current", courseId, moduleId })
			if (fresh) {
				setProgress(fresh)
				publishProgress(fresh)
			}
		},
		[courseId],
	)

	const isCompleted = useCallback((moduleId: string) => !!progress.completed[moduleId], [progress.completed])

	const missingPrerequisites = useCallback(
		(mod: CourseModuleEntry): string[] => {
			if (!mod.prerequisites || mod.prerequisites.length === 0) {
				return []
			}
			return mod.prerequisites.filter((id) => !progress.completed[id])
		},
		[progress.completed],
	)

	const canAccess = useCallback((mod: CourseModuleEntry) => missingPrerequisites(mod).length === 0, [missingPrerequisites])

	// Only count completions for module IDs that actually exist in the current
	// course — stale entries from renamed/removed modules must not inflate the count.
	const validCompletedCount = course?.modules.filter((m) => !!progress.completed[m.id]).length ?? 0

	const completionPct =
		course && course.modules.length > 0 ? Math.round((validCompletedCount / course.modules.length) * 100) : 0

	return {
		progress,
		loading,
		isCompleted,
		canAccess,
		missingPrerequisites,
		completionPct,
		markComplete,
		markUncomplete,
		reset,
		setCurrent,
		refresh,
	}
}
