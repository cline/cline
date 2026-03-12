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

	it("requests a full snapshot resync when the backend emits a task_state_resynced delta", () => {
		const state = createState()
		state.clineMessages = [{ ts: 10, type: "say", say: "text", text: "stale local state" } as any]

		const result = applyTaskUiDeltaToState(
			state,
			createDelta({
				sequence: 1,
				type: "task_state_resynced",
			}),
			0,
		)

		expect(result).toEqual({ kind: "resync", nextSequence: 0 })
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

	it("preserves state references when a metadata delta does not change values", () => {
		const state = createState()
		const result = applyTaskUiDeltaToState(
			state,
			createDelta({
				type: "task_metadata_updated",
				metadata: {
					backgroundCommandRunning: false,
					backgroundCommandTaskId: undefined,
				},
			}),
			0,
		)

		expect(result.kind).toBe("applied")
		if (result.kind !== "applied") {
			throw new Error("expected applied result")
		}
		expect(result.state).toBe(state)
	})

	it("preserves message array reference when an update delta is identical to existing content", () => {
		const state = createState()
		const existingMessage = { ts: 10, type: "say", say: "text", text: "hello" } as const
		state.clineMessages = [existingMessage as any]

		const result = applyTaskUiDeltaToState(
			state,
			createDelta({
				type: "message_updated",
				message: { ...existingMessage },
			}),
			0,
		)

		expect(result.kind).toBe("applied")
		if (result.kind !== "applied") {
			throw new Error("expected applied result")
		}
		expect(result.state).toBe(state)
		expect(result.state.clineMessages).toBe(state.clineMessages)
	})

	it("preserves state references when a delete delta targets a missing message", () => {
		const state = createState()
		state.clineMessages = [{ ts: 10, type: "say", say: "text", text: "hello" } as any]

		const result = applyTaskUiDeltaToState(
			state,
			createDelta({
				type: "message_deleted",
				messageTs: 999,
			}),
			0,
		)

		expect(result.kind).toBe("applied")
		if (result.kind !== "applied") {
			throw new Error("expected applied result")
		}
		expect(result.state).toBe(state)
		expect(result.state.clineMessages).toBe(state.clineMessages)
	})

	it("converges to the same final task state as an equivalent full snapshot", () => {
		const initialState = createState()

		const deltas: TaskUiDelta[] = [
			createDelta({
				sequence: 1,
				type: "message_added",
				message: { ts: 10, type: "say", say: "text", text: "hello" },
			}),
			createDelta({
				sequence: 2,
				type: "message_added",
				message: { ts: 20, type: "say", say: "reasoning", text: "thinking", partial: true },
			}),
			createDelta({
				sequence: 3,
				type: "message_updated",
				message: { ts: 20, type: "say", say: "reasoning", text: "thinking complete", partial: false },
			}),
			createDelta({
				sequence: 4,
				type: "task_metadata_updated",
				metadata: {
					backgroundCommandRunning: true,
					backgroundCommandTaskId: "task-1",
					currentFocusChainChecklist: "- [x] streamed",
				},
			}),
			createDelta({
				sequence: 5,
				type: "message_deleted",
				messageTs: 10,
			}),
		]

		let state = initialState
		let sequence = 0
		for (const delta of deltas) {
			const result = applyTaskUiDeltaToState(state, delta, sequence)
			expect(result.kind).toBe("applied")
			if (result.kind !== "applied") {
				throw new Error("expected applied result")
			}
			state = result.state
			sequence = result.nextSequence
		}

		const expectedSnapshot: ExtensionState = {
			...createState(),
			clineMessages: [{ ts: 20, type: "say", say: "reasoning", text: "thinking complete", partial: false } as any],
			backgroundCommandRunning: true,
			backgroundCommandTaskId: "task-1",
			currentFocusChainChecklist: "- [x] streamed",
		}

		expect(state.clineMessages).toEqual(expectedSnapshot.clineMessages)
		expect(state.backgroundCommandRunning).toBe(expectedSnapshot.backgroundCommandRunning)
		expect(state.backgroundCommandTaskId).toBe(expectedSnapshot.backgroundCommandTaskId)
		expect(state.currentFocusChainChecklist).toBe(expectedSnapshot.currentFocusChainChecklist)
	})

	it("applies ordered delta events sequentially while advancing the cursor", () => {
		let state = createState()
		let sequence = 0

		const orderedDeltas: TaskUiDelta[] = [
			createDelta({
				sequence: 1,
				type: "message_added",
				message: { ts: 100, type: "say", say: "text", text: "first" },
			}),
			createDelta({
				sequence: 2,
				type: "message_updated",
				message: { ts: 100, type: "say", say: "text", text: "first updated" },
			}),
			createDelta({
				sequence: 3,
				type: "task_metadata_updated",
				metadata: { backgroundCommandRunning: true },
			}),
		]

		for (const delta of orderedDeltas) {
			const result = applyTaskUiDeltaToState(state, delta, sequence)
			expect(result.kind).toBe("applied")
			if (result.kind !== "applied") {
				throw new Error("expected applied result")
			}
			state = result.state
			sequence = result.nextSequence
		}

		expect(sequence).toBe(3)
		expect(state.clineMessages).toEqual([{ ts: 100, type: "say", say: "text", text: "first updated" }])
		expect(state.backgroundCommandRunning).toBe(true)
	})
})
