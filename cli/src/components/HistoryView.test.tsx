import { Text } from "ink"
import { render } from "ink-testing-library"
import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Create stable mock reference using vi.hoisted
const { mockShowTaskWithId } = vi.hoisted(() => ({
	mockShowTaskWithId: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("./TaskView", () => ({
	TaskView: ({ taskId, verbose }: any) =>
		React.createElement(Text, null, `TaskView: ${taskId || "no-id"} verbose=${String(verbose)}`),
}))

// Mock the controller dependencies - must be before importing HistoryView
vi.mock("@/core/controller", () => ({
	Controller: vi.fn(),
}))

vi.mock("@/core/controller/task/showTaskWithId", () => ({
	showTaskWithId: mockShowTaskWithId,
}))

vi.mock("@/shared/proto/cline/common", () => ({
	StringRequest: {
		create: (data: any) => data,
	},
}))

// Mock useTerminalSize to prevent EventEmitter memory leak warnings from resize listeners
vi.mock("../hooks/useTerminalSize", () => ({
	useTerminalSize: () => ({ columns: 80, rows: 24, resizeKey: 0 }),
}))

// Import after mocks are set up
import { HistoryView } from "./HistoryView"

describe("HistoryView", () => {
	const mockController = {
		dispose: vi.fn(),
		stateManager: { flushPendingState: vi.fn() },
	} as any

	const mockItems = [
		{ id: "task-1", ts: Date.now() - 3600000, task: "First task" },
		{ id: "task-2", ts: Date.now() - 7200000, task: "Second task" },
		{ id: "task-3", ts: Date.now() - 10800000, task: "Third task" },
	]

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("rendering", () => {
		it("should render the history header", () => {
			const { lastFrame } = render(<HistoryView controller={mockController} items={mockItems} />)
			expect(lastFrame()).toContain("Task History")
		})

		it("should show total count in header", () => {
			const { lastFrame } = render(<HistoryView controller={mockController} items={mockItems} />)
			expect(lastFrame()).toContain("3 total")
		})

		it("should render task items", () => {
			const { lastFrame } = render(<HistoryView controller={mockController} items={mockItems} />)
			expect(lastFrame()).toContain("First task")
			expect(lastFrame()).toContain("Second task")
			expect(lastFrame()).toContain("Third task")
		})

		it("should show task IDs", () => {
			const { lastFrame } = render(<HistoryView controller={mockController} items={mockItems} />)
			expect(lastFrame()).toContain("task-1")
			expect(lastFrame()).toContain("task-2")
		})

		it("should show empty message when no items", () => {
			const { lastFrame } = render(<HistoryView controller={mockController} items={[]} />)
			expect(lastFrame()).toContain("No task history available")
		})

		it("should show navigation help", () => {
			const { lastFrame } = render(<HistoryView controller={mockController} items={mockItems} />)
			expect(lastFrame()).toContain("↑↓")
			expect(lastFrame()).toContain("Enter")
		})
	})

	describe("task details", () => {
		it("should display task cost when available", () => {
			const itemsWithCost = [{ id: "task-1", ts: Date.now(), task: "Task", totalCost: 0.0025 }]
			const { lastFrame } = render(<HistoryView controller={mockController} items={itemsWithCost} />)
			expect(lastFrame()).toContain("Cost:")
			expect(lastFrame()).toContain("0.0025")
		})

		it("should display model ID when available", () => {
			const itemsWithModel = [{ id: "task-1", ts: Date.now(), task: "Task", modelId: "claude-sonnet-4-20250514" }]
			const { lastFrame } = render(<HistoryView controller={mockController} items={itemsWithModel} />)
			expect(lastFrame()).toContain("Model:")
			expect(lastFrame()).toContain("claude-sonnet-4-20250514")
		})

		it("should truncate long task descriptions", () => {
			const longTask = "x".repeat(100)
			const itemsWithLongTask = [{ id: "task-1", ts: Date.now(), task: longTask }]
			const { lastFrame } = render(<HistoryView controller={mockController} items={itemsWithLongTask} />)
			expect(lastFrame()).toContain("...")
		})

		it("should handle missing task text", () => {
			const itemsWithoutTask = [{ id: "task-1", ts: Date.now() }]
			const { lastFrame } = render(<HistoryView controller={mockController} items={itemsWithoutTask} />)
			expect(lastFrame()).toContain("Unknown task")
		})
	})

	describe("selection indicator", () => {
		it("should show selection indicator on first item by default", () => {
			const { lastFrame } = render(<HistoryView controller={mockController} items={mockItems} />)
			expect(lastFrame()).toContain(">")
		})
	})

	describe("keyboard navigation", () => {
		it("should navigate down with arrow key", () => {
			const { lastFrame, stdin } = render(<HistoryView controller={mockController} items={mockItems} />)

			// Press down arrow
			stdin.write("\x1B[B")

			// Should still render properly
			expect(lastFrame()).toContain("Task History")
		})

		it("should navigate up with arrow key", () => {
			const { lastFrame, stdin } = render(<HistoryView controller={mockController} items={mockItems} />)

			// Press down then up
			stdin.write("\x1B[B")
			stdin.write("\x1B[A")

			expect(lastFrame()).toContain("Task History")
		})

		it("should not go below last item", () => {
			const { lastFrame, stdin } = render(<HistoryView controller={mockController} items={mockItems} />)

			// Press down many times
			for (let i = 0; i < 10; i++) {
				stdin.write("\x1B[B")
			}

			expect(lastFrame()).toContain("Task History")
		})

		it("should not go above first item", () => {
			const { lastFrame, stdin } = render(<HistoryView controller={mockController} items={mockItems} />)

			// Press up when already at first
			stdin.write("\x1B[A")

			expect(lastFrame()).toContain("Task History")
		})
	})

	describe("pagination", () => {
		it("should show pagination info when provided", () => {
			const pagination = {
				page: 2,
				totalPages: 5,
				totalCount: 50,
				limit: 10,
			}
			const { lastFrame } = render(<HistoryView controller={mockController} items={mockItems} pagination={pagination} />)
			expect(lastFrame()).toContain("Page 2 of 5")
		})

		it("should show correct total count from pagination", () => {
			const pagination = {
				page: 1,
				totalPages: 3,
				totalCount: 25,
				limit: 10,
			}
			const { lastFrame } = render(<HistoryView controller={mockController} items={mockItems} pagination={pagination} />)
			expect(lastFrame()).toContain("25 total")
		})

		it("should not show page info for single page", () => {
			const pagination = {
				page: 1,
				totalPages: 1,
				totalCount: 3,
				limit: 10,
			}
			const { lastFrame } = render(<HistoryView controller={mockController} items={mockItems} pagination={pagination} />)
			expect(lastFrame()).not.toContain("Page 1 of 1")
		})
	})

	describe("scrolling", () => {
		it("should show scroll indicators for long lists", () => {
			const manyItems = Array.from({ length: 20 }, (_, i) => ({
				id: `task-${i}`,
				ts: Date.now() - i * 3600000,
				task: `Task ${i}`,
			}))

			const { lastFrame, stdin } = render(<HistoryView controller={mockController} items={manyItems} visibleCount={5} />)

			// Navigate down a bit
			for (let i = 0; i < 5; i++) {
				stdin.write("\x1B[B")
			}

			// Should show "more below" indicator
			expect(lastFrame()).toContain("more")
		})
	})
})
