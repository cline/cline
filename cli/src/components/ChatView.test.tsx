/**
 * Tests for ChatView component exit and cleanup behavior
 *
 * These tests verify that when the user exits (via Ctrl+C or other means),
 * the input field is properly hidden before the app terminates.
 */

import { Text } from "ink"
import { render } from "ink-testing-library"
import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ChatView } from "./ChatView"

// Helper to wait for async state updates
// Using 60ms since handleExit has a 50ms setTimeout
const delay = (ms: number = 60) => new Promise((resolve) => setTimeout(resolve, ms))

// Type for our exit mock function
type ExitMockFn = ReturnType<typeof vi.fn> & (() => void)

// Track shutdown event state
const shutdownMockState = {
	listeners: [] as Array<() => void>,
	fire: () => {
		shutdownMockState.listeners.forEach((listener) => listener())
	},
	reset: () => {
		shutdownMockState.listeners = []
	},
}

// Mock vscode-shim shutdownEvent
vi.mock("../vscode-shim", () => ({
	shutdownEvent: {
		event: (listener: () => void) => {
			shutdownMockState.listeners.push(listener)
			return {
				dispose: () => {
					const idx = shutdownMockState.listeners.indexOf(listener)
					if (idx >= 0) shutdownMockState.listeners.splice(idx, 1)
				},
			}
		},
		fire: () => shutdownMockState.fire(),
	},
}))

// Mock TaskContext
vi.mock("../context/TaskContext", () => ({
	useTaskState: vi.fn(() => ({
		clineMessages: [],
		mode: "act",
	})),
	useTaskContext: vi.fn(() => ({
		controller: null,
	})),
}))

// Mock useIsSpinnerActive hook
vi.mock("../hooks/useStateSubscriber", () => ({
	useIsSpinnerActive: vi.fn(() => ({
		isActive: false,
		startTime: null,
	})),
}))

// Mock StateManager
vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: vi.fn(() => ({
			getGlobalSettingsKey: vi.fn((key: string) => {
				if (key === "mode") return "act"
				if (key === "yoloModeToggled") return false
				if (key === "actModeApiModelId") return "claude-sonnet-4-20250514"
				return null
			}),
			setGlobalState: vi.fn(),
		})),
	},
}))

// Mock child components that aren't under test
vi.mock("./ActionButtons", () => ({
	ActionButtons: () => React.createElement(Text, null, "ActionButtons"),
	getButtonConfig: vi.fn(() => ({ enableButtons: false })),
}))

vi.mock("./AsciiMotionCli", () => ({
	AsciiMotionCli: () => React.createElement(Text, null, "AsciiMotion"),
	StaticRobotFrame: () => React.createElement(Text, null, "StaticRobot"),
}))

vi.mock("./ChatMessage", () => ({
	ChatMessage: ({ message }: { message?: { ts?: number } }) => React.createElement(Text, null, `Message: ${message?.ts}`),
}))

vi.mock("./FileMentionMenu", () => ({
	FileMentionMenu: () => React.createElement(Text, null, "FileMentionMenu"),
}))

vi.mock("./HighlightedInput", () => ({
	HighlightedInput: ({ text }: { text?: string }) => React.createElement(Text, null, `Input: ${text}`),
}))

vi.mock("./HistoryPanelContent", () => ({
	HistoryPanelContent: () => React.createElement(Text, null, "HistoryPanel"),
}))

vi.mock("./SettingsPanelContent", () => ({
	SettingsPanelContent: () => React.createElement(Text, null, "SettingsPanel"),
}))

vi.mock("./SlashCommandMenu", () => ({
	SlashCommandMenu: () => React.createElement(Text, null, "SlashMenu"),
}))

vi.mock("./ThinkingIndicator", () => ({
	ThinkingIndicator: () => React.createElement(Text, null, "ThinkingIndicator"),
}))

// Mock utility functions
vi.mock("../utils/file-search", () => ({
	checkAndWarnRipgrepMissing: vi.fn(() => false),
	extractMentionQuery: vi.fn(() => ({ inMentionMode: false, query: "", atIndex: -1 })),
	getRipgrepInstallInstructions: vi.fn(() => "brew install ripgrep"),
	insertMention: vi.fn((text: string) => text),
	searchWorkspaceFiles: vi.fn(async () => []),
}))

vi.mock("../utils/slash-commands", () => ({
	extractSlashQuery: vi.fn(() => ({ inSlashMode: false, query: "", slashIndex: -1 })),
	filterCommands: vi.fn(() => []),
	insertSlashCommand: vi.fn((text: string) => text),
	sortCommandsWorkflowsFirst: vi.fn((cmds: unknown[]) => cmds),
}))

vi.mock("../utils/input", () => ({
	isMouseEscapeSequence: vi.fn(() => false),
}))

vi.mock("../utils/parser", () => ({
	jsonParseSafe: vi.fn((_text: string, defaultValue: unknown) => defaultValue),
	parseImagesFromInput: vi.fn((text: string) => ({ prompt: text, imagePaths: [] })),
}))

vi.mock("../utils/tools", () => ({
	isFileEditTool: vi.fn(() => false),
	parseToolFromMessage: vi.fn(() => null),
}))

vi.mock("../utils/display", () => ({
	setTerminalTitle: vi.fn(),
}))

vi.mock("../utils/cursor", () => ({
	moveCursorUp: vi.fn((_text: string, pos: number) => pos),
	moveCursorDown: vi.fn((_text: string, pos: number) => pos),
}))

vi.mock("@/core/controller/slash/getAvailableSlashCommands", () => ({
	getAvailableSlashCommands: vi.fn(async () => ({ commands: [] })),
}))

vi.mock("@/core/controller/task/showTaskWithId", () => ({
	showTaskWithId: vi.fn(async () => {}),
}))

vi.mock("@shared/combineCommandSequences", () => ({
	combineCommandSequences: vi.fn((messages: unknown[]) => messages),
}))

vi.mock("@shared/getApiMetrics", () => ({
	getApiMetrics: vi.fn(() => ({
		totalTokensIn: 0,
		totalTokensOut: 0,
		totalCost: 0,
	})),
}))

vi.mock("child_process", () => ({
	execSync: vi.fn(() => "main"),
}))

// Helper to create a typed mock for onExit
const createExitMock = (): ExitMockFn => vi.fn() as ExitMockFn

describe("ChatView Exit and Cleanup", () => {
	let mockOnExit: ExitMockFn

	beforeEach(() => {
		vi.clearAllMocks()
		shutdownMockState.reset()
		mockOnExit = createExitMock()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("Initial render state", () => {
		it("should render with input field, footer, and mode toggle visible", () => {
			const { lastFrame } = render(<ChatView onExit={mockOnExit} />)
			const frame = lastFrame()

			// Input field visible
			expect(frame).toContain("Input:")
			// Footer with help text
			expect(frame).toContain("@ for files")
			expect(frame).toContain("/ for commands")
			// Mode toggle
			expect(frame).toContain("Plan")
			expect(frame).toContain("Act")
		})
	})

	describe("Ctrl+C exit handling", () => {
		it("should hide input but keep footer, then call onExit", async () => {
			const { lastFrame, stdin } = render(<ChatView onExit={mockOnExit} />)

			// Verify UI visible before Ctrl+C
			expect(lastFrame()).toContain("Input:")
			expect(lastFrame()).toContain("@ for files")

			// Simulate Ctrl+C
			stdin.write("\x03")

			// onExit should not be called immediately
			expect(mockOnExit).not.toHaveBeenCalled()

			// Wait for state update and callback
			await delay()

			// Input should be hidden, but footer should remain
			const frameAfter = lastFrame()
			expect(frameAfter).not.toContain("Input:")
			expect(frameAfter).toContain("@ for files")

			// onExit should have been called
			expect(mockOnExit).toHaveBeenCalledTimes(1)
		})
	})

	describe("Shutdown event handling", () => {
		it("should subscribe on mount and unsubscribe on unmount", () => {
			const { unmount } = render(<ChatView onExit={mockOnExit} />)
			expect(shutdownMockState.listeners.length).toBe(1)

			unmount()
			expect(shutdownMockState.listeners.length).toBe(0)
		})

		it("should hide UI when shutdown event fires", async () => {
			const { lastFrame } = render(<ChatView onExit={mockOnExit} />)

			expect(lastFrame()).toContain("Input:")

			shutdownMockState.fire()
			await delay()

			expect(lastFrame()).not.toContain("Input:")
		})
	})

	describe("Edge cases", () => {
		it("should handle exit when onExit prop is undefined", async () => {
			const { lastFrame, stdin } = render(<ChatView />)

			stdin.write("\x03")
			await delay()

			// Should not throw, UI should still hide
			expect(lastFrame()).not.toContain("Input:")
		})

		it("should handle multiple Ctrl+C presses gracefully", async () => {
			const { stdin } = render(<ChatView onExit={mockOnExit} />)

			stdin.write("\x03")
			stdin.write("\x03")
			stdin.write("\x03")

			await delay()

			expect(mockOnExit).toHaveBeenCalled()
		})
	})
})

describe("ChatView UI State During Exit", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		shutdownMockState.reset()
	})

	it("should preserve static content and footer, only hide input during exit", async () => {
		const onExit = createExitMock()
		const { lastFrame, stdin } = render(<ChatView onExit={onExit} />)

		// Footer contains auto-approve toggle
		expect(lastFrame()).toContain("Auto-approve")
		expect(lastFrame()).toContain("What can I do for you?")
		expect(lastFrame()).toContain("Input:")

		stdin.write("\x03")
		await delay()

		const frameAfter = lastFrame()

		// Static content should still be present
		expect(frameAfter).toContain("What can I do for you?")
		// Footer should still be present (only input is hidden)
		expect(frameAfter).toContain("Auto-approve")
		// Input should be hidden
		expect(frameAfter).not.toContain("Input:")
	})
})
