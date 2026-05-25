/**
 * Course Loader — extension-host side.
 *
 * Walks up from a given file path looking for a `course.json` (up to 5 levels)
 * and parses it. A course manifest groups multiple HTML modules into a single
 * coherent learning experience with navigation, ordering, and shared metadata.
 *
 * Phase A (this commit): pure read-only loader + parser. Returns the manifest
 * + the resolved folder where course.json was found (the "course root").
 * Webview consumers resolve module paths relative to courseRoot.
 *
 * Phase B will add progress tracking (`~/.aihydro/course_progress/<id>.json`)
 * and prerequisite enforcement.
 * Phase C will add MCP tools so the agent is course-aware.
 */
import * as fs from "fs/promises"
import * as path from "path"

export interface CourseAuthor {
	name: string
	affiliation?: string
	orcid?: string
}

export interface CourseModuleEntry {
	id: string
	/** Path to the module HTML file, relative to courseRoot */
	path: string
	title: string
	abstract?: string
	estimatedMinutes?: number
	/** Module IDs that must be completed first (for Phase B prerequisite locking) */
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
	/**
	 * Kernel model:
	 *   "isolated" (default) — each module gets a fresh Python kernel
	 *   "shared"             — all modules in this course share one kernel
	 */
	kernel?: "isolated" | "shared"
	estimatedHours?: number
	[key: string]: unknown
}

export interface CourseLoadResult {
	course: CourseManifest | null
	/** Absolute path to the directory containing course.json, or null */
	courseRoot: string | null
}

const MAX_PARENT_WALK = 5

/**
 * Try to load a course manifest associated with the given file or folder.
 * Returns { course: null, courseRoot: null } if no course.json is found in
 * the file's directory or any of its parents up to MAX_PARENT_WALK levels.
 */
export async function loadCourseManifest(filePathOrFolder: string): Promise<CourseLoadResult> {
	if (!filePathOrFolder) return { course: null, courseRoot: null }

	let dir = filePathOrFolder
	try {
		const stat = await fs.stat(dir)
		if (stat.isFile()) dir = path.dirname(dir)
	} catch {
		// Path doesn't exist or unreadable — fall through and try parents anyway
		dir = path.dirname(filePathOrFolder)
	}

	for (let level = 0; level < MAX_PARENT_WALK; level++) {
		const candidate = path.join(dir, "course.json")
		try {
			const content = await fs.readFile(candidate, "utf8")
			const parsed = JSON.parse(content) as unknown
			if (isValidCourseManifest(parsed)) {
				return { course: parsed, courseRoot: dir }
			}
		} catch {
			// Not present at this level — keep walking up
		}
		const parent = path.dirname(dir)
		if (parent === dir) break // hit filesystem root
		dir = parent
	}
	return { course: null, courseRoot: null }
}

function isValidCourseManifest(value: unknown): value is CourseManifest {
	if (!value || typeof value !== "object") return false
	const v = value as Record<string, unknown>
	if (typeof v.courseId !== "string" || !v.courseId) return false
	if (typeof v.title !== "string" || !v.title) return false
	if (!Array.isArray(v.modules) || v.modules.length === 0) return false
	for (const m of v.modules) {
		if (!m || typeof m !== "object") return false
		const mm = m as Record<string, unknown>
		if (typeof mm.id !== "string" || typeof mm.path !== "string" || typeof mm.title !== "string") {
			return false
		}
	}
	return true
}
