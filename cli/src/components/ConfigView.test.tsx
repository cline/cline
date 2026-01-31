import { Text } from "ink"
import { render } from "ink-testing-library"
import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Create stable mock references using vi.hoisted - must be before any imports that use these modules
const { mockIsSettingsKey } = vi.hoisted(() => ({
	mockIsSettingsKey: vi.fn((key: string) => key.startsWith("act") || key.startsWith("plan") || key === "mode"),
}))

vi.mock("./TaskView", () => ({
	TaskView: ({ taskId, verbose }: any) =>
		React.createElement(Text, null, `TaskView: ${taskId || "no-id"} verbose=${String(verbose)}`),
}))

// Mock the state-keys module - must be hoisted before ConfigView import
vi.mock("@shared/storage/state-keys", () => ({
	isSettingsKey: mockIsSettingsKey,
	SETTINGS_DEFAULTS: {
		mode: "act",
		actModeApiProvider: "anthropic",
	},
	GlobalStateAndSettings: {},
	GlobalStateAndSettingsKey: {},
	LocalState: {},
	LocalStateKey: {},
}))

// Import ConfigView after mocks are set up
import { ConfigView } from "./ConfigView"

describe("ConfigView", () => {
	const defaultProps = {
		dataDir: "/home/user/.cline",
		globalState: {},
		workspaceState: {},
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("rendering", () => {
		it("should render the config header", () => {
			const { lastFrame } = render(<ConfigView {...defaultProps} />)
			expect(lastFrame()).toContain("Configuration")
		})

		it("should display the data directory", () => {
			const { lastFrame } = render(<ConfigView {...defaultProps} dataDir="/custom/path" />)
			expect(lastFrame()).toContain("/custom/path")
		})

		it("should display global state entries", () => {
			const { lastFrame } = render(
				<ConfigView
					{...defaultProps}
					globalState={{
						mode: "act",
						actModeApiProvider: "anthropic",
					}}
				/>,
			)
			expect(lastFrame()).toContain("mode")
			expect(lastFrame()).toContain("act")
		})

		it("should display workspace state entries", () => {
			const { lastFrame } = render(
				<ConfigView
					{...defaultProps}
					workspaceState={{
						customSetting: "value",
					}}
				/>,
			)
			expect(lastFrame()).toContain("customSetting")
			expect(lastFrame()).toContain("value")
		})

		it("should show section headers", () => {
			const { lastFrame } = render(
				<ConfigView {...defaultProps} globalState={{ mode: "act" }} workspaceState={{ localKey: "localValue" }} />,
			)
			expect(lastFrame()).toContain("Global Settings")
		})
	})

	describe("value formatting", () => {
		it("should format boolean values", () => {
			const { lastFrame } = render(<ConfigView {...defaultProps} globalState={{ actModeSomeBool: true }} />)
			expect(lastFrame()).toContain("true")
		})

		it("should format number values", () => {
			const { lastFrame } = render(<ConfigView {...defaultProps} globalState={{ actModeNumber: 42 }} />)
			expect(lastFrame()).toContain("42")
		})

		it("should truncate long string values", () => {
			const longString = "x".repeat(100)
			const { lastFrame } = render(<ConfigView {...defaultProps} globalState={{ actModeLongValue: longString }} />)
			expect(lastFrame()).toContain("...")
		})

		it("should format object values as JSON", () => {
			const { lastFrame } = render(<ConfigView {...defaultProps} globalState={{ actModeObj: { nested: "value" } }} />)
			expect(lastFrame()).toContain("nested")
		})
	})

	describe("filtering", () => {
		it("should exclude taskHistory key", () => {
			const { lastFrame } = render(<ConfigView {...defaultProps} globalState={{ taskHistory: [1, 2, 3], mode: "act" }} />)
			expect(lastFrame()).not.toContain("taskHistory")
		})

		it("should exclude empty objects", () => {
			const { lastFrame } = render(<ConfigView {...defaultProps} globalState={{ emptyObj: {}, mode: "act" }} />)
			expect(lastFrame()).not.toContain("emptyObj")
		})

		it("should exclude empty arrays", () => {
			const { lastFrame } = render(<ConfigView {...defaultProps} globalState={{ emptyArr: [], mode: "act" }} />)
			expect(lastFrame()).not.toContain("emptyArr")
		})

		it("should exclude null/undefined values", () => {
			const { lastFrame } = render(
				<ConfigView {...defaultProps} globalState={{ nullVal: null, undefinedVal: undefined, mode: "act" }} />,
			)
			expect(lastFrame()).not.toContain("nullVal")
			expect(lastFrame()).not.toContain("undefinedVal")
		})

		it("should exclude keys ending with Toggles", () => {
			const { lastFrame } = render(<ConfigView {...defaultProps} globalState={{ someToggles: { a: true }, mode: "act" }} />)
			expect(lastFrame()).not.toContain("someToggles")
		})

		it("should exclude keys starting with apiConfig_", () => {
			const { lastFrame } = render(<ConfigView {...defaultProps} globalState={{ apiConfig_test: "value", mode: "act" }} />)
			expect(lastFrame()).not.toContain("apiConfig_test")
		})
	})

	describe("keyboard navigation", () => {
		it("should show navigation help text", () => {
			const { lastFrame } = render(<ConfigView {...defaultProps} globalState={{ mode: "act" }} />)
			expect(lastFrame()).toContain("Navigate")
			expect(lastFrame()).toContain("Edit")
		})

		it("should highlight first item by default", () => {
			const { lastFrame } = render(
				<ConfigView {...defaultProps} globalState={{ mode: "act", actModeApiProvider: "anthropic" }} />,
			)
			// The selected indicator
			expect(lastFrame()).toContain("❯")
		})

		it("should navigate down with arrow key", () => {
			const { lastFrame, stdin } = render(
				<ConfigView {...defaultProps} globalState={{ actModeFirst: "a", actModeSecond: "b" }} />,
			)

			// Press down arrow
			stdin.write("\x1B[B")

			const frame = lastFrame()
			expect(frame).toContain("❯")
		})

		it("should navigate up with arrow key", () => {
			const { lastFrame, stdin } = render(
				<ConfigView {...defaultProps} globalState={{ actModeFirst: "a", actModeSecond: "b" }} />,
			)

			// Press down then up
			stdin.write("\x1B[B")
			stdin.write("\x1B[A")

			expect(lastFrame()).toContain("❯")
		})
	})

	describe("scrolling", () => {
		it("should show scroll indicators when list is long", () => {
			const manyEntries: Record<string, string> = {}
			for (let i = 0; i < 20; i++) {
				manyEntries[`actModeKey${i}`] = `value${i}`
			}

			const { lastFrame } = render(<ConfigView {...defaultProps} globalState={manyEntries} />)

			expect(lastFrame()).toContain("Showing")
		})
	})
})
