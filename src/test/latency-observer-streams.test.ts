import type { State as ProtoState } from "@shared/proto/cline/state"
import type { ClineMessage as ProtoClineMessage } from "@shared/proto/cline/ui"
import { strict as assert } from "assert"
import { describe, it } from "mocha"
import { subscribeToState } from "@/core/controller/state/subscribeToState"
import { registerPartialMessageCallback, sendPartialMessageEvent } from "@/core/controller/ui/subscribeToPartialMessage"
import { getLatencyObserverService } from "@/services/latency/LatencyObserverService"
import type { ExtensionState } from "@/shared/ExtensionMessage"

describe("Latency observer state and partial-message adapters", () => {
	it("records full-state observer metrics when state updates are emitted", async () => {
		const observer = getLatencyObserverService()
		observer.reset()
		observer.markRequestStart("task-1", "task-1:req-1", 100)

		const state = {
			version: "test",
			isNewUser: false,
			welcomeViewCompleted: true,
			onboardingModels: undefined,
			autoApprovalSettings: { enabled: false, actions: {}, version: 1 },
			browserSettings: {
				viewport: undefined,
				userAgent: undefined,
				javaScriptEnabled: true,
			},
			mode: "act",
			clineMessages: [],
			currentTaskItem: {
				id: "task-1",
				ts: Date.now(),
				task: "latency test",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			} as ExtensionState["currentTaskItem"],
			mcpDisplayMode: "rich",
			planActSeparateModelsSetting: false,
			platform: "darwin",
			shouldShowAnnouncement: false,
			taskHistory: [],
			telemetrySetting: "unset",
			shellIntegrationTimeout: 4000,
			terminalOutputLineLimit: 500,
			maxConsecutiveMistakes: 3,
			distinctId: "test",
			globalClineRulesToggles: {},
			localClineRulesToggles: {},
			localWorkflowToggles: {},
			globalWorkflowToggles: {},
			localCursorRulesToggles: {},
			localWindsurfRulesToggles: {},
			localAgentsRulesToggles: {},
			focusChainSettings: { enabled: false, remindClineInterval: 6 },
			favoritedModelIds: [],
			workspaceRoots: [],
			primaryRootIndex: 0,
			isMultiRootWorkspace: false,
			multiRootSetting: { user: false, featureFlag: false },
			lastDismissedInfoBannerVersion: 0,
			lastDismissedModelBannerVersion: 0,
			lastDismissedCliBannerVersion: 0,
		} as unknown as ExtensionState

		const sentStates: ProtoState[] = []
		await subscribeToState({ getStateToPostToWebview: async () => state } as any, {} as any, async (message: ProtoState) => {
			sentStates.push(message)
		})

		assert.equal(sentStates.length, 1)
		const snapshot = observer.getSnapshot()
		assert.equal(snapshot.capabilities.fullStateMetrics, "supported")
		assert.equal(snapshot.capabilities.firstFullStateUpdate, "supported")
		assert.equal(snapshot.optionalCounters?.fullStatePushes, 1)
		assert.equal(snapshot.firstFullStateUpdate.stats.count, 1)
	})

	it("records partial-message observer metrics when partial events are emitted", async () => {
		const observer = getLatencyObserverService()
		observer.reset()
		observer.markRequestStart("task-2", "task-2:req-1", 100)

		const received: ProtoClineMessage[] = []
		const unregister = registerPartialMessageCallback((message) => {
			received.push(message)
		})

		const partialMessage = {
			ts: Date.now(),
			type: "say",
			say: "text",
			text: "partial",
		} as unknown as ProtoClineMessage

		await sendPartialMessageEvent(partialMessage)
		unregister()

		assert.equal(received.length, 1)
		const snapshot = observer.getSnapshot()
		assert.equal(snapshot.capabilities.partialMessageMetrics, "supported")
		assert.equal(snapshot.capabilities.chunkToWebviewTiming, "supported")
		assert.equal(snapshot.optionalCounters?.partialMessageEvents, 1)
		assert.equal(snapshot.firstPartialMessageUpdate.stats.count, 0)
		assert.equal(snapshot.chunkToWebview.stats.count, 1)
		assert.equal((snapshot.optionalCounters?.partialMessageBytes ?? 0) > 0, true)
	})
})
