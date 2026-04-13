import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import type { ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import { describe, expect, it } from "vitest"
import type { DiskStateAdapter } from "../disk-state-adapter"
import { buildExtensionState, REQUIRED_STATE_FIELDS } from "../state-builder"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal mock DiskStateAdapter */
function mockDiskState(globalState: Record<string, unknown> = {}): DiskStateAdapter {
	const structuredAutoApproval = globalState.autoApprovalSettings as typeof DEFAULT_AUTO_APPROVAL_SETTINGS | undefined

	return {
		readGlobalState: () => globalState,
		readSecrets: () => ({}),
		readTaskHistory: () => [],
		readAutoApprovalSettings: () => ({
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			...(structuredAutoApproval ?? {}),
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				...(structuredAutoApproval?.actions ?? {}),
			},
		}),
	} as unknown as DiskStateAdapter
}

function makeClineMessage(overrides: Partial<ClineMessage> = {}): ClineMessage {
	return {
		ts: Date.now(),
		type: "say",
		say: "text",
		text: "Hello",
		...overrides,
	}
}

function makeHistoryItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
	return {
		id: `task_${Date.now()}`,
		ts: Date.now(),
		task: "Test task",
		tokensIn: 100,
		tokensOut: 50,
		totalCost: 0.001,
		...overrides,
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildExtensionState", () => {
	describe("default state (no input)", () => {
		it("returns a valid ExtensionState with sensible defaults", () => {
			const state = buildExtensionState()

			expect(state).toBeDefined()
			expect(state.version).toBe("0.0.0")
			expect(state.isNewUser).toBe(true)
			expect(state.welcomeViewCompleted).toBe(false)
			expect(state.mode).toBe("act")
			expect(state.clineMessages).toEqual([])
			expect(state.taskHistory).toEqual([])
			expect(state.shouldShowAnnouncement).toBe(false)
		})

		it("has correct default auto-approval settings", () => {
			const state = buildExtensionState()

			expect(state.autoApprovalSettings).toBeDefined()
			expect(state.autoApprovalSettings.enabled).toBe(true)
			expect(state.autoApprovalSettings.actions.readFiles).toBe(true)
			expect(state.autoApprovalSettings.actions.editFiles).toBe(false)
			expect(state.autoApprovalSettings.actions.executeAllCommands).toBe(false)
			expect(state.autoApprovalSettings.maxRequests).toBe(20)
		})

		it("has correct default browser settings", () => {
			const state = buildExtensionState()

			expect(state.browserSettings).toBeDefined()
			expect(state.browserSettings.viewport.width).toBe(900)
			expect(state.browserSettings.viewport.height).toBe(600)
			expect(state.browserSettings.disableToolUse).toBe(true)
		})

		it("has correct default terminal settings", () => {
			const state = buildExtensionState()

			expect(state.shellIntegrationTimeout).toBe(15000)
			expect(state.terminalOutputLineLimit).toBe(500)
			expect(state.maxConsecutiveMistakes).toBe(3)
			expect(state.vscodeTerminalExecutionMode).toBe("default")
		})

		it("has correct default rules toggles (all empty)", () => {
			const state = buildExtensionState()

			expect(state.globalClineRulesToggles).toEqual({})
			expect(state.localClineRulesToggles).toEqual({})
			expect(state.localWorkflowToggles).toEqual({})
			expect(state.globalWorkflowToggles).toEqual({})
			expect(state.localCursorRulesToggles).toEqual({})
			expect(state.localWindsurfRulesToggles).toEqual({})
			expect(state.localAgentsRulesToggles).toEqual({})
		})

		it("has correct default workspace info", () => {
			const state = buildExtensionState()

			expect(state.workspaceRoots).toEqual([])
			expect(state.primaryRootIndex).toBe(0)
			expect(state.isMultiRootWorkspace).toBe(false)
		})
	})

	describe("with persisted disk state", () => {
		it("reads mode from persisted disk state", () => {
			const state = buildExtensionState({
				diskState: mockDiskState({ mode: "plan" }),
			})

			expect(state.mode).toBe("plan")
		})

		it("reads auto-approval settings from persisted disk state", () => {
			const state = buildExtensionState({
				diskState: mockDiskState({
					autoApprovalSettings: {
						enabled: true,
						actions: {
							readFiles: true,
							editFiles: false,
							executeAllCommands: true,
							useBrowser: false,
							useMcp: false,
						},
						maxRequests: 50,
						enableNotifications: true,
						favorites: [],
						version: 1,
					},
				}),
			})

			expect(state.autoApprovalSettings.enabled).toBe(true)
			expect(state.autoApprovalSettings.actions.readFiles).toBe(true)
			expect(state.autoApprovalSettings.actions.executeAllCommands).toBe(true)
			expect(state.autoApprovalSettings.maxRequests).toBe(50)
		})

		it("reads task history from persisted disk state", () => {
			const items = [makeHistoryItem({ ts: 1000, task: "First task" }), makeHistoryItem({ ts: 2000, task: "Second task" })]

			const state = buildExtensionState({
				diskState: mockDiskState({ taskHistory: items }),
			})

			expect(state.taskHistory).toHaveLength(2)
			// Should be sorted by ts descending
			expect(state.taskHistory[0].task).toBe("Second task")
			expect(state.taskHistory[1].task).toBe("First task")
		})

		it("reads telemetry setting from persisted disk state", () => {
			const state = buildExtensionState({
				diskState: mockDiskState({ telemetrySetting: "enabled" }),
			})

			expect(state.telemetrySetting).toBe("enabled")
		})

		it("reads isNewUser from persisted disk state", () => {
			const state = buildExtensionState({
				diskState: mockDiskState({ isNewUser: false }),
			})

			expect(state.isNewUser).toBe(false)
		})

		it("reads welcomeViewCompleted from persisted disk state", () => {
			const state = buildExtensionState({
				diskState: mockDiskState({ welcomeViewCompleted: true }),
			})

			expect(state.welcomeViewCompleted).toBe(true)
		})
	})

	describe("with ClineMessages", () => {
		it("includes provided messages in state", () => {
			const messages: ClineMessage[] = [
				makeClineMessage({ say: "api_req_started", text: '{"tokensIn":0}' }),
				makeClineMessage({ say: "text", text: "Hello world" }),
			]

			const state = buildExtensionState({ clineMessages: messages })

			expect(state.clineMessages).toHaveLength(2)
			expect(state.clineMessages[0].say).toBe("api_req_started")
			expect(state.clineMessages[1].text).toBe("Hello world")
		})

		it("creates a new array reference (for React change detection)", () => {
			const messages: ClineMessage[] = [makeClineMessage()]
			const state = buildExtensionState({ clineMessages: messages })

			expect(state.clineMessages).not.toBe(messages)
			expect(state.clineMessages).toEqual(messages)
		})
	})

	describe("with task history", () => {
		it("filters out invalid items (no ts or task)", () => {
			const items = [
				makeHistoryItem({ ts: 1000, task: "Valid" }),
				{ id: "bad1", ts: 0, task: "Zero ts" } as HistoryItem,
				{ id: "bad2", ts: 1000, task: "" } as HistoryItem,
				makeHistoryItem({ ts: 2000, task: "Also valid" }),
			]

			const state = buildExtensionState({ taskHistory: items })

			expect(state.taskHistory).toHaveLength(2)
		})

		it("sorts by timestamp descending", () => {
			const items = [
				makeHistoryItem({ ts: 1000, task: "Old" }),
				makeHistoryItem({ ts: 3000, task: "Newest" }),
				makeHistoryItem({ ts: 2000, task: "Middle" }),
			]

			const state = buildExtensionState({ taskHistory: items })

			expect(state.taskHistory[0].task).toBe("Newest")
			expect(state.taskHistory[1].task).toBe("Middle")
			expect(state.taskHistory[2].task).toBe("Old")
		})

		it("limits to 100 items", () => {
			const items = Array.from({ length: 150 }, (_, i) => makeHistoryItem({ ts: i + 1, task: `Task ${i}` }))

			const state = buildExtensionState({ taskHistory: items })

			expect(state.taskHistory).toHaveLength(100)
			// Should have the newest 100
			expect(state.taskHistory[0].ts).toBe(150)
		})

		it("prefers explicit taskHistory over persisted disk state", () => {
			const explicit = [makeHistoryItem({ ts: 1000, task: "Explicit" })]
			const storedStateHistory = [makeHistoryItem({ ts: 2000, task: "Persisted" })]

			const state = buildExtensionState({
				taskHistory: explicit,
				diskState: mockDiskState({ taskHistory: storedStateHistory }),
			})

			expect(state.taskHistory).toHaveLength(1)
			expect(state.taskHistory[0].task).toBe("Explicit")
		})
	})

	describe("with API configuration", () => {
		it("uses provided apiConfiguration", () => {
			const config = {
				actModeApiProvider: "anthropic" as const,
				actModeApiModelId: "claude-sonnet-4-20250514",
			}

			const state = buildExtensionState({ apiConfiguration: config })

			expect(state.apiConfiguration).toBeDefined()
			expect(state.apiConfiguration?.actModeApiProvider).toBe("anthropic")
			expect(state.apiConfiguration?.actModeApiModelId).toBe("claude-sonnet-4-20250514")
		})

		it("falls back to persisted disk state apiConfiguration", () => {
			const state = buildExtensionState({
				diskState: mockDiskState({
					apiConfiguration: {
						actModeApiProvider: "openrouter",
						actModeApiModelId: "some-model",
					},
				}),
			})

			expect(state.apiConfiguration?.actModeApiProvider).toBe("openrouter")
		})
	})

	describe("with version, platform, distinctId", () => {
		it("uses provided values", () => {
			const state = buildExtensionState({
				version: "3.5.0",
				platform: "darwin",
				distinctId: "test-id-123",
			})

			expect(state.version).toBe("3.5.0")
			expect(state.platform).toBe("darwin")
			expect(state.distinctId).toBe("test-id-123")
		})
	})

	describe("with current task item", () => {
		it("includes currentTaskItem in state", () => {
			const item = makeHistoryItem({ id: "task_123", task: "Current task" })
			const state = buildExtensionState({ currentTaskItem: item })

			expect(state.currentTaskItem).toBeDefined()
			expect(state.currentTaskItem!.id).toBe("task_123")
			expect(state.currentTaskItem!.task).toBe("Current task")
		})
	})

	describe("overrides", () => {
		it("applies overrides on top of computed state", () => {
			const state = buildExtensionState({
				overrides: {
					isNewUser: false,
					shouldShowAnnouncement: true,
					mode: "plan",
				},
			})

			expect(state.isNewUser).toBe(false)
			expect(state.shouldShowAnnouncement).toBe(true)
			expect(state.mode).toBe("plan")
		})

		it("overrides trump all other sources", () => {
			const state = buildExtensionState({
				mode: "act",
				diskState: mockDiskState({ mode: "plan" }),
				overrides: { mode: "plan" },
			})

			expect(state.mode).toBe("plan")
		})
	})
})

// ---------------------------------------------------------------------------
// Interface contract tests
// ---------------------------------------------------------------------------

describe("Interface Contract", () => {
	it("all REQUIRED_STATE_FIELDS are present in default state", () => {
		const state = buildExtensionState()

		for (const field of REQUIRED_STATE_FIELDS) {
			expect(state).toHaveProperty(field)
		}
	})

	it("required fields have correct types in fresh install state", () => {
		const state = buildExtensionState()

		// String fields
		expect(state.version).toBeTypeOf("string")
		expect(state.distinctId).toBeTypeOf("string")
		expect(state.platform).toBeTypeOf("string")
		expect(state.mode).toMatch(/^(act|plan)$/)
		expect(state.vscodeTerminalExecutionMode).toBeTypeOf("string")

		// Boolean fields
		expect(state.isNewUser).toBeTypeOf("boolean")
		expect(state.welcomeViewCompleted).toBeTypeOf("boolean")
		expect(state.shouldShowAnnouncement).toBeTypeOf("boolean")
		expect(state.planActSeparateModelsSetting).toBeTypeOf("boolean")
		expect(state.isMultiRootWorkspace).toBeTypeOf("boolean")

		// Number fields
		expect(state.shellIntegrationTimeout).toBeTypeOf("number")
		expect(state.terminalOutputLineLimit).toBeTypeOf("number")
		expect(state.maxConsecutiveMistakes).toBeTypeOf("number")
		expect(state.primaryRootIndex).toBeTypeOf("number")

		// Array fields
		expect(state.clineMessages).toBeInstanceOf(Array)
		expect(state.taskHistory).toBeInstanceOf(Array)
		expect(state.workspaceRoots).toBeInstanceOf(Array)
		expect(state.favoritedModelIds).toBeInstanceOf(Array)

		// Object fields
		expect(state.autoApprovalSettings).toBeTypeOf("object")
		expect(state.browserSettings).toBeTypeOf("object")
		expect(state.focusChainSettings).toBeTypeOf("object")
		expect(state.globalClineRulesToggles).toBeTypeOf("object")
		expect(state.localClineRulesToggles).toBeTypeOf("object")
		expect(state.localCursorRulesToggles).toBeTypeOf("object")
		expect(state.localWindsurfRulesToggles).toBeTypeOf("object")
		expect(state.localAgentsRulesToggles).toBeTypeOf("object")
		expect(state.localWorkflowToggles).toBeTypeOf("object")
		expect(state.globalWorkflowToggles).toBeTypeOf("object")
	})

	it("required fields have correct types in active session state", () => {
		const messages: ClineMessage[] = [
			makeClineMessage({ say: "task", text: "Build a web app" }),
			makeClineMessage({ say: "api_req_started", text: '{"tokensIn":100}' }),
			makeClineMessage({ say: "text", text: "I will help you build that." }),
		]

		const state = buildExtensionState({
			clineMessages: messages,
			currentTaskItem: makeHistoryItem({ id: "active-task" }),
			mode: "act",
			version: "3.5.0",
			apiConfiguration: {
				actModeApiProvider: "anthropic" as const,
				actModeApiModelId: "claude-sonnet-4-20250514",
			},
		})

		expect(state.currentTaskItem).toBeDefined()
		expect(state.currentTaskItem!.id).toBe("active-task")
		expect(state.clineMessages).toHaveLength(3)
		expect(state.apiConfiguration?.actModeApiProvider).toBe("anthropic")
	})

	it("settings round-trip: persisted disk state → ExtensionState preserves values", () => {
		const storedState = mockDiskState({
			mode: "plan",
			isNewUser: false,
			welcomeViewCompleted: true,
			telemetrySetting: "enabled",
			shellIntegrationTimeout: 30000,
			terminalOutputLineLimit: 1000,
			maxConsecutiveMistakes: 5,
			planActSeparateModelsSetting: true,
			strictPlanModeEnabled: true,
			yoloModeToggled: true,
			useAutoCondense: true,
			subagentsEnabled: true,
			hooksEnabled: true,
			customPrompt: "Be concise.",
			preferredLanguage: "ja",
			mcpDisplayMode: "collapsed",
			globalClineRulesToggles: { "my-rule.md": true },
			globalWorkflowToggles: { "my-workflow.md": false },
			favoritedModelIds: ["model-1", "model-2"],
		})

		const state = buildExtensionState({ diskState: storedState })

		expect(state.mode).toBe("plan")
		expect(state.isNewUser).toBe(false)
		expect(state.welcomeViewCompleted).toBe(true)
		expect(state.telemetrySetting).toBe("enabled")
		expect(state.shellIntegrationTimeout).toBe(30000)
		expect(state.terminalOutputLineLimit).toBe(1000)
		expect(state.maxConsecutiveMistakes).toBe(5)
		expect(state.planActSeparateModelsSetting).toBe(true)
		expect(state.strictPlanModeEnabled).toBe(true)
		expect(state.yoloModeToggled).toBe(true)
		expect(state.useAutoCondense).toBe(true)
		expect(state.subagentsEnabled).toBe(true)
		expect(state.hooksEnabled).toBe(true)
		expect(state.customPrompt).toBe("Be concise.")
		expect(state.preferredLanguage).toBe("ja")
		expect(state.mcpDisplayMode).toBe("collapsed")
		expect(state.globalClineRulesToggles).toEqual({ "my-rule.md": true })
		expect(state.globalWorkflowToggles).toEqual({ "my-workflow.md": false })
		expect(state.favoritedModelIds).toEqual(["model-1", "model-2"])
	})

	it("state is JSON-serializable (can be sent via postMessage)", () => {
		const state = buildExtensionState({
			clineMessages: [makeClineMessage()],
			currentTaskItem: makeHistoryItem(),
		})

		// Should not throw
		const json = JSON.stringify(state)
		const parsed = JSON.parse(json) as ExtensionState

		expect(parsed.version).toBe(state.version)
		expect(parsed.clineMessages).toHaveLength(1)
		expect(parsed.currentTaskItem).toBeDefined()
	})
})
