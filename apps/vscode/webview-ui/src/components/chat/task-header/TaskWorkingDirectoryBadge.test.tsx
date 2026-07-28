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
		expect(isTaskCwdOutsideWorkspace("/home/user/project", roots("/home/user/project"))).toBe(false)
	})

	it("is false when the cwd is inside a workspace root", () => {
		expect(isTaskCwdOutsideWorkspace("/home/user/project/packages/app", roots("/home/user/project"))).toBe(false)
	})

	it("is true when the cwd is outside every workspace root", () => {
		expect(isTaskCwdOutsideWorkspace("/tmp/cline-hello", roots("/home/user/project"))).toBe(true)
	})

	it("does not treat a sibling path sharing a prefix as inside", () => {
		expect(isTaskCwdOutsideWorkspace("/home/user/project-other", roots("/home/user/project"))).toBe(true)
	})

	it("is false when the cwd is unknown or roots are missing", () => {
		expect(isTaskCwdOutsideWorkspace(undefined, roots("/home/user/project"))).toBe(false)
		expect(isTaskCwdOutsideWorkspace("", roots("/home/user/project"))).toBe(false)
		expect(isTaskCwdOutsideWorkspace("/tmp/cline-hello", [])).toBe(false)
		expect(isTaskCwdOutsideWorkspace("/tmp/cline-hello", undefined)).toBe(false)
	})

	it("compares case-insensitively and ignores trailing separators and backslashes", () => {
		expect(isTaskCwdOutsideWorkspace("C:\\Users\\Dev\\Project\\", roots("c:/users/dev/project"))).toBe(false)
		expect(isTaskCwdOutsideWorkspace("/home/user/project/", roots("/home/user/project"))).toBe(false)
	})

	it("checks all roots in a multi-root workspace", () => {
		expect(isTaskCwdOutsideWorkspace("/repos/backend/src", roots("/repos/frontend", "/repos/backend"))).toBe(false)
		expect(isTaskCwdOutsideWorkspace("/repos/infra", roots("/repos/frontend", "/repos/backend"))).toBe(true)
	})
})

describe("TaskWorkingDirectoryBadge", () => {
	it("renders the cwd basename and full-path tooltip when outside the workspace", () => {
		render(<TaskWorkingDirectoryBadge taskCwd="/tmp/cline-hello" workspaceRoots={roots("/home/user/project")} />)
		expect(screen.getByText("cline-hello")).toBeDefined()
		expect(screen.getByText(/working directory is \/tmp\/cline-hello/)).toBeDefined()
	})

	it("renders nothing when the cwd is inside the workspace", () => {
		const { container } = render(
			<TaskWorkingDirectoryBadge taskCwd="/home/user/project/src" workspaceRoots={roots("/home/user/project")} />,
		)
		expect(container.innerHTML).toBe("")
	})

	it("renders nothing when workspace roots are not yet known", () => {
		const { container } = render(<TaskWorkingDirectoryBadge taskCwd="/tmp/cline-hello" workspaceRoots={[]} />)
		expect(container.innerHTML).toBe("")
	})
})
