import { describe, expect, it } from "vitest"
import type { ExtensionState } from "../../../src/shared/ExtensionMessage"
import type { TaskUiDelta } from "../../../src/shared/TaskUiDelta"
import { applyTaskUiDeltaToState } from "./taskUiDeltaState"

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

const createDelta = (overrides: Partial<TaskUiDelta>): TaskUiDelta =>
	({
		type: "task_state_resynced",
		taskId: "task-1",
		sequence: 1,
		...overrides,
	}) as TaskUiDelta

describe("applyTaskUiDeltaToState", () => {
	it("applies added and updated message deltas", () => {
		const state = createState()
		const added = applyTaskUiDeltaToState(
			state,
			createDelta({
				type: "message_added",
				message: { ts: 10, type: "say", say: "text", text: "hello" },
			}),
			0,
		)

		expect(added.kind).toBe("applied")
		if (added.kind !== "applied") {
			throw new Error("expected applied result")
		}
		expect(added.state.clineMessages).toHaveLength(1)

		const updated = applyTaskUiDeltaToState(
			added.state,
			createDelta({
				sequence: 2,
				type: "message_updated",
				message: { ts: 10, type: "say", say: "text", text: "updated" },
			}),
			added.nextSequence,
		)

		expect(updated.kind).toBe("applied")
		if (updated.kind !== "applied") {
			throw new Error("expected applied result")
		}
		expect(updated.state.clineMessages[0].text).toBe("updated")
	})

	it("requests a resync when a sequence gap is detected", () => {
		const state = createState()
		const result = applyTaskUiDeltaToState(
			state,
			createDelta({
				sequence: 3,
				type: "message_added",
				message: { ts: 10, type: "say", say: "text", text: "hello" },
			}),
			1,
		)

		expect(result).toEqual({ kind: "resync", nextSequence: 1 })
	})

	it("ignores deltas for other tasks", () => {
		const state = createState()
		const result = applyTaskUiDeltaToState(
			state,
			createDelta({
				taskId: "task-2",
				type: "message_added",
				message: { ts: 10, type: "say", say: "text", text: "hello" },
			}),
			0,
		)

		expect(result).toEqual({ kind: "ignored", nextSequence: 1 })
	})

	it("applies task metadata deltas without replacing the message list", () => {
		const state = createState()
		state.clineMessages = [{ ts: 10, type: "say", say: "text", text: "hello" }]

		const result = applyTaskUiDeltaToState(
			state,
			createDelta({
				type: "task_metadata_updated",
				metadata: {
					currentFocusChainChecklist: "- [x] done",
					backgroundCommandRunning: true,
					backgroundCommandTaskId: "task-1",
				},
			}),
			0,
		)

		expect(result.kind).toBe("applied")
		if (result.kind !== "applied") {
			throw new Error("expected applied result")
		}

		expect(result.state.currentFocusChainChecklist).toBe("- [x] done")
		expect(result.state.backgroundCommandRunning).toBe(true)
		expect(result.state.backgroundCommandTaskId).toBe("task-1")
		expect(result.state.clineMessages).toEqual(state.clineMessages)
	})
})
