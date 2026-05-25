/**
 * Course Progress Store — extension-host side.
 *
 * Persists per-course learning progress to disk so a student can close VS Code
 * and resume exactly where they left off. One JSON file per course at:
 *
 *   ~/.aihydro/course_progress/<courseId>.json
 *
 * Atomic writes (write-then-rename) keep the file consistent even if VS Code
 * crashes mid-write. The store does NOT do its own caching — callers fetch
 * the current snapshot every time. With per-course files keyed by courseId,
 * the cost is one small disk read per navigation, which is negligible.
 *
 * Phase C (agent integration) will expose this same surface via MCP tools so
 * the agent can read student progress without going through the webview.
 */
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

const PROGRESS_DIR = path.join(os.homedir(), ".aihydro", "course_progress")

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

function emptyProgress(courseId: string): CourseProgress {
	const now = Date.now()
	return {
		courseId,
		startedAt: now,
		lastVisitedAt: now,
		currentModuleId: null,
		completed: {},
	}
}

function safeCourseId(id: string): string {
	return id.replace(/[^a-zA-Z0-9._-]+/g, "_") || "unknown"
}

function progressFilePath(courseId: string): string {
	return path.join(PROGRESS_DIR, `${safeCourseId(courseId)}.json`)
}

export async function loadProgress(courseId: string): Promise<CourseProgress> {
	if (!courseId) return emptyProgress(courseId || "unknown")
	try {
		const content = await fs.readFile(progressFilePath(courseId), "utf8")
		const parsed = JSON.parse(content) as CourseProgress
		// Migrate old shapes by filling in any missing fields
		if (!parsed.completed || typeof parsed.completed !== "object") parsed.completed = {}
		if (typeof parsed.startedAt !== "number") parsed.startedAt = Date.now()
		if (typeof parsed.lastVisitedAt !== "number") parsed.lastVisitedAt = parsed.startedAt
		if (parsed.courseId !== courseId) parsed.courseId = courseId
		return parsed
	} catch {
		// File doesn't exist or unreadable → fresh progress
		return emptyProgress(courseId)
	}
}

async function saveProgress(progress: CourseProgress): Promise<void> {
	await fs.mkdir(PROGRESS_DIR, { recursive: true })
	const file = progressFilePath(progress.courseId)
	const tmp = `${file}.tmp.${process.pid}.${Date.now()}`
	await fs.writeFile(tmp, JSON.stringify(progress, null, 2), "utf8")
	await fs.rename(tmp, file) // atomic on POSIX, near-atomic on Win
}

export async function markComplete(courseId: string, moduleId: string, timeSpentMs?: number): Promise<CourseProgress> {
	const progress = await loadProgress(courseId)
	progress.completed[moduleId] = {
		completedAt: Date.now(),
		timeSpentMs: timeSpentMs ?? progress.completed[moduleId]?.timeSpentMs,
	}
	progress.lastVisitedAt = Date.now()
	await saveProgress(progress)
	return progress
}

export async function markUncomplete(courseId: string, moduleId: string): Promise<CourseProgress> {
	const progress = await loadProgress(courseId)
	delete progress.completed[moduleId]
	progress.lastVisitedAt = Date.now()
	await saveProgress(progress)
	return progress
}

export async function setCurrentModule(courseId: string, moduleId: string | null): Promise<CourseProgress> {
	const progress = await loadProgress(courseId)
	progress.currentModuleId = moduleId
	progress.lastVisitedAt = Date.now()
	await saveProgress(progress)
	return progress
}

export async function resetProgress(courseId: string): Promise<CourseProgress> {
	const fresh = emptyProgress(courseId)
	try {
		await fs.unlink(progressFilePath(courseId))
	} catch {
		// File didn't exist — nothing to remove
	}
	return fresh
}
