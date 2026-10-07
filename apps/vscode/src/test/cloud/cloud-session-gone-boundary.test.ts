import { afterEach, describe, expect, it, vi } from "vitest"
import { MessageIdMinter } from "@/sdk/message-id-minter"
import { SdkCloudSessionCoordinator, type SdkCloudSessionCoordinatorOptions } from "@/sdk/sdk-cloud-session-coordinator"
import type { TaskProxy } from "@/sdk/task-proxy"
import { CloudSessionsService } from "@/services/cloud/CloudSessionsService"
import { type LocalCloudEnvironment, startLocalCloudEnvironment } from "./local-cloud-environment"

// Only the IDE window and model-catalog refresh are replaced; the control
// plane, proxy, Hub transport and coordinator are the shipped implementations.
vi.mock("@/hosts/host-provider", () => ({ HostProvider: { window: { showMessage: vi.fn(async () => ({})) } } }))
vi.mock("@/core/controller/models/refreshClineRecommendedModels", () => ({ refreshClineRecommendedModels: vi.fn() }))

describe("opening a cloud session whose sandbox is gone", () => {
	let environment: LocalCloudEnvironment | undefined
	let coordinator: SdkCloudSessionCoordinator | undefined

	afterEach(async () => {
		await coordinator?.dispose()
		await environment?.dispose()
		coordinator = undefined
		environment = undefined
	})

	it("explains a session deleted from the dashboard and drops it from History", async () => {
		environment = await startLocalCloudEnvironment()
		const service = new CloudSessionsService({
			apiBaseUrl: environment.apiBaseUrl,
			appBaseUrl: environment.apiBaseUrl,
			getAuthToken: async () => environment?.accessToken,
			getActiveOrganizationId: () => undefined,
		})
		const record = await service.createSession({ modelId: "fixture-model", repoUrl: "https://github.com/cline/fixture" })
		let task: TaskProxy | undefined
		const invalidateHistoryCache = vi.fn()
		coordinator = new SdkCloudSessionCoordinator({
			cloudSessions: service,
			stateManager: { getGlobalSettingsKey: () => "act", getGlobalStateKey: () => ({}), setGlobalState: vi.fn() },
			sessionConfigBuilder: { build: vi.fn() },
			sessions: { attachExistingSession: vi.fn() },
			messages: { finalizeMessagesForSave: (messages: unknown) => messages },
			getMinter: () => new MessageIdMinter(),
			getTask: () => task,
			setTask: (next: TaskProxy | undefined) => {
				task = next
			},
			clearTask: async () => {
				task = undefined
				return () => false
			},
			claimTaskViewGeneration: () => () => false,
			getAuthToken: async () => environment?.accessToken,
			isSignedIn: () => true,
			isEnabled: () => true,
			resetMessageTranslator: vi.fn(),
			setTurnPhase: vi.fn(),
			postStateToWebview: vi.fn(async () => {}),
			invalidateHistoryCache,
			onAskResponse: vi.fn(),
			onCancelTask: vi.fn(),
		} as unknown as SdkCloudSessionCoordinatorOptions)

		// History lists the session, then someone deletes it in the dashboard.
		expect((await coordinator.listHistoryRecords()).map((row) => row.sessionId)).toEqual([record.id])
		await service.deleteSession(record.id)
		await coordinator.openCloudTask(record.id)

		const messages = task?.messageStateHandler.getClineMessages() ?? []
		expect(messages).toHaveLength(1)
		expect(messages[0]).toMatchObject({ say: "info" })
		expect(messages[0].text).toContain("was deleted")
		expect(messages[0].text).not.toContain("Unexpected server response")
		expect(invalidateHistoryCache).toHaveBeenCalled()
		expect(await coordinator.listHistoryRecords()).toEqual([])
	})
})
