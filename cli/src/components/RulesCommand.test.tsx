import { Text } from "ink"
import { render } from "ink-testing-library"
import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../context/TaskContext", () => ({
	useTaskState: () => ({
		clineMessages: [],
		mode: "act",
	}),
	useTaskContext: () => ({
		controller: null,
		clearState: vi.fn(),
	}),
}))

vi.mock("../hooks/useStateSubscriber", () => ({
	useIsSpinnerActive: () => ({ isActive: false, startTime: null }),
}))

vi.mock("@/core/controller/slash/getAvailableSlashCommands", () => ({
	getAvailableSlashCommands: vi.fn().mockResolvedValue({ commands: [] }),
}))

vi.mock("@/core/controller/task/showTaskWithId", () => ({
	showTaskWithId: vi.fn(async () => {}),
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: vi.fn((key: string) => {
				if (key === "mode") return "act"
				if (key === "yoloModeToggled") return false
				if (key === "actModeApiModelId") return "claude-sonnet-4-20250514"
				return null
			}),
			getGlobalStateKey: vi.fn().mockReturnValue([]),
			getApiConfiguration: vi.fn().mockReturnValue({}),
			setGlobalState: vi.fn(),
		}),
	},
}))

vi.mock("@/services/telemetry", () => ({
	telemetryService: {
		captureHostEvent: vi.fn(),
	},
}))

vi.mock("@shared/services/Session", () => ({
	Session: {
		get: () => ({
			getStats: vi.fn().mockReturnValue({}),
		}),
	},
}))

vi.mock("child_process", () => ({
	execSync: vi.fn().mockReturnValue(""),
	exec: vi.fn(),
}))

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
	HighlightedInput: ({ text }: { text?: string }) => React.createElement(Text, null, `Input: ${text ?? ""}`),
}))

vi.mock("./HistoryPanelContent", () => ({
	HistoryPanelContent: () => React.createElement(Text, null, "HistoryPanel"),
}))

vi.mock("./RulesPanelContent", () => ({
	RulesPanelContent: () => React.createElement(Text, null, "RulesPanel"),
}))

vi.mock("./SettingsPanelContent", () => ({
	SettingsPanelContent: () => React.createElement(Text, null, "SettingsPanel"),
}))

vi.mock("./SkillsPanelContent", () => ({
	SkillsPanelContent: () => React.createElement(Text, null, "SkillsPanel"),
}))

vi.mock("./SlashCommandMenu", () => ({
	SlashCommandMenu: () => React.createElement(Text, null, "SlashMenu"),
}))

vi.mock("./ThinkingIndicator", () => ({
	ThinkingIndicator: () => React.createElement(Text, null, "ThinkingIndicator"),
}))

vi.mock("../utils/file-search", () => ({
	checkAndWarnRipgrepMissing: vi.fn(() => false),
	extractMentionQuery: vi.fn(() => ({ inMentionMode: false, query: "", atIndex: -1 })),
	getRipgrepInstallInstructions: vi.fn(() => "brew install ripgrep"),
	insertMention: vi.fn((text: string) => text),
	searchWorkspaceFiles: vi.fn(async () => []),
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

vi.mock("@shared/combineCommandSequences", () => ({
	combineCommandSequences: vi.fn((messages: unknown[]) => messages),
}))

vi.mock("@shared/getApiMetrics", () => ({
	getApiMetrics: vi.fn(() => ({
		totalTokensIn: 0,
		totalTokensOut: 0,
		totalCost: 0,
	})),
	getLastApiReqTotalTokens: vi.fn(() => 0),
}))

import { ChatView } from "./ChatView"

const delay = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))

const ControllerHarness = ({ dropAfterMs }: { dropAfterMs: number }) => {
	const [controller, setController] = React.useState<any>({})

	React.useEffect(() => {
		const timeout = setTimeout(() => setController(undefined), dropAfterMs)
		return () => clearTimeout(timeout)
	}, [dropAfterMs])

	return <ChatView controller={controller} />
}

describe("Rules command controller guards", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("does not open the rules panel after the controller disappears", async () => {
		const { stdin, lastFrame } = render(<ControllerHarness dropAfterMs={120} />)
		await delay(240)

		stdin.write("/rules")
		await delay()

		stdin.write("\r")
		await delay()

		const frame = lastFrame() || ""
		expect(frame).not.toContain("RulesPanel")
		expect(frame).toContain("Input:")
	})
})
