import { afterEach, describe, expect, it, vi } from "vitest"
import { HostProvider } from "@/hosts/host-provider"
import { CloudSessionError, type CloudSessionRecord } from "@/services/cloud/CloudSessionsService"
import { CloudSessionHost } from "./cloud-session-host"
import { MessageIdMinter } from "./message-id-minter"
import { SdkCloudSessionCoordinator, type SdkCloudSessionCoordinatorOptions } from "./sdk-cloud-session-coordinator"
import { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkSessionHost } from "./session-host"
import { createTaskProxy } from "./task-proxy"

vi.mock("@/hosts/host-provider", () => ({ HostProvider: { window: { showMessage: vi.fn(async () => ({})) } } }))

afterEach(() => vi.restoreAllMocks())

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((done, fail) => {
		resolve = done
		reject = fail
	})
	return { promise, resolve, reject }
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
		getMinter: () => new MessageIdMinter(),
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
	it("ignores a successful list after disposal", async () => {
		const list = deferred<CloudSessionRecord[]>()
		const entered = deferred<void>()
		const { coordinator, cloudSessions } = makeCoordinator()
		cloudSessions.listSessions.mockImplementationOnce(() => {
			entered.resolve()
			return list.promise
		})
		const pending = coordinator.listHistoryRecords()
		await entered.promise
		await coordinator.dispose()
		list.resolve([record])
		expect(await pending).toEqual([])
	})

	it("does not notify on initial discovery or let an old host update a same-id new-scope entry", async () => {
		let statusChanged!: NonNullable<Parameters<typeof CloudSessionHost.connect>[0]["onStatusChange"]>
		const host = { status: "completed", readMessages: async () => [], dispose: async () => {} } as unknown as CloudSessionHost
		vi.spyOn(CloudSessionHost, "connect").mockImplementation(async (options) => {
			if (!options.onStatusChange) throw new Error("Coordinator must observe host status")
			statusChanged = options.onStatusChange
			statusChanged("completed")
			return host
		})
		const { coordinator, cloudSessions, options } = makeCoordinator({
			sessions: { attachExistingSession: async () => {} } as never,
		})
		cloudSessions.listSessions.mockResolvedValue([record])
		await coordinator.openCloudTask(record.id)
		expect(HostProvider.window.showMessage).not.toHaveBeenCalled()
		await coordinator.reset()
		await coordinator.listHistoryRecords()
		vi.mocked(options.postStateToWebview).mockClear()
		statusChanged("running")
		statusChanged("completed")
		expect((await coordinator.listHistoryRecords())[0].metadata?.cloudStatus).toBe("unknown")
		expect(options.postStateToWebview).not.toHaveBeenCalled()
		expect(HostProvider.window.showMessage).not.toHaveBeenCalled()
		await coordinator.dispose()
	})

	it.each([
		"idle",
		"cancelled",
		"unknown",
		"completed",
	] as const)("opens %s with a truthful resume prompt and phase", async (status) => {
		const host = {
			status,
			readMessages: async () => [{ role: "user", content: "original prompt" }],
			dispose: async () => {},
		} as unknown as CloudSessionHost
		vi.spyOn(CloudSessionHost, "connect").mockResolvedValue(host)
		const { coordinator, cloudSessions, options } = makeCoordinator({
			sessions: { attachExistingSession: async () => {} } as never,
		})
		cloudSessions.listSessions.mockResolvedValue([record])
		await coordinator.openCloudTask(record.id)
		expect(options.getTask()?.messageStateHandler.getClineMessages().at(-1)?.ask).toBe(
			status === "completed" ? "resume_completed_task" : "resume_task",
		)
		expect(options.setTurnPhase).toHaveBeenLastCalledWith(
			...(status === "completed" ? ["completed", expect.any(Number)] : ["idle"]),
		)
		await coordinator.dispose()
	})
	it.each([
		"authentication_required",
		"request_failed",
	] as const)("ignores old-scope %s after the new History snapshot is installed", async (code) => {
		const oldList = deferred<CloudSessionRecord[]>()
		const entered = deferred<void>()
		const { coordinator, cloudSessions } = makeCoordinator()
		cloudSessions.listSessions.mockImplementationOnce(() => {
			entered.resolve()
			return oldList.promise
		})
		const pending = coordinator.listHistoryRecords()
		await entered.promise
		await coordinator.reset()
		const current = { ...record, id: "ses-current" }
		cloudSessions.listSessions.mockResolvedValue([current])
		expect(await coordinator.listHistoryRecords()).toMatchObject([{ sessionId: current.id }])
		oldList.reject(new CloudSessionError(code, "Old account failed"))
		await pending
		expect(await coordinator.listHistoryRecords()).toMatchObject([{ sessionId: current.id }])
		expect(cloudSessions.listSessions).toHaveBeenCalledTimes(2)
	})

	it("does not stamp a fresh cache timestamp when an old request fails after reset", async () => {
		const oldList = deferred<CloudSessionRecord[]>()
		const entered = deferred<void>()
		const { coordinator, cloudSessions } = makeCoordinator()
		cloudSessions.listSessions.mockImplementationOnce(() => {
			entered.resolve()
			return oldList.promise
		})
		const pending = coordinator.listHistoryRecords()
		await entered.promise
		await coordinator.reset()
		oldList.reject(new Error("Disconnected"))
		await pending
		cloudSessions.listSessions.mockResolvedValue([record])
		expect(await coordinator.listHistoryRecords()).toMatchObject([{ sessionId: record.id }])
		expect(cloudSessions.listSessions).toHaveBeenCalledTimes(2)
	})

	it("keeps ownership of a newer pending list when the old list settles", async () => {
		const oldList = deferred<CloudSessionRecord[]>()
		const newList = deferred<CloudSessionRecord[]>()
		const oldEntered = deferred<void>()
		const newEntered = deferred<void>()
		const { coordinator, cloudSessions } = makeCoordinator()
		cloudSessions.listSessions
			.mockImplementationOnce(() => {
				oldEntered.resolve()
				return oldList.promise
			})
			.mockImplementationOnce(() => {
				newEntered.resolve()
				return newList.promise
			})
		const first = coordinator.listHistoryRecords()
		await oldEntered.promise
		await coordinator.reset()
		const second = coordinator.listHistoryRecords()
		await newEntered.promise
		oldList.reject(new Error("old transport"))
		await first
		const third = coordinator.listHistoryRecords()
		newList.resolve([record])
		expect(await second).toEqual(await third)
		expect(cloudSessions.listSessions).toHaveBeenCalledTimes(2)
	})

	it("preserves a newer selection when real lifecycle attachment is superseded during teardown", async () => {
		const sessions = new SdkSessionLifecycle({
			mcpHub: {} as never,
			requestToolApproval: vi.fn(),
			askQuestion: vi.fn(),
			onSessionEvent: vi.fn(),
			onSendComplete: vi.fn(),
			onSendError: vi.fn(),
		})
		let superseded = false
		const host = {
			status: "idle",
			readMessages: async () => [],
			subscribe: () => () => {},
			stop: vi.fn(),
			dispose: async () => {},
		} as unknown as CloudSessionHost
		vi.spyOn(CloudSessionHost, "connect").mockResolvedValue(host)
		const { coordinator, cloudSessions, options } = makeCoordinator({
			sessions,
			claimTaskViewGeneration: () => () => superseded,
		})
		cloudSessions.listSessions.mockResolvedValue([record])
		const successor = createTaskProxy("newer-local-task", vi.fn(), vi.fn())
		// endActiveSession clears its reference and unsubscribes before yielding.
		// Re-entry from unsubscribe claims a newer task in that exact interval.
		await sessions.attachExistingSession({
			sdkHost: {
				...host,
				subscribe: () => () => {
					superseded = true
					options.setTask(successor)
				},
			} as unknown as SdkSessionHost,
			sessionId: "previous",
			isRunning: false,
		})
		await coordinator.openCloudTask(record.id)
		expect(options.getTask()).toBe(successor)
		expect(options.postStateToWebview).not.toHaveBeenCalled()
		expect(sessions.getActiveSession()).toBeUndefined()
		await coordinator.dispose()
	})

	it.each([false, true])("renders connection failure only for its current task claim (superseded=%s)", async (superseded) => {
		const connection = deferred<CloudSessionHost>()
		const entered = deferred<void>()
		let stale = false
		vi.spyOn(CloudSessionHost, "connect").mockImplementation(() => {
			entered.resolve()
			return connection.promise
		})
		const { coordinator, cloudSessions, options } = makeCoordinator({ claimTaskViewGeneration: () => () => stale })
		cloudSessions.listSessions.mockResolvedValue([record])
		const opening = coordinator.openCloudTask(record.id)
		await entered.promise
		const successor = createTaskProxy("newer-local-task", vi.fn(), vi.fn())
		stale = superseded
		if (superseded) options.setTask(successor)
		connection.reject(new Error("connection failed"))
		await opening
		expect(options.getTask()?.taskId).toBe(superseded ? successor.taskId : record.id)
		expect(options.postStateToWebview).toHaveBeenCalledTimes(superseded ? 0 : 1)
		await coordinator.dispose()
	})
	it("rejects a list result that resolves after account scope reset", async () => {
		const list = deferred<CloudSessionRecord[]>()
		const entered = deferred<void>()
		const { coordinator, cloudSessions } = makeCoordinator()
		cloudSessions.listSessions.mockImplementationOnce(() => {
			entered.resolve()
			return list.promise
		})

		const pending = coordinator.listHistoryRecords()
		await entered.promise
		await coordinator.reset()
		const current = { ...record, id: "ses-current" }
		cloudSessions.listSessions.mockResolvedValue([current])
		await coordinator.listHistoryRecords()
		list.resolve([record])

		expect(await pending).toMatchObject([{ sessionId: current.id }])
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
