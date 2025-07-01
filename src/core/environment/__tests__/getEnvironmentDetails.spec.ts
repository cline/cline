// npx vitest core/environment/__tests__/getEnvironmentDetails.spec.ts

import pWaitFor from "p-wait-for"
import delay from "delay"
import type { Mock } from "vitest"

import { getEnvironmentDetails } from "../getEnvironmentDetails"
import { EXPERIMENT_IDS, experiments } from "../../../shared/experiments"
import { defaultModeSlug, getFullModeDetails, getModeBySlug, isToolAllowedForMode } from "../../../shared/modes"
import { getApiMetrics } from "../../../shared/getApiMetrics"
import { listFiles } from "../../../services/glob/list-files"
import { TerminalRegistry } from "../../../integrations/terminal/TerminalRegistry"
import { Terminal } from "../../../integrations/terminal/Terminal"
import { arePathsEqual } from "../../../utils/path"
import { FileContextTracker } from "../../context-tracking/FileContextTracker"
import { ApiHandler } from "../../../api/index"
import { ClineProvider } from "../../webview/ClineProvider"
import { RooIgnoreController } from "../../ignore/RooIgnoreController"
import { formatResponse } from "../../prompts/responses"
import { Task } from "../../task/Task"

vi.mock("vscode", () => ({
	window: {
		tabGroups: { all: [], onDidChangeTabs: vi.fn() },
		visibleTextEditors: [],
	},
	env: {
		language: "en-US",
	},
}))

vi.mock("p-wait-for", () => ({
	default: vi.fn(),
}))

vi.mock("delay", () => ({
	default: vi.fn(),
}))

vi.mock("execa", () => ({
	execa: vi.fn(),
}))

vi.mock("../../../shared/experiments")
vi.mock("../../../shared/modes")
vi.mock("../../../shared/getApiMetrics")
vi.mock("../../../services/glob/list-files")
vi.mock("../../../integrations/terminal/TerminalRegistry")
vi.mock("../../../integrations/terminal/Terminal")
vi.mock("../../../utils/path")
vi.mock("../../prompts/responses")

describe("getEnvironmentDetails", () => {
	const mockCwd = "/test/path"
	const mockTaskId = "test-task-id"

	type MockTerminal = {
		id: string
		getLastCommand: Mock
		getProcessesWithOutput: Mock
		cleanCompletedProcessQueue?: Mock
		getCurrentWorkingDirectory: Mock
	}

	let mockCline: Partial<Task>
	let mockProvider: any
	let mockState: any

	beforeEach(() => {
		vi.clearAllMocks()

		mockState = {
			terminalOutputLineLimit: 100,
			maxWorkspaceFiles: 50,
			maxOpenTabsContext: 10,
			mode: "code",
			customModes: [],
			experiments: {},
			customInstructions: "test instructions",
			language: "en",
			showRooIgnoredFiles: true,
		}

		mockProvider = {
			getState: vi.fn().mockResolvedValue(mockState),
		}

		mockCline = {
			cwd: mockCwd,
			taskId: mockTaskId,
			didEditFile: false,
			fileContextTracker: {
				getAndClearRecentlyModifiedFiles: vi.fn().mockReturnValue([]),
			} as unknown as FileContextTracker,
			rooIgnoreController: {
				filterPaths: vi.fn((paths: string[]) => paths.join("\n")),
				cwd: mockCwd,
				ignoreInstance: {},
				disposables: [],
				rooIgnoreContent: "",
				isPathIgnored: vi.fn(),
				getIgnoreContent: vi.fn(),
				updateIgnoreContent: vi.fn(),
				addToIgnore: vi.fn(),
				removeFromIgnore: vi.fn(),
				dispose: vi.fn(),
			} as unknown as RooIgnoreController,
			clineMessages: [],
			api: {
				getModel: vi.fn().mockReturnValue({ id: "test-model", info: { contextWindow: 100000 } }),
				createMessage: vi.fn(),
				countTokens: vi.fn(),
			} as unknown as ApiHandler,
			diffEnabled: true,
			providerRef: {
				deref: vi.fn().mockReturnValue(mockProvider),
				[Symbol.toStringTag]: "WeakRef",
			} as unknown as WeakRef<ClineProvider>,
		}

		// Mock other dependencies.
		;(getApiMetrics as Mock).mockReturnValue({ contextTokens: 50000, totalCost: 0.25 })
		;(getFullModeDetails as Mock).mockResolvedValue({
			name: "💻 Code",
			roleDefinition: "You are a code assistant",
			customInstructions: "Custom instructions",
		})
		;(isToolAllowedForMode as Mock).mockReturnValue(true)
		;(listFiles as Mock).mockResolvedValue([["file1.ts", "file2.ts"], false])
		;(formatResponse.formatFilesList as Mock).mockReturnValue("file1.ts\nfile2.ts")
		;(arePathsEqual as Mock).mockReturnValue(false)
		;(Terminal.compressTerminalOutput as Mock).mockImplementation((output: string) => output)
		;(TerminalRegistry.getTerminals as Mock).mockReturnValue([])
		;(TerminalRegistry.getBackgroundTerminals as Mock).mockReturnValue([])
		;(TerminalRegistry.isProcessHot as Mock).mockReturnValue(false)
		;(TerminalRegistry.getUnretrievedOutput as Mock).mockReturnValue("")
		vi.mocked(pWaitFor).mockResolvedValue(undefined)
		vi.mocked(delay).mockResolvedValue(undefined)
	})

	it("should return basic environment details", async () => {
		const result = await getEnvironmentDetails(mockCline as Task)

		expect(result).toContain("<environment_details>")
		expect(result).toContain("</environment_details>")
		expect(result).toContain("# VSCode Visible Files")
		expect(result).toContain("# VSCode Open Tabs")
		expect(result).toContain("# Current Time")
		expect(result).toContain("# Current Cost")
		expect(result).toContain("# Current Mode")
		expect(result).toContain("<model>test-model</model>")

		expect(mockProvider.getState).toHaveBeenCalled()

		expect(getFullModeDetails).toHaveBeenCalledWith("code", [], undefined, {
			cwd: mockCwd,
			globalCustomInstructions: "test instructions",
			language: "en",
		})

		expect(getApiMetrics).toHaveBeenCalledWith(mockCline.clineMessages)
	})

	it("should include file details when includeFileDetails is true", async () => {
		const result = await getEnvironmentDetails(mockCline as Task, true)
		expect(result).toContain("# Current Workspace Directory")
		expect(result).toContain("Files")

		expect(listFiles).toHaveBeenCalledWith(mockCwd, true, 50)

		expect(formatResponse.formatFilesList).toHaveBeenCalledWith(
			mockCwd,
			["file1.ts", "file2.ts"],
			false,
			mockCline.rooIgnoreController,
			true,
		)
	})

	it("should not include file details when includeFileDetails is false", async () => {
		await getEnvironmentDetails(mockCline as Task, false)
		expect(listFiles).not.toHaveBeenCalled()
		expect(formatResponse.formatFilesList).not.toHaveBeenCalled()
	})

	it("should handle desktop directory specially", async () => {
		;(arePathsEqual as Mock).mockReturnValue(true)
		const result = await getEnvironmentDetails(mockCline as Task, true)
		expect(result).toContain("Desktop files not shown automatically")
		expect(listFiles).not.toHaveBeenCalled()
	})

	it("should include recently modified files if any", async () => {
		;(mockCline.fileContextTracker!.getAndClearRecentlyModifiedFiles as Mock).mockReturnValue([
			"modified1.ts",
			"modified2.ts",
		])

		const result = await getEnvironmentDetails(mockCline as Task)

		expect(result).toContain("# Recently Modified Files")
		expect(result).toContain("modified1.ts")
		expect(result).toContain("modified2.ts")
	})

	it("should include active terminal information", async () => {
		const mockActiveTerminal = {
			id: "terminal-1",
			getLastCommand: vi.fn().mockReturnValue("npm test"),
			getProcessesWithOutput: vi.fn().mockReturnValue([]),
			getCurrentWorkingDirectory: vi.fn().mockReturnValue("/test/path/src"),
		} as MockTerminal

		;(TerminalRegistry.getTerminals as Mock).mockReturnValue([mockActiveTerminal])
		;(TerminalRegistry.getUnretrievedOutput as Mock).mockReturnValue("Test output")

		const result = await getEnvironmentDetails(mockCline as Task)

		expect(result).toContain("# Actively Running Terminals")
		expect(result).toContain("## Terminal terminal-1 (Active)")
		expect(result).toContain("### Working Directory: `/test/path/src`")
		expect(result).toContain("### Original command: `npm test`")
		expect(result).toContain("Test output")

		mockCline.didEditFile = true
		await getEnvironmentDetails(mockCline as Task)
		expect(vi.mocked(delay)).toHaveBeenCalledWith(300)

		expect(vi.mocked(pWaitFor)).toHaveBeenCalled()
	})

	it("should include inactive terminals with output", async () => {
		const mockProcess = {
			command: "npm build",
			getUnretrievedOutput: vi.fn().mockReturnValue("Build output"),
		}

		const mockInactiveTerminal = {
			id: "terminal-2",
			getLastCommand: vi.fn().mockReturnValue("npm build"),
			getProcessesWithOutput: vi.fn().mockReturnValue([mockProcess]),
			cleanCompletedProcessQueue: vi.fn(),
			getCurrentWorkingDirectory: vi.fn().mockReturnValue("/test/path/build"),
		} as MockTerminal

		;(TerminalRegistry.getTerminals as Mock).mockImplementation((active: boolean) =>
			active ? [] : [mockInactiveTerminal],
		)

		const result = await getEnvironmentDetails(mockCline as Task)

		expect(result).toContain("# Inactive Terminals with Completed Process Output")
		expect(result).toContain("## Terminal terminal-2 (Inactive)")
		expect(result).toContain("### Working Directory: `/test/path/build`")
		expect(result).toContain("Command: `npm build`")
		expect(result).toContain("Build output")

		expect(mockInactiveTerminal.cleanCompletedProcessQueue).toHaveBeenCalled()
	})

	it("should include working directory for terminals", async () => {
		const mockActiveTerminal = {
			id: "terminal-1",
			getLastCommand: vi.fn().mockReturnValue("cd /some/path && npm start"),
			getProcessesWithOutput: vi.fn().mockReturnValue([]),
			getCurrentWorkingDirectory: vi.fn().mockReturnValue("/some/path"),
		} as MockTerminal

		const mockProcess = {
			command: "npm test",
			getUnretrievedOutput: vi.fn().mockReturnValue("Test completed"),
		}

		const mockInactiveTerminal = {
			id: "terminal-2",
			getLastCommand: vi.fn().mockReturnValue("npm test"),
			getProcessesWithOutput: vi.fn().mockReturnValue([mockProcess]),
			cleanCompletedProcessQueue: vi.fn(),
			getCurrentWorkingDirectory: vi.fn().mockReturnValue("/another/path"),
		} as MockTerminal

		;(TerminalRegistry.getTerminals as Mock).mockImplementation((active: boolean) =>
			active ? [mockActiveTerminal] : [mockInactiveTerminal],
		)
		;(TerminalRegistry.getUnretrievedOutput as Mock).mockReturnValue("Server started")

		const result = await getEnvironmentDetails(mockCline as Task)

		// Check active terminal working directory
		expect(result).toContain("## Terminal terminal-1 (Active)")
		expect(result).toContain("### Working Directory: `/some/path`")
		expect(result).toContain("### Original command: `cd /some/path && npm start`")

		// Check inactive terminal working directory
		expect(result).toContain("## Terminal terminal-2 (Inactive)")
		expect(result).toContain("### Working Directory: `/another/path`")

		// Verify the methods were called
		expect(mockActiveTerminal.getCurrentWorkingDirectory).toHaveBeenCalled()
		expect(mockInactiveTerminal.getCurrentWorkingDirectory).toHaveBeenCalled()
	})

	it("should include warning when file writing is not allowed", async () => {
		;(isToolAllowedForMode as Mock).mockReturnValue(false)
		;(getModeBySlug as Mock).mockImplementation((slug: string) => {
			if (slug === "code") {
				return { name: "💻 Code" }
			}

			if (slug === defaultModeSlug) {
				return { name: "Default Mode" }
			}

			return null
		})

		const result = await getEnvironmentDetails(mockCline as Task)

		expect(result).toContain("NOTE: You are currently in '💻 Code' mode, which does not allow write operations")
	})

	it("should include experiment-specific details when Power Steering is enabled", async () => {
		mockState.experiments = { [EXPERIMENT_IDS.POWER_STEERING]: true }
		;(experiments.isEnabled as Mock).mockReturnValue(true)

		const result = await getEnvironmentDetails(mockCline as Task)

		expect(result).toContain("<role>You are a code assistant</role>")
		expect(result).toContain("<custom_instructions>Custom instructions</custom_instructions>")
	})

	it("should handle missing provider or state", async () => {
		// Mock provider to return null.
		mockCline.providerRef!.deref = vi.fn().mockReturnValue(null)

		const result = await getEnvironmentDetails(mockCline as Task)

		// Verify the function still returns a result.
		expect(result).toContain("<environment_details>")
		expect(result).toContain("</environment_details>")

		// Mock provider to return null state.
		mockCline.providerRef!.deref = vi.fn().mockReturnValue({
			getState: vi.fn().mockResolvedValue(null),
		})

		const result2 = await getEnvironmentDetails(mockCline as Task)

		// Verify the function still returns a result.
		expect(result2).toContain("<environment_details>")
		expect(result2).toContain("</environment_details>")
	})

	it("should handle errors gracefully", async () => {
		vi.mocked(pWaitFor).mockRejectedValue(new Error("Test error"))

		const mockErrorTerminal = {
			id: "terminal-1",
			getLastCommand: vi.fn().mockReturnValue("npm test"),
			getProcessesWithOutput: vi.fn().mockReturnValue([]),
			getCurrentWorkingDirectory: vi.fn().mockReturnValue("/test/path"),
		} as MockTerminal

		;(TerminalRegistry.getTerminals as Mock).mockReturnValue([mockErrorTerminal])
		;(TerminalRegistry.getBackgroundTerminals as Mock).mockReturnValue([])
		;(mockCline.fileContextTracker!.getAndClearRecentlyModifiedFiles as Mock).mockReturnValue([])

		await expect(getEnvironmentDetails(mockCline as Task)).resolves.not.toThrow()
	})
})
