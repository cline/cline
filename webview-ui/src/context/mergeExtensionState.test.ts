import { describe, expect, it } from "vitest"
import type { ExtensionState } from "../../../src/shared/ExtensionMessage"
import { mergeExtensionStateSnapshot } from "./mergeExtensionState"

const createState = (): ExtensionState =>
	({
		version: "test",
		clineMessages: [],
		taskHistory: [],
		shouldShowAnnouncement: false,
		autoApprovalSettings: { enabled: false, actions: {}, version: 1 },
		browserSettings: { viewport: "desktop", screencast: true },
		focusChainSettings: { enabled: false, reminderIntervalRequests: 5 },
		preferredLanguage: "English",
		mode: "act",
		platform: "macOS",
		environment: "production",
		telemetrySetting: "unset",
		distinctId: "distinct-id",
		planActSeparateModelsSetting: true,
		enableCheckpointsSetting: true,
		mcpDisplayMode: "sidebar",
		globalClineRulesToggles: {},
		localClineRulesToggles: {},
		localCursorRulesToggles: {},
		localWindsurfRulesToggles: {},
		localAgentsRulesToggles: {},
		localWorkflowToggles: {},
		globalWorkflowToggles: {},
		shellIntegrationTimeout: 4_000,
		terminalReuseEnabled: true,
		vscodeTerminalExecutionMode: "vscodeTerminal",
		terminalOutputLineLimit: 500,
		maxConsecutiveMistakes: 3,
		defaultTerminalProfile: "default",
		isNewUser: false,
		welcomeViewCompleted: true,
		strictPlanModeEnabled: false,
		yoloModeToggled: false,
		useAutoCondense: false,
		subagentsEnabled: false,
		clineWebToolsEnabled: { user: true, featureFlag: false },
		worktreesEnabled: { user: true, featureFlag: false },
		favoritedModelIds: [],
		lastDismissedInfoBannerVersion: 0,
		lastDismissedModelBannerVersion: 0,
		lastDismissedCliBannerVersion: 0,
		remoteConfigSettings: {},
		onboardingModels: undefined,
		backgroundCommandRunning: false,
		backgroundCommandTaskId: undefined,
		backgroundEditEnabled: false,
		doubleCheckCompletionEnabled: false,
		globalSkillsToggles: {},
		localSkillsToggles: {},
		mcpResponsesCollapsed: false,
		customPrompt: undefined,
		workspaceRoots: [],
		primaryRootIndex: 0,
		isMultiRootWorkspace: false,
		multiRootSetting: { user: false, featureFlag: false },
		hooksEnabled: false,
		nativeToolCallSetting: false,
		enableParallelToolCalling: false,
		currentTaskItem: {
			id: "task-1",
			ts: 1,
			task: "demo",
			tokensIn: 0,
			tokensOut: 0,
			cacheWrites: 0,
			cacheReads: 0,
			totalCost: 0,
			size: 0,
			cwdOnTaskInitialization: "/workspace",
			isFavorited: false,
		},
	}) as unknown as ExtensionState

describe("mergeExtensionStateSnapshot", () => {
	it("returns the previous object when the incoming snapshot is a no-op", () => {
		const state = createState()
		const merged = mergeExtensionStateSnapshot(state, { ...state, clineMessages: [] })
		expect(merged).toBe(state)
	})

	it("preserves previous messages for the same task when snapshot omits them", () => {
		const prev = createState()
		prev.clineMessages = [{ ts: 10, type: "say", say: "text", text: "hello" } as any]

		const incoming = { ...createState(), currentTaskItem: prev.currentTaskItem, clineMessages: [] }
		const merged = mergeExtensionStateSnapshot(prev, incoming)

		expect(merged.clineMessages).toBe(prev.clineMessages)
	})

	it("preserves previous auto-approval settings when the incoming version is older", () => {
		const prev = createState()
		prev.autoApprovalSettings = { enabled: true, actions: { readFiles: true }, version: 3 } as any

		const incoming = createState()
		incoming.autoApprovalSettings = { enabled: false, actions: {}, version: 1 } as any

		const merged = mergeExtensionStateSnapshot(prev, incoming)
		expect(merged.autoApprovalSettings).toBe(prev.autoApprovalSettings)
	})
})
