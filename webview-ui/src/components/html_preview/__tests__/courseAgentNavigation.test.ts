import { describe, expect, it } from "vitest"
import { resolveAgentCourseNavigation } from "../courseAgentNavigation"
import type { CourseManifest, CourseModuleEntry } from "../useCourse"

const course: CourseManifest = {
	courseId: "course-1",
	title: "Synthetic course",
	modules: [
		{ id: "module-1", path: "01/module.html", title: "One" },
		{ id: "module-2", path: "02/module.html", title: "Two", prerequisites: ["module-1"] },
	],
}

describe("agent course navigation", () => {
	it("refuses wrong-course, unknown, and locked targets", () => {
		const canAccess = (module: CourseModuleEntry) => module.id !== "module-2"
		expect(resolveAgentCourseNavigation({ courseId: "other", moduleId: "module-1" }, course, canAccess)).toBeNull()
		expect(resolveAgentCourseNavigation({ courseId: "course-1", moduleId: "missing" }, course, canAccess)).toBeNull()
		expect(resolveAgentCourseNavigation({ courseId: "course-1", moduleId: "module-2" }, course, canAccess)).toBeNull()
	})

	it("returns a fresh accessible target for the existing loader path", () => {
		expect(resolveAgentCourseNavigation({ courseId: "course-1", moduleId: "module-2" }, course, () => true)?.path).toBe(
			"02/module.html",
		)
	})
})
