import { Text } from "ink"
import { render } from "ink-testing-library"
import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { App } from "./App"

// Mock the child components to isolate App routing logic
vi.mock("./ChatView", () => ({
	ChatView: ({ taskId, controller }: any) =>
		React.createElement(Text, null, `ChatView: ${taskId || "no-id"} controller=${controller ? "present" : "none"}`),
}))

vi.mock("./TaskJsonView", () => ({
	TaskJsonView: ({ taskId, verbose }: any) =>
		React.createElement(Text, null, `TaskJsonView: ${taskId || "no-id"} verbose=${String(verbose)}`),
}))

vi.mock("./HistoryView", () => ({
	HistoryView: ({ items }: any) => React.createElement(Text, null, `HistoryView: ${items?.length || 0} items`),
}))

vi.mock("./ConfigView", () => ({
	ConfigView: ({ dataDir }: any) => React.createElement(Text, null, `ConfigView: ${dataDir}`),
}))

vi.mock("./AuthView", () => ({
	AuthView: ({ quickSetup }: any) => React.createElement(Text, null, `AuthView: ${quickSetup?.provider || "no-provider"}`),
}))

vi.mock("../context/TaskContext", () => ({
	TaskContextProvider: ({ children }: any) => children,
}))

vi.mock("../context/StdinContext", () => ({
	StdinProvider: ({ children }: any) => children,
}))

// Mock useTerminalSize to prevent EventEmitter memory leak warnings from resize listeners
vi.mock("../hooks/useTerminalSize", () => ({
	useTerminalSize: () => ({ columns: 80, rows: 24, resizeKey: 0 }),
}))

describe("App", () => {
	const mockController = {
		dispose: vi.fn(),
		stateManager: { flushPendingState: vi.fn() },
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("view routing", () => {
		it("should render ChatView when view is task", () => {
			const { lastFrame } = render(<App controller={mockController} taskId="test-task" view="task" />)
			expect(lastFrame()).toContain("ChatView")
			expect(lastFrame()).toContain("test-task")
		})

		it("should render TaskJsonView when view is task with jsonOutput", () => {
			const { lastFrame } = render(<App controller={mockController} jsonOutput={true} taskId="test-task" view="task" />)
			expect(lastFrame()).toContain("TaskJsonView")
			expect(lastFrame()).toContain("test-task")
		})

		it("should render HistoryView when view is history", () => {
			const historyItems = [
				{ id: "1", ts: Date.now(), task: "Task 1" },
				{ id: "2", ts: Date.now(), task: "Task 2" },
			]
			const { lastFrame } = render(<App controller={mockController} historyItems={historyItems} view="history" />)
			expect(lastFrame()).toContain("HistoryView")
			expect(lastFrame()).toContain("2 items")
		})

		it("should render ConfigView when view is config", () => {
			const { lastFrame } = render(
				<App dataDir="/path/to/config" globalState={{ key: "value" }} view="config" workspaceState={{}} />,
			)
			expect(lastFrame()).toContain("ConfigView")
			expect(lastFrame()).toContain("/path/to/config")
		})

		it("should render AuthView when view is auth", () => {
			const { lastFrame } = render(<App authQuickSetup={{ provider: "openai" }} controller={mockController} view="auth" />)
			expect(lastFrame()).toContain("AuthView")
			expect(lastFrame()).toContain("openai")
		})

		it("should render ChatView when view is welcome", () => {
			const { lastFrame } = render(
				<App controller={mockController} onWelcomeExit={() => {}} onWelcomeSubmit={() => {}} view="welcome" />,
			)
			expect(lastFrame()).toContain("ChatView")
		})
	})

	describe("default props", () => {
		it("should use default verbose=false with jsonOutput", () => {
			const { lastFrame } = render(<App controller={mockController} jsonOutput={true} view="task" />)
			expect(lastFrame()).toContain("verbose=false")
		})

		it("should use empty array for historyItems by default", () => {
			const { lastFrame } = render(<App controller={mockController} view="history" />)
			expect(lastFrame()).toContain("0 items")
		})
	})

	describe("props passing", () => {
		it("should pass verbose to TaskJsonView", () => {
			const { lastFrame } = render(<App controller={mockController} jsonOutput={true} verbose={true} view="task" />)
			expect(lastFrame()).toContain("verbose=true")
		})

		it("should pass taskId to ChatView", () => {
			const { lastFrame } = render(<App controller={mockController} taskId="my-task-123" view="task" />)
			expect(lastFrame()).toContain("my-task-123")
		})

		it("should pass controller to ChatView", () => {
			const { lastFrame } = render(<App controller={mockController} view="task" />)
			expect(lastFrame()).toContain("controller=present")
		})
	})
})
