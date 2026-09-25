import { afterEach, describe, expect, it, vi } from "vitest"
import { HostProvider } from "@/hosts/host-provider"
import { CloudSessionError, type CloudSessionRecord, type CreateCloudSessionInput } from "@/services/cloud/CloudSessionsService"
import { CloudSessionHost } from "./cloud-session-host"
import { MessageIdMinter } from "./message-id-minter"
import { SdkCloudSessionCoordinator, type SdkCloudSessionCoordinatorOptions } from "./sdk-cloud-session-coordinator"
import { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkSessionHost } from "./session-host"
import { createTaskProxy } from "./task-proxy"

vi.mock("@/hosts/host-provider", () => ({ HostProvider: { window: { showMessage: vi.fn(async () => ({})) } } }))

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

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
	metadata: { modelId: "fixture-model", taskId: "tsk-stale" },
	createdAt: new Date(0).toISOString(),
	updatedAt: new Date(0).toISOString(),
}

function makeCoordinator(overrides: Partial<SdkCloudSessionCoordinatorOptions> = {}) {
	let task: { taskId: string } | undefined
	const cloudSessions = {
		listSessions: vi.fn<() => Promise<CloudSessionRecord[]>>(async () => []),
		createSession: vi.fn(async (_input: CreateCloudSessionInput, _onProvisioning?: (sessionId: string) => void) => record),
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
		sessionConfigBuilder: {
			build: vi.fn(async () => ({
				providerId: "cline",
				modelId: "fixture-model",
				apiKey: "fixture-key",
				cwd: "/workspace",
				workspaceRoot: "/workspace",
				systemPrompt: "normal Cline guidance",
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			})),
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
	it("uses the Act-mode Cline model while the local UI is in Plan mode", async () => {
		const { coordinator } = makeCoordinator({
			stateManager: {
				getApiConfiguration: () => ({
					actModeApiProvider: "cline",
					actModeClineModelId: "act-cloud-model",
					planModeApiProvider: "cline",
					planModeClineModelId: "plan-local-model",
				}),
				getGlobalSettingsKey: () => "plan",
			} as never,
		})

		expect(await (coordinator as unknown as { resolveCloudModelId: () => Promise<string> }).resolveCloudModelId()).toBe(
			"act-cloud-model",
		)
	})

	it("refuses to connect when the control plane omits the canonical task id", async () => {
		const withoutTaskId = { ...record, metadata: { modelId: "fixture-model" } }
		const { coordinator, cloudSessions, options } = makeCoordinator()
		cloudSessions.listSessions.mockResolvedValue([withoutTaskId])
		const connect = vi.spyOn(CloudSessionHost, "connect")

		await coordinator.openCloudTask(withoutTaskId.id)

		expect(options.getTask()?.messageStateHandler.getClineMessages().at(-1)?.text).toBe(
			`Could not connect to this cloud session: Cloud session ${withoutTaskId.id} has no canonical task id.`,
		)
		expect(connect).not.toHaveBeenCalled()
	})

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

	it("does not provision when the task view was already superseded", async () => {
		const { coordinator, cloudSessions } = makeCoordinator({ claimTaskViewGeneration: () => () => true })

		const result = await coordinator.startCloudTask({
			prompt: "test",
			repoUrl: "https://github.com/cline/fixture",
		})

		expect(result).toBeUndefined()
		expect(cloudSessions.createSession).not.toHaveBeenCalled()
		expect(cloudSessions.deleteSession).not.toHaveBeenCalled()
	})

	it("deletes a sandbox when the user cancels during provisioning", async () => {
		const created = deferred<CloudSessionRecord>()
		const provisioned = deferred<void>()
		const startNewSession = vi.fn()
		const { coordinator, cloudSessions, options } = makeCoordinator({ sessions: { startNewSession } as never })
		cloudSessions.createSession.mockImplementation(async (_input, onProvisioning) => {
			onProvisioning?.(record.id)
			provisioned.resolve()
			return created.promise
		})

		const starting = coordinator.startCloudTask({
			prompt: "test",
			repoUrl: "https://github.com/cline/fixture",
		})
		await provisioned.promise
		expect(coordinator.cancelPendingStart()).toBe(true)
		expect(coordinator.cancelPendingStart()).toBe(false)
		created.resolve(record)

		expect(await starting).toBe(record.id)
		expect(cloudSessions.deleteSession).toHaveBeenCalledWith(record.id)
		expect(startNewSession).not.toHaveBeenCalled()
		expect(options.resolveContextMentions).not.toHaveBeenCalled()
	})

	it("projects an authoritative usage snapshot from its live cloud host", async () => {
		const getAccumulatedUsage = vi.fn(async () => ({
			inputTokens: 101,
			outputTokens: 202,
			cacheReadTokens: 303,
			cacheWriteTokens: 404,
			totalCost: 0.5,
		}))
		const { coordinator, cloudSessions } = makeCoordinator()
		cloudSessions.listSessions.mockResolvedValue([record])
		;(coordinator as unknown as { entries: Map<string, unknown> }).entries.set(record.id, {
			record,
			host: { getAccumulatedUsage },
			lastActivityAt: 0,
		})

		const [history] = await coordinator.listHistoryRecords()

		expect(getAccumulatedUsage).toHaveBeenCalledWith(record.id)
		expect(history.metadata).toMatchObject({
			usageAvailable: true,
			tokensIn: 101,
			tokensOut: 202,
			cacheReads: 303,
			cacheWrites: 404,
			totalCost: 0.5,
		})
	})

	it("leaves usage unavailable when REST has no authoritative usage", async () => {
		const { coordinator, cloudSessions } = makeCoordinator()
		cloudSessions.listSessions.mockResolvedValue([record])

		const [history] = await coordinator.listHistoryRecords()

		expect(history.metadata).not.toHaveProperty("usageAvailable")
		expect(history.metadata).not.toHaveProperty("tokensIn")
	})

	it("resolves only requested visible statuses with bounded concurrency", async () => {
		const records = Array.from({ length: 7 }, (_, index) => ({
			...record,
			id: `ses-${index}`,
			metadata: { ...record.metadata, taskId: `tsk-${index}` },
		}))
		const entered = deferred<void>()
		const release = deferred<void>()
		let active = 0
		let maxActive = 0
		const connect = vi.spyOn(CloudSessionHost, "connect").mockImplementation(async (options) => {
			active++
			maxActive = Math.max(maxActive, active)
			if (active === 4) entered.resolve()
			await release.promise
			active--
			return {
				status:
					options.outerSessionId === records[0].id
						? "completed"
						: options.outerSessionId === records[1].id
							? "running"
							: "idle",
				dispose: vi.fn(async () => undefined),
			} as unknown as CloudSessionHost
		})
		const { coordinator, cloudSessions } = makeCoordinator()
		cloudSessions.listSessions.mockResolvedValue(records)
		await coordinator.listHistoryRecords()

		const pending = coordinator.resolveStatuses([
			records[0].id,
			records[0].id,
			records[1].id,
			records[2].id,
			records[3].id,
			records[4].id,
			records[5].id,
			"local-task",
		])
		await entered.promise
		expect(connect).toHaveBeenCalledTimes(4)
		expect(maxActive).toBe(4)
		release.resolve()
		const statuses = await pending

		expect(connect).toHaveBeenCalledTimes(6)
		expect(connect).not.toHaveBeenCalledWith(expect.objectContaining({ outerSessionId: records[6].id }))
		expect(statuses).toContainEqual({ sessionId: records[0].id, status: "completed" })
		expect(statuses).toHaveLength(6)
		for (const [index, result] of connect.mock.results.entries()) {
			expect(result.type).toBe("return")
			if (index === 1) {
				expect((await result.value).dispose).not.toHaveBeenCalled()
			} else {
				expect((await result.value).dispose).toHaveBeenCalledWith("statusResolved")
			}
		}
	})

	it("drops resolved statuses when the account changes during connection", async () => {
		const connected = deferred<CloudSessionHost>()
		vi.spyOn(CloudSessionHost, "connect").mockReturnValue(connected.promise)
		const { coordinator, cloudSessions } = makeCoordinator()
		cloudSessions.listSessions.mockResolvedValue([record])
		await coordinator.listHistoryRecords()

		const resolving = coordinator.resolveStatuses([record.id])
		const resetting = coordinator.reset()
		connected.resolve({ status: "completed", dispose: vi.fn(async () => undefined) } as unknown as CloudSessionHost)

		expect(await resolving).toEqual([])
		await resetting
	})

	it("restarts History in the new account scope when old usage resolves late", async () => {
		const usage = deferred<undefined>()
		const entered = deferred<void>()
		const { coordinator, cloudSessions } = makeCoordinator()
		cloudSessions.listSessions.mockResolvedValue([record])
		;(coordinator as unknown as { entries: Map<string, unknown> }).entries.set(record.id, {
			record,
			host: {
				getAccumulatedUsage: () => {
					entered.resolve()
					return usage.promise
				},
				dispose: vi.fn(async () => undefined),
			},
			lastActivityAt: 0,
		})

		const pending = coordinator.listHistoryRecords()
		await entered.promise
		await coordinator.reset()
		const current = { ...record, id: "ses-current" }
		cloudSessions.listSessions.mockResolvedValue([current])
		usage.resolve(undefined)

		expect(await pending).toMatchObject([{ sessionId: current.id }])
	})

	it("does not block History on a non-responsive usage RPC", async () => {
		vi.useFakeTimers()
		const { coordinator, cloudSessions } = makeCoordinator()
		cloudSessions.listSessions.mockResolvedValue([record])
		;(coordinator as unknown as { entries: Map<string, unknown> }).entries.set(record.id, {
			record,
			host: { getAccumulatedUsage: () => new Promise(() => {}) },
			lastActivityAt: 0,
		})

		const pending = coordinator.listHistoryRecords()
		await vi.advanceTimersByTimeAsync(2_000)
		const [history] = await pending

		expect(history.metadata).not.toHaveProperty("usageAvailable")
	})
})
