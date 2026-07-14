/**
 * useCourse — webview hook that loads a course manifest for a given file path.
 *
 * Mechanism:
 *   1. webview posts { type: "aihydro-load-course", requestId, filePath }
 *   2. extension host (VscodeHtmlPreviewProvider) walks up from filePath looking
 *      for course.json (up to 5 levels), parses it, and posts back
 *      { type: "aihydro-course-loaded", requestId, course, courseRoot }.
 *   3. results are cached in-memory keyed by filePath so we don't refetch.
 *
 * Phase A: just loads + returns the manifest. The hook also computes
 * currentModuleId by matching the active filePath against module entries.
 */

import { useEffect, useState } from "react"
import { PLATFORM_CONFIG } from "../../config/platform.config"

export interface CourseAuthor {
	name: string
	affiliation?: string
	orcid?: string
}

export interface CourseModuleEntry {
	id: string
	/** path relative to courseRoot, e.g. "01-intro/module.html" */
	path: string
	title: string
	abstract?: string
	estimatedMinutes?: number
	prerequisites?: string[]
}

export interface CourseManifest {
	courseId: string
	title: string
	authors?: CourseAuthor[]
	version?: string
	license?: string
	abstract?: string
	modules: CourseModuleEntry[]
	kernel?: "isolated" | "shared"
	estimatedHours?: number
}

export interface CourseInfo {
	course: CourseManifest | null
	courseRoot: string | null
	currentModuleId: string | null
	/** True while a fetch is in-flight (initial load) */
	loading: boolean
}

interface CacheEntry {
	course: CourseManifest | null
	courseRoot: string | null
}

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<CacheEntry>>()

function fetchCourseForFile(filePath: string): Promise<CacheEntry> {
	const cached = cache.get(filePath)
	if (cached) return Promise.resolve(cached)
	const existing = inflight.get(filePath)
	if (existing) return existing

	const requestId = `course-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
	const promise = new Promise<CacheEntry>((resolve) => {
		const cleanup = () => {
			window.clearTimeout(timeout)
			window.removeEventListener("message", onMessage)
			inflight.delete(filePath)
		}
		const finish = (entry: CacheEntry) => {
			cache.set(filePath, entry)
			cleanup()
			resolve(entry)
		}
		const timeout = window.setTimeout(() => {
			// Host didn't respond — treat as "no course" and cache that
			finish({ course: null, courseRoot: null })
		}, 4000)
		const onMessage = (e: MessageEvent) => {
			const d = e.data
			if (!d || d.type !== "aihydro-course-loaded" || d.requestId !== requestId) return
			finish({
				course: (d.course as CourseManifest | null) ?? null,
				courseRoot: (d.courseRoot as string | null) ?? null,
			})
		}
		window.addEventListener("message", onMessage)
		try {
			PLATFORM_CONFIG.postMessage({ type: "aihydro-load-course", requestId, filePath })
		} catch (err) {
			console.warn("[useCourse] postMessage failed:", err)
			finish({ course: null, courseRoot: null })
		}
	})
	inflight.set(filePath, promise)
	return promise
}

/** Force-refresh the cached course for a path (e.g. after the user edits course.json) */
export function invalidateCourseCache(filePath?: string): void {
	if (filePath) cache.delete(filePath)
	else cache.clear()
}

/**
 * Normalise a path to forward slashes and collapse repeated separators
 * so we can compare extension-host paths (which may use platform separators)
 * against module.path entries (which always use forward slashes by convention).
 */
function normalizePath(p: string): string {
	return p.replace(/\\/g, "/").replace(/\/+/g, "/")
}

function resolveCurrentModuleId(course: CourseManifest, courseRoot: string, filePath: string): string | null {
	const np = normalizePath(filePath)
	const nr = normalizePath(courseRoot).replace(/\/$/, "")
	for (const m of course.modules) {
		const candidate = normalizePath(`${nr}/${m.path}`)
		if (np === candidate || np.endsWith(`/${normalizePath(m.path)}`)) {
			return m.id
		}
	}
	return null
}

export function useCourse(filePath: string | undefined | null): CourseInfo {
	const [entry, setEntry] = useState<CacheEntry | null>(() => {
		if (!filePath) return null
		return cache.get(filePath) ?? null
	})
	const [loading, setLoading] = useState<boolean>(() => {
		if (!filePath) {
			return false
		}
		return !cache.has(filePath)
	})

	useEffect(() => {
		if (!filePath) {
			setEntry(null)
			setLoading(false)
			return
		}
		const cached = cache.get(filePath)
		if (cached) {
			setEntry(cached)
			setLoading(false)
			return
		}
		setLoading(true)
		let cancelled = false
		fetchCourseForFile(filePath)
			.then((result) => {
				if (cancelled) return
				setEntry(result)
				setLoading(false)
			})
			.catch((err) => {
				console.warn("[useCourse] fetch failed:", err)
				if (!cancelled) {
					setEntry({ course: null, courseRoot: null })
					setLoading(false)
				}
			})
		return () => {
			cancelled = true
		}
	}, [filePath])

	const course = entry?.course ?? null
	const courseRoot = entry?.courseRoot ?? null
	const currentModuleId = course && courseRoot && filePath ? resolveCurrentModuleId(course, courseRoot, filePath) : null

	return { course, courseRoot, currentModuleId, loading }
}

/**
 * Helper for navigation: resolve an absolute file path from a course root
 * and a module's relative path. Used by both CourseHeader prev/next buttons
 * and CourseNavigator click handlers.
 */
export function resolveModuleFilePath(courseRoot: string, modulePath: string): string {
	// Preserve the platform separator pattern of courseRoot — most workspaces
	// use forward slashes anyway, and the extension host normalises on read.
	if (courseRoot.endsWith("/") || courseRoot.endsWith("\\")) {
		return courseRoot + modulePath
	}
	const sep = courseRoot.includes("\\") && !courseRoot.includes("/") ? "\\" : "/"
	return `${courseRoot}${sep}${modulePath}`
}
