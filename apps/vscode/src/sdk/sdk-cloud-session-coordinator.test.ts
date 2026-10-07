import * as sdkCore from "@cline/core"
import type { CloudSessionStatus } from "@shared/cloud/cloud-sessions"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ClineEnv } from "@/config"
import { resetClineRecommendedModelsCacheForTests } from "@/core/controller/models/refreshClineRecommendedModels"
import { HostProvider } from "@/hosts/host-provider"
import { CloudSessionError, type CloudSessionRecord, type CreateCloudSessionInput } from "@/services/cloud/CloudSessionsService"
import { CLINE_RECOMMENDED_MODELS_FALLBACK } from "@/shared/cline/recommended-models"
import { CloudSessionHost } from "./cloud-session-host"
import { MessageIdMinter } from "./message-id-minter"
import { SdkCloudSessionCoordinator, type SdkCloudSessionCoordinatorOptions } from "./sdk-cloud-session-coordinator"
import { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkSessionHost } from "./session-host"
import { createTaskProxy, type TaskProxy } from "./task-proxy"

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

/** In-memory global state shared by coordinators that stand in for one extension install. */
function makeStateManager(globalState: Record<string, unknown> = {}) {
	return {
		getApiConfiguration: () => ({ actModeApiProvider: "cline", actModeClineModelId: "fixture-model" }),
		getGlobalSettingsKey: () => "act",
		getGlobalStateKey: (key: string) => globalState[key],
		setGlobalState: (key: string, value: unknown) => {
			globalState[key] = value
		},
	}
}

function makeCoordinator(overrides: Partial<SdkCloudSessionCoordinatorOptions> = {}) {
	let task: { taskId: string } | undefined
	const cloudSessions = {
		listSessions: vi.fn<() => Promise<CloudSessionRecord[]>>(async () => []),
		createSession: vi.fn(
			async (_input: CreateCloudSessionInput, _onProvisioning?: (sessionId: string) => void, _signal?: AbortSignal) =>
				record,
		),
		deleteSession: vi.fn(async () => undefined),
		renameSession: vi.fn(async () => undefined),
		getStatus: vi.fn(async (): Promise<{ status?: string }> => ({ status: "ready" })),
		getHistory: vi.fn(async (): Promise<unknown[] | null> => []),
		dashboardUrl: vi.fn((id: string) => `https://example.test/${id}`),
		sessionSocketUrl: vi.fn((id: string) => `ws://127.0.0.1/${id}`),
	}
	const options = {
		cloudSessions,
		stateManager: makeStateManager(),
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
		onStartFailed: vi.fn(),
		claimTaskViewGeneration: () => () => false,
		requestToolApproval: vi.fn(),
		getAuthToken: vi.fn(async () => "token"),
		isSignedIn: () => true,
		isEnabled: () => true,
		resetMessageTranslator: vi.fn(),
		setTurnPhase: vi.fn(),
		clearTurnOutcome: vi.fn(),
		postStateToWebview: vi.fn(async () => undefined),
		invalidateHistoryCache: vi.fn(),
		resolveContextMentions: vi.fn(async (text: string) => text),
		...overrides,
	} as unknown as SdkCloudSessionCoordinatorOptions
	return { coordinator: new SdkCloudSessionCoordinator(options), cloudSessions, options }
}

describe("SdkCloudSessionCoordinator ownership", () => {
	it("starts the sandbox in Act with the Act-mode Cline model while the local UI is in Plan mode", async () => {
		const host = { status: "idle", readMessages: async () => [], dispose: async () => {} } as unknown as CloudSessionHost
		vi.spyOn(CloudSessionHost, "connect").mockResolvedValue(host)
		const startNewSession = vi.fn(async () => ({ sdkHost: host, startResult: { sessionId: record.id } }))
		const fireAndForgetSend = vi.fn()
		const { coordinator, cloudSessions, options } = makeCoordinator({
			stateManager: {
				...makeStateManager(),
				getApiConfiguration: () => ({
					actModeApiProvider: "cline",
					actModeClineModelId: "act-cloud-model",
					planModeApiProvider: "cline",
					planModeClineModelId: "plan-local-model",
				}),
				getGlobalSettingsKey: () => "plan",
			} as never,
			sessions: { startNewSession, fireAndForgetSend } as never,
		})

		expect(await coordinator.beginCloudTask({ prompt: "test", repoUrl: record.repoContext.repoUrl! })()).toBe(record.id)

		expect(cloudSessions.createSession).toHaveBeenCalledWith(
			expect.objectContaining({ modelId: "act-cloud-model" }),
			expect.any(Function),
			expect.any(AbortSignal),
		)
		expect(options.sessionConfigBuilder.build).toHaveBeenCalledWith(expect.objectContaining({ mode: "act" }))
		expect(startNewSession).toHaveBeenCalledWith(
			expect.objectContaining({ config: expect.objectContaining({ mode: "act" }) }),
			host,
			expect.any(Function),
		)
		await coordinator.dispose()
	})

	it("leaves a provisioning start alone when Cancel is for another task, and cancels it from its own view", async () => {
		const { coordinator, cloudSessions, options } = makeCoordinator()
		const named = deferred<void>()
		cloudSessions.createSession.mockImplementation(async (_input, onProvisioning, signal) => {
			onProvisioning?.(record.id)
			named.resolve()
			await new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason)))
			return record
		})

		const start = coordinator.beginCloudTask({ prompt: "test", repoUrl: record.repoContext.repoUrl! })()
		await named.promise
		const startView = options.getTask() as TaskProxy
		const otherTask = createTaskProxy("ses-other", vi.fn(), vi.fn())

		expect(coordinator.cancelPendingStartFor(otherTask)).toBe(false)
		expect(coordinator.getCurrentTaskInfo()?.status).toBe("provisioning")
		expect(coordinator.cancelPendingStartFor(startView)).toBe(true)

		expect(await start).toBe(record.id)
		expect(cloudSessions.deleteSession).toHaveBeenCalledWith(record.id)
		await coordinator.dispose()
	})

	it("starts the sandbox on the model the composer showed, even when a fresher recommendation lands first", async () => {
		resetClineRecommendedModelsCacheForTests()
		vi.spyOn(ClineEnv, "config").mockReturnValue({ apiBaseUrl: "https://api.cline-test.bot" } as ReturnType<
			typeof ClineEnv.config
		>)
		const fetched = deferred<Awaited<ReturnType<typeof sdkCore.fetchClineRecommendedModels>>>()
		vi.spyOn(sdkCore, "fetchClineRecommendedModels").mockReturnValue(fetched.promise)
		const host = { status: "idle", readMessages: async () => [], dispose: async () => {} } as unknown as CloudSessionHost
		vi.spyOn(CloudSessionHost, "connect").mockResolvedValue(host)
		const { coordinator, cloudSessions, options } = makeCoordinator({
			stateManager: {
				...makeStateManager(),
				getApiConfiguration: () => ({ actModeApiProvider: "anthropic" }),
			} as never,
			sessions: {
				startNewSession: vi.fn(async () => ({ sdkHost: host, startResult: { sessionId: record.id } })),
				fireAndForgetSend: vi.fn(),
			} as never,
		})

		const shown = coordinator.getCloudModelId()
		expect(shown).toBe(CLINE_RECOMMENDED_MODELS_FALLBACK.recommended[0].id)
		const start = coordinator.beginCloudTask({ prompt: "test", repoUrl: record.repoContext.repoUrl! })()
		fetched.resolve({
			recommended: [{ id: "fresh/model", name: "Fresh", description: "", tags: [] }],
			free: [],
			clinePass: [],
		})
		expect(await start).toBe(record.id)

		expect(cloudSessions.createSession).toHaveBeenCalledWith(
			expect.objectContaining({ modelId: shown }),
			expect.any(Function),
			expect.any(AbortSignal),
		)
		// The fresh list is for the next task: once the displayed task is gone the composer offers it.
		await fetched.promise
		options.setTask(undefined)
		expect(coordinator.getCloudModelId()).toBe("fresh/model")
		await coordinator.dispose()
		resetClineRecommendedModelsCacheForTests()
	})

	it("retries the recommendation fetch after a failed attempt left the built-in fallback in place", async () => {
		resetClineRecommendedModelsCacheForTests()
		vi.spyOn(ClineEnv, "config").mockReturnValue({ apiBaseUrl: "https://api.cline-test.bot" } as ReturnType<
			typeof ClineEnv.config
		>)
		const fetchRecommended = vi
			.spyOn(sdkCore, "fetchClineRecommendedModels")
			.mockResolvedValueOnce(structuredClone(sdkCore.FALLBACK_CLINE_RECOMMENDED_MODELS))
			.mockResolvedValueOnce({
				recommended: [{ id: "fresh/model", name: "Fresh", description: "", tags: [] }],
				free: [],
				clinePass: [],
			})
		const { coordinator, options } = makeCoordinator({
			stateManager: {
				...makeStateManager(),
				getApiConfiguration: () => ({ actModeApiProvider: "anthropic" }),
			} as never,
		})

		// The failed fetch leaves the fallback in place and posts no state: a
		// post would read the model again and start the next fetch, so a dead
		// endpoint would be polled without bound.
		expect(coordinator.getCloudModelId()).toBe(CLINE_RECOMMENDED_MODELS_FALLBACK.recommended[0].id)
		await vi.waitFor(() => expect(fetchRecommended).toHaveBeenCalledTimes(1))
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(options.postStateToWebview).not.toHaveBeenCalled()

		// The next read the user causes retries, and the fresh list is posted.
		expect(coordinator.getCloudModelId()).toBe(CLINE_RECOMMENDED_MODELS_FALLBACK.recommended[0].id)
		await vi.waitFor(() => expect(options.postStateToWebview).toHaveBeenCalledTimes(1))
		expect(fetchRecommended).toHaveBeenCalledTimes(2)
		expect(coordinator.getCloudModelId()).toBe("fresh/model")
		await coordinator.dispose()
		resetClineRecommendedModelsCacheForTests()
	})

	it("refuses to connect when the control plane omits the canonical task id", async () => {
		const withoutTaskId = { ...record, metadata: { modelId: "fixture-model" } }
		const { coordinator, cloudSessions, options } = makeCoordinator()
		cloudSessions.listSessions.mockResolvedValue([withoutTaskId])
		const connect = vi.spyOn(CloudSessionHost, "connect")

		await coordinator.openCloudTask(withoutTaskId.id)

		expect(options.getTask()?.messageStateHandler.getClineMessages().at(-1)?.text).toBe(
			`Could not connect to this cloud session (Cloud session ${withoutTaskId.id} has no canonical task id.). It may still be running. Click Retry to reconnect.`,
		)
		expect(connect).not.toHaveBeenCalled()
	})

	it("offers Retry for a cloud task that failed to connect, until opening it again connects", async () => {
		const { coordinator, cloudSessions, options } = makeCoordinator({
			sessions: { attachExistingSession: vi.fn(async () => undefined) } as never,
		})
		cloudSessions.listSessions.mockResolvedValue([record])
		const host = { status: "idle", readMessages: async () => [], dispose: async () => {} } as unknown as CloudSessionHost
		vi.spyOn(CloudSessionHost, "connect")
			.mockRejectedValueOnce(new Error("Unexpected server response: 502"))
			.mockResolvedValueOnce(host)

		await coordinator.openCloudTask(record.id)
		expect(options.setTurnPhase).toHaveBeenLastCalledWith("error")
		expect(coordinator.canReconnect(record.id)).toBe(true)

		await coordinator.openCloudTask(record.id)
		expect(coordinator.canReconnect(record.id)).toBe(false)
		await coordinator.dispose()
	})

	describe("expired sessions", () => {
		const expired = { ...record, id: "ses-expired", expiredAt: new Date(1_000).toISOString() }
		const userTurn = { role: "user", content: [{ type: "text", text: "archived prompt" }], timestamp: 500 }

		async function openExpired(getHistory: () => Promise<unknown[] | null>) {
			const { coordinator, cloudSessions, options } = makeCoordinator()
			cloudSessions.getHistory.mockImplementation(getHistory)
			cloudSessions.listSessions.mockResolvedValue([expired])
			const connect = vi.spyOn(CloudSessionHost, "connect")
			await coordinator.openCloudTask(expired.id)
			expect(connect).not.toHaveBeenCalled()
			const messages = options.getTask()!.messageStateHandler.getClineMessages()
			await coordinator.dispose()
			return messages
		}

		it("shows the archived conversation with a notice, not an error", async () => {
			const messages = await openExpired(async () => [userTurn])
			expect(messages.some((message) => message.text?.includes("archived prompt"))).toBe(true)
			const notice = messages.at(-1)!
			expect(notice.say).toBe("info")
			expect(notice.text).toContain("retired after 24 hours without activity")
			expect(notice.text).toContain("saved here to read")
			expect(notice.text).toContain("start a new cloud task on cline/fixture (main)")
		})

		it("does not present the last archived response as a completed task", async () => {
			const assistantTurn = {
				role: "assistant",
				content: [{ type: "text", text: "archived reply" }],
				timestamp: 600,
			}
			const messages = await openExpired(async () => [userTurn, assistantTurn])
			const reply = messages.find((message) => message.text === "archived reply")!
			expect(reply.say).toBe("text")
			expect(messages.some((message) => message.say === "completion_result")).toBe(false)
		})

		for (const [archive, getHistory] of [
			["no archive", async () => null],
			["an empty archive", async () => []],
		] as const) {
			it(`says when no conversation was archived given ${archive}`, async () => {
				const messages = await openExpired(getHistory)
				expect(messages).toHaveLength(1)
				expect(messages[0].say).toBe("info")
				expect(messages[0].text).toContain("No conversation was saved")
			})
		}

		it("says when the archive could not be loaded", async () => {
			const messages = await openExpired(async () => {
				throw new Error("network down")
			})
			expect(messages).toHaveLength(1)
			expect(messages[0].say).toBe("info")
			expect(messages[0].text).toContain("could not be loaded right now (network down)")
		})

		it("shows a sandbox retired after History was listed as expired, not as a connection error", async () => {
			const { coordinator, cloudSessions, options } = makeCoordinator()
			cloudSessions.listSessions.mockResolvedValue([record])
			cloudSessions.getStatus.mockRejectedValue(new CloudSessionError("session_expired", "session expired", undefined, 410))
			cloudSessions.getHistory.mockResolvedValue(null)
			vi.spyOn(CloudSessionHost, "connect").mockRejectedValue(new Error("Unexpected server response: 410"))
			await coordinator.openCloudTask(record.id)
			const messages = options.getTask()!.messageStateHandler.getClineMessages()
			expect(messages).toHaveLength(1)
			expect(messages[0].say).toBe("info")
			expect(messages[0].text).toContain("retired after 24 hours")
			await coordinator.dispose()
		})

		it("recognises retirement when /status answers expired instead of 410", async () => {
			// The control plane keeps answering /status with 200 for a retired
			// sandbox while its WebSocket rejects with 410.
			const { coordinator, cloudSessions, options } = makeCoordinator()
			cloudSessions.listSessions.mockResolvedValue([record])
			cloudSessions.getStatus.mockResolvedValue({ status: "expired" })
			cloudSessions.getHistory.mockResolvedValue(null)
			vi.spyOn(CloudSessionHost, "connect").mockRejectedValue(new Error("Unexpected server response: 410"))
			await coordinator.openCloudTask(record.id)
			const messages = options.getTask()!.messageStateHandler.getClineMessages()
			expect(messages).toHaveLength(1)
			expect(messages[0].say).toBe("info")
			expect(messages[0].text).toContain("retired after 24 hours")
			await coordinator.dispose()
		})

		it("keeps a deleted session's notice when a newer selection did not supersede it", async () => {
			const { coordinator, cloudSessions, options } = makeCoordinator()
			cloudSessions.listSessions.mockResolvedValueOnce([record]).mockResolvedValue([])
			cloudSessions.getStatus.mockRejectedValue(
				new CloudSessionError("session_not_found", "session not found", undefined, 404),
			)
			vi.spyOn(CloudSessionHost, "connect").mockRejectedValue(new Error("Unexpected server response: 404"))
			await coordinator.openCloudTask(record.id)
			expect(options.getTask()?.taskId).toBe(record.id)
			expect(options.getTask()!.messageStateHandler.getClineMessages()[0].text).toContain("was deleted")
			expect(options.invalidateHistoryCache).toHaveBeenCalled()
			expect(await coordinator.findHistoryRecord(record.id)).toBeUndefined()
			await coordinator.dispose()
		})

		it("disposes a retained host when its session turns out to be deleted", async () => {
			const dispose = vi.fn(async () => undefined)
			const { coordinator, cloudSessions } = makeCoordinator()
			cloudSessions.listSessions.mockResolvedValue([record])
			await coordinator.listHistoryRecords()
			const retained = {
				status: "unknown",
				refreshStatus: vi.fn(async () => {
					throw new Error("Unexpected server response: 404")
				}),
				dispose,
			}
			;(coordinator as unknown as { entries: Map<string, { host?: unknown }> }).entries.get(record.id)!.host = retained
			cloudSessions.getStatus.mockRejectedValue(
				new CloudSessionError("session_not_found", "session not found", undefined, 404),
			)
			await coordinator.openCloudTask(record.id)
			expect(dispose).toHaveBeenCalledWith("deleted")
			await coordinator.dispose()
		})
	})

	it("closes the retained host of a session that has left the account's list", async () => {
		// Deleted from the dashboard while this instance still held a connection.
		const dispose = vi.fn(async () => undefined)
		const { coordinator, cloudSessions } = makeCoordinator()
		cloudSessions.listSessions.mockResolvedValue([record])
		await coordinator.listHistoryRecords()
		const entries = (coordinator as unknown as { entries: Map<string, { host?: unknown }> }).entries
		entries.get(record.id)!.host = { status: "running", dispose }
		cloudSessions.listSessions.mockResolvedValue([])

		await (coordinator as unknown as { refreshList: (force: boolean) => Promise<void> }).refreshList(true)

		expect(entries.has(record.id)).toBe(false)
		expect(dispose).toHaveBeenCalledWith("deleted")
		await coordinator.dispose()
	})

	it("keeps the displayed task's host when its record leaves the list, so opening it can explain why", async () => {
		const dispose = vi.fn(async () => undefined)
		const { coordinator, cloudSessions, options } = makeCoordinator()
		cloudSessions.listSessions.mockResolvedValue([record])
		await coordinator.listHistoryRecords()
		const entries = (coordinator as unknown as { entries: Map<string, { host?: unknown }> }).entries
		entries.get(record.id)!.host = { status: "running", dispose }
		options.setTask(createTaskProxy(record.id, vi.fn(), vi.fn()))
		cloudSessions.listSessions.mockResolvedValue([])

		await (coordinator as unknown as { refreshList: (force: boolean) => Promise<void> }).refreshList(true)

		expect(entries.has(record.id)).toBe(true)
		expect(dispose).not.toHaveBeenCalled()
		await coordinator.dispose()
	})

	it("closes idle hosts but keeps the displayed task when the account's list can no longer be read", async () => {
		const displayed = { ...record, id: "ses-displayed", metadata: { ...record.metadata, taskId: "tsk-displayed" } }
		const disposeIdle = vi.fn(async () => undefined)
		const disposeDisplayed = vi.fn(async () => undefined)
		const { coordinator, cloudSessions, options } = makeCoordinator()
		cloudSessions.listSessions.mockResolvedValue([record, displayed])
		await coordinator.listHistoryRecords()
		const entries = (coordinator as unknown as { entries: Map<string, { host?: unknown }> }).entries
		entries.get(record.id)!.host = { status: "running", dispose: disposeIdle }
		entries.get(displayed.id)!.host = { status: "running", dispose: disposeDisplayed }
		options.setTask(createTaskProxy(displayed.id, vi.fn(), vi.fn()))
		cloudSessions.listSessions.mockRejectedValue(new CloudSessionError("authentication_required", "sign in", undefined, 401))

		await (coordinator as unknown as { refreshList: (force: boolean) => Promise<void> }).refreshList(true)

		expect([...entries.keys()]).toEqual([displayed.id])
		expect(disposeIdle).toHaveBeenCalledWith("authenticationRequired")
		expect(disposeDisplayed).not.toHaveBeenCalled()
		await coordinator.dispose()
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
		statusChanged("failed")
		// The old host's events never reach the new-scope entry; it still shows the
		// status the previous scope remembered for the same record.
		expect((await coordinator.listHistoryRecords())[0].metadata?.cloudStatus).toBe("completed")
		expect(options.postStateToWebview).not.toHaveBeenCalled()
		expect(HostProvider.window.showMessage).not.toHaveBeenCalled()
		await coordinator.dispose()
	})

	describe("remembered statuses", () => {
		const finished = { ...record, updatedAt: new Date(1_000).toISOString() }

		function connectReporting(status: CloudSessionStatus) {
			vi.spyOn(CloudSessionHost, "connect").mockImplementation(async (options) => {
				options.onStatusChange?.(status)
				return {
					status,
					readMessages: async () => [],
					dispose: vi.fn(async () => undefined),
				} as unknown as CloudSessionHost
			})
		}

		async function rememberCompleted(globalState: Record<string, unknown>) {
			connectReporting("completed")
			const { coordinator, cloudSessions } = makeCoordinator({ stateManager: makeStateManager(globalState) as never })
			cloudSessions.listSessions.mockResolvedValue([finished])
			await coordinator.listHistoryRecords()
			await coordinator.resolveStatuses([finished.id])
			await coordinator.dispose()
		}

		it("shows a settled status after restart without reconnecting while the record is unchanged", async () => {
			const globalState: Record<string, unknown> = {}
			await rememberCompleted(globalState)

			const connect = vi.spyOn(CloudSessionHost, "connect").mockClear()
			const { coordinator, cloudSessions } = makeCoordinator({ stateManager: makeStateManager(globalState) as never })
			cloudSessions.listSessions.mockResolvedValue([finished])

			expect((await coordinator.listHistoryRecords())[0].metadata?.cloudStatus).toBe("completed")
			expect(await coordinator.resolveStatuses([finished.id])).toEqual([{ sessionId: finished.id, status: "completed" }])
			expect(connect).not.toHaveBeenCalled()
		})

		it("keeps a remembered status through the control plane's own connect touch", async () => {
			const globalState: Record<string, unknown> = {}
			await rememberCompleted(globalState)

			const { coordinator, cloudSessions } = makeCoordinator({ stateManager: makeStateManager(globalState) as never })
			cloudSessions.listSessions.mockResolvedValue([{ ...finished, updatedAt: new Date(Date.now() + 2_000).toISOString() }])

			expect((await coordinator.listHistoryRecords())[0].metadata?.cloudStatus).toBe("completed")
		})

		it("forgets a remembered status once the record is updated well after the observation", async () => {
			const globalState: Record<string, unknown> = {}
			await rememberCompleted(globalState)

			const { coordinator, cloudSessions } = makeCoordinator({ stateManager: makeStateManager(globalState) as never })
			cloudSessions.listSessions.mockResolvedValue([
				{ ...finished, updatedAt: new Date(Date.now() + 10 * 60_000).toISOString() },
			])

			expect((await coordinator.listHistoryRecords())[0].metadata?.cloudStatus).toBe("unknown")
		})

		it("does not remember an active status", async () => {
			const globalState: Record<string, unknown> = {}
			connectReporting("running")
			const { coordinator, cloudSessions } = makeCoordinator({ stateManager: makeStateManager(globalState) as never })
			cloudSessions.listSessions.mockResolvedValue([finished])
			await coordinator.listHistoryRecords()
			await coordinator.resolveStatuses([finished.id])

			expect(globalState.cloudSessionStatuses).toBeUndefined()
		})

		it.each([false, true])("invalidates a later record without restarting (retained host=%s)", async (retained) => {
			vi.useFakeTimers()
			vi.setSystemTime(100_000)
			const globalState: Record<string, unknown> = {}
			const host = {
				status: "completed",
				readMessages: async () => [],
				dispose: vi.fn(async () => {}),
				refreshStatus: vi.fn(async () => "running"),
			}
			const connect = vi.spyOn(CloudSessionHost, "connect").mockResolvedValue(host as unknown as CloudSessionHost)
			const { coordinator, cloudSessions, options } = makeCoordinator({
				stateManager: makeStateManager(globalState) as never,
			})
			cloudSessions.listSessions.mockResolvedValue([finished])
			await coordinator.listHistoryRecords()
			if (retained) options.setTask({ taskId: finished.id } as never)
			await coordinator.resolveStatuses([finished.id])
			expect((await coordinator.listHistoryRecords())[0].metadata?.cloudStatus).toBe("completed")
			vi.setSystemTime(180_000)
			cloudSessions.listSessions.mockResolvedValue([{ ...finished, updatedAt: new Date(170_000).toISOString() }])
			expect((await coordinator.listHistoryRecords())[0].metadata?.cloudStatus).toBe("unknown")
			expect(globalState.cloudSessionStatuses).toEqual({ [finished.id]: { status: "completed", observedAt: 100_000 } })
			if (!retained) connect.mockResolvedValue({ ...host, status: "running" } as unknown as CloudSessionHost)
			expect(await coordinator.resolveStatuses([finished.id])).toEqual([{ sessionId: finished.id, status: "running" }])
			if (retained) {
				expect(host.refreshStatus).toHaveBeenCalledOnce()
				expect(connect).toHaveBeenCalledOnce()
				expect(host.dispose).not.toHaveBeenCalled()
			} else expect(connect).toHaveBeenCalledTimes(2)
			await coordinator.dispose()
		})

		it("drops remembered statuses for sessions the account no longer lists", async () => {
			const globalState: Record<string, unknown> = {
				cloudSessionStatuses: { "ses-gone": { status: "completed", observedAt: 5_000 } },
			}
			const { coordinator, cloudSessions } = makeCoordinator({ stateManager: makeStateManager(globalState) as never })
			cloudSessions.listSessions.mockResolvedValue([finished])
			await coordinator.listHistoryRecords()

			expect(globalState.cloudSessionStatuses).toEqual({})
		})
	})

	describe("History timestamps", () => {
		it("keeps the control plane timestamp when a connection only learns the current status", async () => {
			let statusChanged!: NonNullable<Parameters<typeof CloudSessionHost.connect>[0]["onStatusChange"]>
			vi.spyOn(CloudSessionHost, "connect").mockImplementation(async (options) => {
				statusChanged = options.onStatusChange!
				statusChanged("completed")
				return {
					status: "completed",
					readMessages: async () => [],
					dispose: vi.fn(async () => undefined),
				} as unknown as CloudSessionHost
			})
			const old = { ...record, updatedAt: new Date(1_000).toISOString() }
			const { coordinator, cloudSessions } = makeCoordinator()
			cloudSessions.listSessions.mockResolvedValue([old])
			await coordinator.listHistoryRecords()
			await coordinator.resolveStatuses([old.id])

			expect((await coordinator.listHistoryRecords())[0].updatedAt).toBe(old.updatedAt)

			statusChanged("running")
			expect(Date.parse((await coordinator.listHistoryRecords())[0].updatedAt!)).toBeGreaterThan(1_000)
		})
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

	it("answers History listed by the account mutation without waiting on the transition", async () => {
		const { coordinator, cloudSessions, options } = makeCoordinator()
		cloudSessions.listSessions.mockResolvedValue([record])
		await coordinator.listHistoryRecords()
		let listedDuringSwitch: unknown
		const changeScope = vi.fn(async () => {
			// Refreshing auth posts state, which lists History (and so cloud rows).
			listedDuringSwitch = await coordinator.listHistoryRecords()
		})
		vi.mocked(options.postStateToWebview).mockClear()

		await coordinator.reset(changeScope)

		expect(changeScope).toHaveBeenCalledOnce()
		expect(listedDuringSwitch).toEqual([])
		expect(options.postStateToWebview).toHaveBeenCalled()
		expect(await coordinator.listHistoryRecords()).toMatchObject([{ sessionId: record.id }])
		expect(cloudSessions.listSessions).toHaveBeenCalledTimes(2)
	})

	it("omits old rows immediately while task teardown posts History", async () => {
		const clearing = deferred<void>()
		const { coordinator, cloudSessions, options } = makeCoordinator()
		cloudSessions.listSessions.mockResolvedValue([record])
		await coordinator.listHistoryRecords()
		options.setTask({ taskId: record.id } as never)
		vi.mocked(options.clearTask).mockReturnValue(clearing.promise)
		const switching = coordinator.reset()
		expect(await coordinator.listHistoryRecords()).toEqual([])
		expect(await coordinator.findHistoryRecord(record.id)).toBeUndefined()
		clearing.resolve()
		await switching
	})

	it("refreshes History after an account mutation fails", async () => {
		const { coordinator, options } = makeCoordinator()
		await expect(
			coordinator.reset(async () => {
				throw new Error("refresh failed")
			}),
		).rejects.toThrow("refresh failed")
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
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

		const result = await coordinator.beginCloudTask({
			prompt: "test",
			repoUrl: "https://github.com/cline/fixture",
		})()

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

		const starting = coordinator.beginCloudTask({
			prompt: "test",
			repoUrl: "https://github.com/cline/fixture",
		})()
		await provisioned.promise
		expect(coordinator.cancelPendingStart()).toBe(true)
		expect(coordinator.cancelPendingStart()).toBe(false)
		created.resolve(record)

		expect(await starting).toBe(record.id)
		expect(cloudSessions.deleteSession).toHaveBeenCalledWith(record.id)
		expect(startNewSession).not.toHaveBeenCalled()
		expect(options.resolveContextMentions).not.toHaveBeenCalled()
	})

	it("stops the readiness poll as soon as the user cancels", async () => {
		const provisioned = deferred<void>()
		const { coordinator, cloudSessions } = makeCoordinator({ sessions: { startNewSession: vi.fn() } as never })
		cloudSessions.createSession.mockImplementation(async (_input, onProvisioning, signal) => {
			onProvisioning?.(record.id)
			provisioned.resolve()
			// The real service polls /status until the sandbox is ready or the signal aborts.
			await new Promise<void>((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason)))
			throw new Error("unreachable")
		})

		const starting = coordinator.beginCloudTask({ prompt: "test", repoUrl: "https://github.com/cline/fixture" })()
		await provisioned.promise
		coordinator.cancelPendingStart()

		expect(await starting).toBe(record.id)
		expect(cloudSessions.deleteSession).toHaveBeenCalledWith(record.id)
	})

	it("reports the displayed task as provisioning until a failed start has settled, then offers the start again", async () => {
		const provisioned = deferred<void>()
		const created = deferred<CloudSessionRecord>()
		const { coordinator, cloudSessions, options } = makeCoordinator({ sessions: { startNewSession: vi.fn() } as never })
		cloudSessions.createSession.mockImplementation(async (_input, onProvisioning) => {
			onProvisioning?.(record.id)
			provisioned.resolve()
			return created.promise
		})

		// The webview learns the status only through state posts, so record what each post would carry.
		const postedStatuses: Array<CloudSessionStatus | undefined> = []
		vi.mocked(options.postStateToWebview).mockImplementation(async () => {
			postedStatuses.push(coordinator.getCurrentTaskInfo()?.status)
		})

		const input = { prompt: "test", images: ["img"], repoUrl: "https://github.com/cline/fixture", branch: "main" }
		const starting = coordinator.beginCloudTask(input)()
		await provisioned.promise
		expect(coordinator.getCurrentTaskInfo()?.status).toBe("provisioning")

		created.reject(new Error("control plane unavailable"))
		expect(await starting).toBeUndefined()

		expect(postedStatuses.at(-1)).toBe("unknown")
		// The failure is shown on the task that is still displayed, and Retry re-runs the same input.
		expect(options.onStartFailed).toHaveBeenCalledWith(options.getTask(), input)
		expect(vi.mocked(options.onStartFailed).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(options.setTurnPhase).mock.invocationCallOrder.at(-1)!,
		)
	})

	it("does not offer to retry a start the user cancelled", async () => {
		const provisioned = deferred<void>()
		const { coordinator, cloudSessions, options } = makeCoordinator({ sessions: { startNewSession: vi.fn() } as never })
		cloudSessions.createSession.mockImplementation(async (_input, onProvisioning, signal) => {
			onProvisioning?.(record.id)
			provisioned.resolve()
			await new Promise<void>((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason)))
			throw new Error("unreachable")
		})

		const starting = coordinator.beginCloudTask({ prompt: "test", repoUrl: "https://github.com/cline/fixture" })()
		await provisioned.promise
		coordinator.cancelPendingStart()
		await starting

		expect(options.onStartFailed).not.toHaveBeenCalled()
	})

	it("defeats a start that is claimed but not yet running when the user cancels first", async () => {
		const { coordinator, cloudSessions } = makeCoordinator()

		const run = coordinator.beginCloudTask({ prompt: "test", repoUrl: "https://github.com/cline/fixture" })
		expect(coordinator.cancelPendingStart()).toBe(true)

		expect(await run()).toBeUndefined()
		expect(cloudSessions.createSession).not.toHaveBeenCalled()
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

	it("leaves the host open when status resolution overlaps opening the same task", async () => {
		const attached = deferred<void>()
		const attaching = deferred<void>()
		const host = {
			status: "completed",
			readMessages: async () => [],
			dispose: vi.fn(async () => undefined),
		} as unknown as CloudSessionHost
		vi.spyOn(CloudSessionHost, "connect").mockResolvedValue(host)
		const { coordinator, cloudSessions } = makeCoordinator({
			sessions: {
				attachExistingSession: async () => {
					attaching.resolve()
					await attached.promise
				},
			} as never,
		})
		cloudSessions.listSessions.mockResolvedValue([record])
		await coordinator.listHistoryRecords()

		const opening = coordinator.openCloudTask(record.id)
		await attaching.promise
		const statuses = await coordinator.resolveStatuses([record.id])
		expect(statuses).toEqual([{ sessionId: record.id, status: "completed" }])
		expect(host.dispose).not.toHaveBeenCalled()

		attached.resolve()
		await opening
		expect(host.dispose).not.toHaveBeenCalled()
		await coordinator.dispose()
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
