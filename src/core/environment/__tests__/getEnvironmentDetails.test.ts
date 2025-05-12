// npx jest src/core/environment/__tests__/getEnvironmentDetails.test.ts

import pWaitFor from "p-wait-for"
import delay from "delay"

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

jest.mock("vscode", () => ({
	window: {
		tabGroups: { all: [], onDidChangeTabs: jest.fn() },
		visibleTextEditors: [],
	},
	env: {
		language: "en-US",
	},
}))

jest.mock("p-wait-for")

jest.mock("delay")

jest.mock("execa", () => ({
	execa: jest.fn(),
}))

jest.mock("../../../shared/experiments")
jest.mock("../../../shared/modes")
jest.mock("../../../shared/getApiMetrics")
jest.mock("../../../services/glob/list-files")
jest.mock("../../../integrations/terminal/TerminalRegistry")
jest.mock("../../../integrations/terminal/Terminal")
jest.mock("../../../utils/path")
jest.mock("../../prompts/responses")

describe("getEnvironmentDetails", () => {
	const mockCwd = "/test/path"
	const mockTaskId = "test-task-id"

	type MockTerminal = {
		id: string
		getLastCommand: jest.Mock
		getProcessesWithOutput: jest.Mock
		cleanCompletedProcessQueue?: jest.Mock
	}

	let mockCline: Partial<Task>
	let mockProvider: any
	let mockState: any

	beforeEach(() => {
		jest.clearAllMocks()

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
			getState: jest.fn().mockResolvedValue(mockState),
		}

		mockCline = {
			cwd: mockCwd,
			taskId: mockTaskId,
			didEditFile: false,
			fileContextTracker: {
				getAndClearRecentlyModifiedFiles: jest.fn().mockReturnValue([]),
			} as unknown as FileContextTracker,
			rooIgnoreController: {
				filterPaths: jest.fn((paths: string[]) => paths.join("\n")),
				cwd: mockCwd,
				ignoreInstance: {},
				disposables: [],
				rooIgnoreContent: "",
				isPathIgnored: jest.fn(),
				getIgnoreContent: jest.fn(),
				updateIgnoreContent: jest.fn(),
				addToIgnore: jest.fn(),
				removeFromIgnore: jest.fn(),
				dispose: jest.fn(),
			} as unknown as RooIgnoreController,
			clineMessages: [],
			api: {
				getModel: jest.fn().mockReturnValue({ id: "test-model", info: { contextWindow: 100000 } }),
				createMessage: jest.fn(),
				countTokens: jest.fn(),
			} as unknown as ApiHandler,
			diffEnabled: true,
			providerRef: {
				deref: jest.fn().mockReturnValue(mockProvider),
				[Symbol.toStringTag]: "WeakRef",
			} as unknown as WeakRef<ClineProvider>,
		}

		// Mock other dependencies.
		;(getApiMetrics as jest.Mock).mockReturnValue({ contextTokens: 50000, totalCost: 0.25 })
		;(getFullModeDetails as jest.Mock).mockResolvedValue({
			name: "💻 Code",
			roleDefinition: "You are a code assistant",
			customInstructions: "Custom instructions",
		})
		;(isToolAllowedForMode as jest.Mock).mockReturnValue(true)
		;(listFiles as jest.Mock).mockResolvedValue([["file1.ts", "file2.ts"], false])
		;(formatResponse.formatFilesList as jest.Mock).mockReturnValue("file1.ts\nfile2.ts")
		;(arePathsEqual as jest.Mock).mockReturnValue(false)
		;(Terminal.compressTerminalOutput as jest.Mock).mockImplementation((output: string) => output)
		;(TerminalRegistry.getTerminals as jest.Mock).mockReturnValue([])
		;(TerminalRegistry.getBackgroundTerminals as jest.Mock).mockReturnValue([])
		;(TerminalRegistry.isProcessHot as jest.Mock).mockReturnValue(false)
		;(TerminalRegistry.getUnretrievedOutput as jest.Mock).mockReturnValue("")
		;(pWaitFor as unknown as jest.Mock).mockResolvedValue(undefined)
		;(delay as jest.Mock).mockResolvedValue(undefined)
	})

	it("should return basic environment details", async () => {
		const result = await getEnvironmentDetails(mockCline as Task)

		expect(result).toContain("<environment_details>")
		expect(result).toContain("</environment_details>")
		expect(result).toContain("# VSCode Visible Files")
		expect(result).toContain("# VSCode Open Tabs")
		expect(result).toContain("# Current Time")
		expect(result).toContain("# Current Context Size (Tokens)")
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
		;(arePathsEqual as jest.Mock).mockReturnValue(true)
		const result = await getEnvironmentDetails(mockCline as Task, true)
		expect(result).toContain("Desktop files not shown automatically")
		expect(listFiles).not.toHaveBeenCalled()
	})

	it("should include recently modified files if any", async () => {
		;(mockCline.fileContextTracker!.getAndClearRecentlyModifiedFiles as jest.Mock).mockReturnValue([
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
			getLastCommand: jest.fn().mockReturnValue("npm test"),
			getProcessesWithOutput: jest.fn().mockReturnValue([]),
		} as MockTerminal

		;(TerminalRegistry.getTerminals as jest.Mock).mockReturnValue([mockActiveTerminal])
		;(TerminalRegistry.getUnretrievedOutput as jest.Mock).mockReturnValue("Test output")

		const result = await getEnvironmentDetails(mockCline as Task)

		expect(result).toContain("# Actively Running Terminals")
		expect(result).toContain("Original command: `npm test`")
		expect(result).toContain("Test output")

		mockCline.didEditFile = true
		await getEnvironmentDetails(mockCline as Task)
		expect(delay).toHaveBeenCalledWith(300)

		expect(pWaitFor).toHaveBeenCalled()
	})

	it("should include inactive terminals with output", async () => {
		const mockProcess = {
			command: "npm build",
			getUnretrievedOutput: jest.fn().mockReturnValue("Build output"),
		}

		const mockInactiveTerminal = {
			id: "terminal-2",
			getProcessesWithOutput: jest.fn().mockReturnValue([mockProcess]),
			cleanCompletedProcessQueue: jest.fn(),
		} as MockTerminal

		;(TerminalRegistry.getTerminals as jest.Mock).mockImplementation((active: boolean) =>
			active ? [] : [mockInactiveTerminal],
		)

		const result = await getEnvironmentDetails(mockCline as Task)

		expect(result).toContain("# Inactive Terminals with Completed Process Output")
		expect(result).toContain("Terminal terminal-2")
		expect(result).toContain("Command: `npm build`")
		expect(result).toContain("Build output")

		expect(mockInactiveTerminal.cleanCompletedProcessQueue).toHaveBeenCalled()
	})

	it("should include warning when file writing is not allowed", async () => {
		;(isToolAllowedForMode as jest.Mock).mockReturnValue(false)
		;(getModeBySlug as jest.Mock).mockImplementation((slug: string) => {
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
		;(experiments.isEnabled as jest.Mock).mockReturnValue(true)

		const result = await getEnvironmentDetails(mockCline as Task)

		expect(result).toContain("<role>You are a code assistant</role>")
		expect(result).toContain("<custom_instructions>Custom instructions</custom_instructions>")
	})

	it("should handle missing provider or state", async () => {
		// Mock provider to return null.
		mockCline.providerRef!.deref = jest.fn().mockReturnValue(null)

		const result = await getEnvironmentDetails(mockCline as Task)

		// Verify the function still returns a result.
		expect(result).toContain("<environment_details>")
		expect(result).toContain("</environment_details>")

		// Mock provider to return null state.
		mockCline.providerRef!.deref = jest.fn().mockReturnValue({
			getState: jest.fn().mockResolvedValue(null),
		})

		const result2 = await getEnvironmentDetails(mockCline as Task)

		// Verify the function still returns a result.
		expect(result2).toContain("<environment_details>")
		expect(result2).toContain("</environment_details>")
	})

	it("should handle errors gracefully", async () => {
		;(pWaitFor as unknown as jest.Mock).mockRejectedValue(new Error("Test error"))

		const mockErrorTerminal = {
			id: "terminal-1",
			getLastCommand: jest.fn().mockReturnValue("npm test"),
			getProcessesWithOutput: jest.fn().mockReturnValue([]),
		} as MockTerminal

		;(TerminalRegistry.getTerminals as jest.Mock).mockReturnValue([mockErrorTerminal])
		;(TerminalRegistry.getBackgroundTerminals as jest.Mock).mockReturnValue([])
		;(mockCline.fileContextTracker!.getAndClearRecentlyModifiedFiles as jest.Mock).mockReturnValue([])

		await expect(getEnvironmentDetails(mockCline as Task)).resolves.not.toThrow()
	})
})
