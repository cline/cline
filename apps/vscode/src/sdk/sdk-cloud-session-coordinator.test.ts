import { describe, expect, it, vi } from "vitest"
import type { CloudSessionRecord } from "@/services/cloud/CloudSessionsService"
import { SdkCloudSessionCoordinator, type SdkCloudSessionCoordinatorOptions } from "./sdk-cloud-session-coordinator"

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

const record: CloudSessionRecord = {
	id: "ses-stale",
	status: "active",
	repoContext: { repoUrl: "https://github.com/cline/fixture", branch: "main" },
	metadata: { modelId: "fixture-model" },
	createdAt: new Date(0).toISOString(),
	updatedAt: new Date(0).toISOString(),
}

function makeCoordinator(overrides: Partial<SdkCloudSessionCoordinatorOptions> = {}) {
	let task: { taskId: string } | undefined
	const cloudSessions = {
		listSessions: vi.fn<() => Promise<CloudSessionRecord[]>>(async () => []),
		createSession: vi.fn(async () => record),
		deleteSession: vi.fn(async () => undefined),
		renameSession: vi.fn(async () => undefined),
		dashboardUrl: vi.fn((id: string) => `https://example.test/${id}`),
		sessionSocketUrl: vi.fn((id: string) => `ws://127.0.0.1/${id}`),
	}
	const options = {
		cloudSessions,
		stateManager: {
			getApiConfiguration: () => ({ actModeApiProvider: "cline", actModeClineModelId: "fixture-model" }),
			getGlobalSettingsKey: () => "act",
		},
		sessions: {},
		messages: { appendAndEmit: vi.fn(), finalizeMessagesForSave: vi.fn((messages) => messages) },
		getMinter: vi.fn(),
		getTask: () => task,
		setTask: (value: { taskId: string } | undefined) => {
			task = value
		},
		onAskResponse: vi.fn(async () => undefined),
		onCancelTask: vi.fn(async () => undefined),
		clearTask: vi.fn(async () => undefined),
		claimTaskViewGeneration: () => () => false,
		requestToolApproval: vi.fn(),
		getAuthToken: vi.fn(async () => "token"),
		isSignedIn: () => true,
		isEnabled: () => true,
		resetMessageTranslator: vi.fn(),
		setTurnPhase: vi.fn(),
		postStateToWebview: vi.fn(async () => undefined),
		invalidateHistoryCache: vi.fn(),
		resolveContextMentions: vi.fn(async (text: string) => text),
		...overrides,
	} as unknown as SdkCloudSessionCoordinatorOptions
	return { coordinator: new SdkCloudSessionCoordinator(options), cloudSessions, options }
}

describe("SdkCloudSessionCoordinator ownership", () => {
	it("rejects a list result that resolves after account scope reset", async () => {
		const list = deferred<CloudSessionRecord[]>()
		const { coordinator, cloudSessions } = makeCoordinator()
		cloudSessions.listSessions.mockReturnValueOnce(list.promise)

		const pending = coordinator.listHistoryRecords()
		await vi.waitFor(() => expect(cloudSessions.listSessions).toHaveBeenCalledOnce())
		await coordinator.reset()
		list.resolve([record])

		expect(await pending).toEqual([])
	})

	it("disposes every owned host during account scope reset", async () => {
		const dispose = vi.fn(async () => undefined)
		const { coordinator } = makeCoordinator()
		;(coordinator as unknown as { entries: Map<string, unknown> }).entries.set(record.id, {
			record,
			host: { dispose },
			lastActivityAt: 0,
		})

		await coordinator.reset()

		expect(dispose).toHaveBeenCalledWith("accountScopeChanged")
	})

	it("clears a displayed cloud task before disposing its old-scope host", async () => {
		const dispose = vi.fn(async () => undefined)
		const clearTask = vi.fn(async () => undefined)
		const { coordinator } = makeCoordinator({
			getTask: () => ({ taskId: record.id }) as never,
			clearTask,
		})
		;(coordinator as unknown as { entries: Map<string, unknown> }).entries.set(record.id, {
			record,
			host: { dispose },
			lastActivityAt: 0,
		})

		await coordinator.reset()

		expect(clearTask).toHaveBeenCalledOnce()
		expect(clearTask.mock.invocationCallOrder[0]).toBeLessThan(dispose.mock.invocationCallOrder[0])
	})

	it("deletes a sandbox created after the task view was superseded", async () => {
		const { coordinator, cloudSessions } = makeCoordinator({ claimTaskViewGeneration: () => () => true })

		const result = await coordinator.startCloudTask({
			prompt: "test",
			repoUrl: "https://github.com/cline/fixture",
		})

		expect(result).toBe(record.id)
		expect(cloudSessions.deleteSession).toHaveBeenCalledWith(record.id)
	})
})
