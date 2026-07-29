import type { WorkspaceRoot } from "@shared/multi-root/types"
import { render, screen } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import { describe, expect, it, vi } from "vitest"
import TaskWorkingDirectoryBadge, { isTaskCwdOutsideWorkspace } from "./TaskWorkingDirectoryBadge"

vi.mock("@/components/ui/tooltip", () => ({
	Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
	TooltipContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
	TooltipTrigger: ({ children }: PropsWithChildren) => <>{children}</>,
}))

const roots = (...paths: string[]): WorkspaceRoot[] => paths.map((path) => ({ path, vcs: "git" }) as WorkspaceRoot)

describe("isTaskCwdOutsideWorkspace", () => {
	it("is false when the cwd equals a workspace root", () => {
		expect(isTaskCwdOutsideWorkspace("/home/user/project", roots("/home/user/project"), "linux")).toBe(false)
	})

	it("is false when the cwd is inside a workspace root", () => {
		expect(isTaskCwdOutsideWorkspace("/home/user/project/packages/app", roots("/home/user/project"), "linux")).toBe(false)
	})

	it("is true when the cwd is outside every workspace root", () => {
		expect(isTaskCwdOutsideWorkspace("/tmp/cline-hello", roots("/home/user/project"), "linux")).toBe(true)
	})

	it("does not treat a sibling path sharing a prefix as inside", () => {
		expect(isTaskCwdOutsideWorkspace("/home/user/project-other", roots("/home/user/project"), "linux")).toBe(true)
	})

	it("is false when the cwd is unknown or roots are missing", () => {
		expect(isTaskCwdOutsideWorkspace(undefined, roots("/home/user/project"), "linux")).toBe(false)
		expect(isTaskCwdOutsideWorkspace("", roots("/home/user/project"), "linux")).toBe(false)
		expect(isTaskCwdOutsideWorkspace("/tmp/cline-hello", [], "linux")).toBe(false)
		expect(isTaskCwdOutsideWorkspace("/tmp/cline-hello", undefined, "linux")).toBe(false)
	})

	it("ignores trailing separators", () => {
		expect(isTaskCwdOutsideWorkspace("/home/user/project/", roots("/home/user/project"), "linux")).toBe(false)
	})

	it("checks all roots in a multi-root workspace", () => {
		expect(isTaskCwdOutsideWorkspace("/repos/backend/src", roots("/repos/frontend", "/repos/backend"), "linux")).toBe(false)
		expect(isTaskCwdOutsideWorkspace("/repos/infra", roots("/repos/frontend", "/repos/backend"), "linux")).toBe(true)
	})

	describe("case sensitivity is platform-aware", () => {
		it("treats case-only differences as the same directory on win32", () => {
			expect(isTaskCwdOutsideWorkspace("C:\\Users\\Dev\\Project", roots("c:/users/dev/project"), "win32")).toBe(false)
		})

		it("treats case-only differences as distinct directories on linux and darwin", () => {
			// darwin is strict to match arePathsEqual and to cover
			// case-sensitive macOS volumes (see normalizeForComparison).
			expect(isTaskCwdOutsideWorkspace("/repo/App", roots("/repo/app"), "linux")).toBe(true)
			expect(isTaskCwdOutsideWorkspace("/Users/dev/Project", roots("/users/dev/project"), "darwin")).toBe(true)
		})

		it("stays strict when the platform is unknown", () => {
			expect(isTaskCwdOutsideWorkspace("/repo/App", roots("/repo/app"), "unknown")).toBe(true)
		})
	})

	describe("separators are platform-aware", () => {
		it("treats backslashes as separators only on win32", () => {
			expect(isTaskCwdOutsideWorkspace("C:\\repo\\app\\src", roots("C:/repo/app"), "win32")).toBe(false)
			// On POSIX a backslash is an ordinary filename character.
			expect(isTaskCwdOutsideWorkspace("/tmp/weird\\dir", roots("/tmp/weird\\dir"), "linux")).toBe(false)
			expect(isTaskCwdOutsideWorkspace("/tmp/weird\\dir", roots("/tmp/weird/dir"), "linux")).toBe(true)
		})
	})

	describe("filesystem roots as workspace roots", () => {
		it("treats descendants of a '/' workspace root as inside", () => {
			expect(isTaskCwdOutsideWorkspace("/tmp/task", roots("/"), "linux")).toBe(false)
			expect(isTaskCwdOutsideWorkspace("/", roots("/"), "linux")).toBe(false)
		})

		it("treats descendants of a Windows drive root as inside", () => {
			expect(isTaskCwdOutsideWorkspace("C:\\Users\\dev", roots("C:\\"), "win32")).toBe(false)
			expect(isTaskCwdOutsideWorkspace("D:\\work", roots("C:\\"), "win32")).toBe(true)
		})
	})
})

describe("TaskWorkingDirectoryBadge", () => {
	it("renders the cwd basename and full-path tooltip when outside the workspace", () => {
		render(
			<TaskWorkingDirectoryBadge
				platform="linux"
				taskCwd="/tmp/cline-hello"
				workspaceRoots={roots("/home/user/project")}
			/>,
		)
		expect(screen.getByText("cline-hello")).toBeDefined()
		expect(screen.getByText(/working directory is \/tmp\/cline-hello/)).toBeDefined()
	})

	it("renders nothing when the cwd is inside the workspace", () => {
		const { container } = render(
			<TaskWorkingDirectoryBadge
				platform="linux"
				taskCwd="/home/user/project/src"
				workspaceRoots={roots("/home/user/project")}
			/>,
		)
		expect(container.innerHTML).toBe("")
	})

	it("renders nothing when workspace roots are not yet known", () => {
		const { container } = render(
			<TaskWorkingDirectoryBadge platform="linux" taskCwd="/tmp/cline-hello" workspaceRoots={[]} />,
		)
		expect(container.innerHTML).toBe("")
	})
})
