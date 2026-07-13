import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CourseHeader } from "../CourseHeader"
import type { CourseManifest } from "../useCourse"
import type { CourseProgress, CourseProgressHook } from "../useCourseProgress"

const course: CourseManifest = {
	courseId: "phase2-course",
	title: "Phase 2 course",
	modules: [
		{ id: "module-1", path: "module-1/module.html", title: "Module 1" },
		{
			id: "module-2",
			path: "module-2/module.html",
			title: "Module 2",
			prerequisites: ["module-1"],
		},
	],
}

const initialProgress: CourseProgress = {
	courseId: course.courseId,
	startedAt: 1,
	lastVisitedAt: 1,
	currentModuleId: "module-1",
	completed: {},
}

function progressHook(markComplete: CourseProgressHook["markComplete"]): CourseProgressHook {
	return {
		progress: initialProgress,
		loading: false,
		isCompleted: () => false,
		// These helpers intentionally represent the current render's stale snapshot.
		canAccess: () => false,
		missingPrerequisites: () => ["module-1"],
		completionPct: 0,
		markComplete,
		markUncomplete: vi.fn().mockResolvedValue(undefined),
		reset: vi.fn().mockResolvedValue(undefined),
		setCurrent: vi.fn().mockResolvedValue(undefined),
		refresh: vi.fn().mockResolvedValue(undefined),
	}
}

async function markCompleteAndFlush(): Promise<void> {
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Mark complete" }))
		await Promise.resolve()
	})
}

describe("CourseHeader completion navigation", () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => {
		vi.clearAllTimers()
		vi.useRealTimers()
	})

	it("auto-advances using the freshly persisted progress snapshot", async () => {
		const fresh: CourseProgress = {
			...initialProgress,
			lastVisitedAt: 2,
			completed: { "module-1": { completedAt: 2 } },
		}
		const markComplete = vi.fn().mockResolvedValue(fresh)
		const onNavigate = vi.fn()

		render(
			<CourseHeader
				course={course}
				currentModuleId="module-1"
				onNavigate={onNavigate}
				progress={progressHook(markComplete)}
			/>,
		)

		await markCompleteAndFlush()
		expect(markComplete).toHaveBeenCalledWith("module-1")
		expect(onNavigate).not.toHaveBeenCalled()

		act(() => vi.advanceTimersByTime(350))
		expect(onNavigate).toHaveBeenCalledOnce()
		expect(onNavigate).toHaveBeenCalledWith("module-2")
	})

	it("does not navigate when completion persistence fails", async () => {
		const onNavigate = vi.fn()
		render(
			<CourseHeader
				course={course}
				currentModuleId="module-1"
				onNavigate={onNavigate}
				progress={progressHook(vi.fn().mockResolvedValue(null))}
			/>,
		)

		await markCompleteAndFlush()
		act(() => vi.advanceTimersByTime(350))
		expect(onNavigate).not.toHaveBeenCalled()
	})

	it("does not navigate while another prerequisite remains incomplete", async () => {
		const courseWithAnotherPrerequisite: CourseManifest = {
			...course,
			modules: [course.modules[0], { ...course.modules[1], prerequisites: ["module-1", "required-lab"] }],
		}
		const fresh: CourseProgress = {
			...initialProgress,
			lastVisitedAt: 2,
			completed: { "module-1": { completedAt: 2 } },
		}
		const onNavigate = vi.fn()

		render(
			<CourseHeader
				course={courseWithAnotherPrerequisite}
				currentModuleId="module-1"
				onNavigate={onNavigate}
				progress={progressHook(vi.fn().mockResolvedValue(fresh))}
			/>,
		)

		await markCompleteAndFlush()
		act(() => vi.advanceTimersByTime(350))
		expect(onNavigate).not.toHaveBeenCalled()
	})
})
