import type { CourseManifest, CourseModuleEntry } from "./useCourse"

export interface AgentCourseNavigationRequest {
	courseId?: string
	moduleId?: string
}

/** Resolve an agent intent only when it targets this course and an accessible module. */
export function resolveAgentCourseNavigation(
	request: AgentCourseNavigationRequest,
	course: CourseManifest,
	canAccess: (module: CourseModuleEntry) => boolean,
): CourseModuleEntry | null {
	if (request.courseId && request.courseId !== course.courseId) return null
	const moduleId = request.moduleId?.trim() ?? ""
	if (!moduleId) return null
	const target = course.modules.find((module) => module.id === moduleId)
	if (!target || !canAccess(target)) return null
	return target
}
