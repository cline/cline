import { describe, expect, it } from "vitest"
import type { ExtensionState } from "../../../src/shared/ExtensionMessage"
import { mergePartialMessage } from "./mergePartialMessage"

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
	}) as unknown as ExtensionState

describe("mergePartialMessage", () => {
	it("returns previous state when the target message does not exist", () => {
		const state = createState()
		const merged = mergePartialMessage(state, { ts: 1, type: "say", say: "text", text: "hello" } as any)
		expect(merged).toBe(state)
	})

	it("returns previous state when the partial message is unchanged", () => {
		const state = createState()
		state.clineMessages = [{ ts: 1, type: "say", say: "text", text: "hello", partial: true } as any]
		const merged = mergePartialMessage(state, { ts: 1, type: "say", say: "text", text: "hello", partial: true } as any)
		expect(merged).toBe(state)
	})

	it("replaces the matching message when the partial payload changes", () => {
		const state = createState()
		state.clineMessages = [{ ts: 1, type: "say", say: "text", text: "hello", partial: true } as any]
		const merged = mergePartialMessage(state, { ts: 1, type: "say", say: "text", text: "hello world", partial: true } as any)
		expect(merged).not.toBe(state)
		expect(merged.clineMessages).not.toBe(state.clineMessages)
		expect(merged.clineMessages[0]?.text).toBe("hello world")
	})

	it("patches only the matching active row and preserves unrelated message references", () => {
		const state = createState()
		const firstMessage = { ts: 1, type: "say", say: "text", text: "first" } as any
		const activeMessage = { ts: 2, type: "say", say: "text", text: "streaming", partial: true } as any
		state.clineMessages = [firstMessage, activeMessage]

		const merged = mergePartialMessage(state, {
			ts: 2,
			type: "say",
			say: "text",
			text: "streaming updated",
			partial: true,
		} as any)

		expect(merged).not.toBe(state)
		expect(merged.clineMessages).toHaveLength(2)
		expect(merged.clineMessages[0]).toBe(firstMessage)
		expect(merged.clineMessages[1]).not.toBe(activeMessage)
		expect(merged.clineMessages[1]?.text).toBe("streaming updated")
	})

	it("preserves message identity and timestamp semantics across partial-to-complete transitions", () => {
		const state = createState()
		state.clineMessages = [{ ts: 5, type: "say", say: "text", text: "partial", partial: true } as any]

		const merged = mergePartialMessage(state, {
			ts: 5,
			type: "say",
			say: "text",
			text: "final",
			partial: false,
		} as any)

		expect(merged.clineMessages).toHaveLength(1)
		expect(merged.clineMessages[0]?.ts).toBe(5)
		expect(merged.clineMessages[0]?.partial).toBe(false)
		expect(merged.clineMessages[0]?.text).toBe("final")
	})

	it("keeps message ordering stable during partial-to-complete transitions to avoid chat flicker", () => {
		const state = createState()
		const before = { ts: 1, type: "say", say: "text", text: "before" } as any
		const streaming = { ts: 2, type: "say", say: "text", text: "partial", partial: true } as any
		const after = { ts: 3, type: "say", say: "text", text: "after" } as any
		state.clineMessages = [before, streaming, after]

		const merged = mergePartialMessage(state, {
			ts: 2,
			type: "say",
			say: "text",
			text: "complete",
			partial: false,
		} as any)

		expect(merged.clineMessages).toHaveLength(3)
		expect(merged.clineMessages[0]).toBe(before)
		expect(merged.clineMessages[1]?.ts).toBe(2)
		expect(merged.clineMessages[1]?.text).toBe("complete")
		expect(merged.clineMessages[2]).toBe(after)
	})
})
