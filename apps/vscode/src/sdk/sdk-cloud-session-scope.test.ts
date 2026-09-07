import { afterEach, describe, expect, it, vi } from "vitest"
import { HostProvider } from "@/hosts/host-provider"
import { CloudSessionsService } from "@/services/cloud/CloudSessionsService"
import { CloudSessionHost } from "./cloud-session-host"
import { MessageIdMinter } from "./message-id-minter"
import { SdkCloudSessionCoordinator, type SdkCloudSessionCoordinatorOptions } from "./sdk-cloud-session-coordinator"
import { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { TaskProxy } from "./task-proxy"

vi.mock("@/hosts/host-provider", () => ({ HostProvider: { window: { showMessage: vi.fn(async () => ({})) } } }))
vi.mock("@/core/storage/StateManager", () => ({ StateManager: { get: () => ({ getGlobalSettingsKey: () => undefined }) } }))

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((done, fail) => {
		resolve = done
		reject = fail
	})
	return { promise, resolve, reject }
}

type WaitPoint = "create" | "readiness" | "connect" | "lifecycle" | "prompt" | "delete"
function fixture(waitPoint: WaitPoint, organizationId?: string) {
	const barrier = deferred<void>()
	const entered = deferred<void>()
	let scope = { token: "fixture-origin", endpoint: "http://127.0.0.1:1111", organizationId }
	const origin = scope
	const successor = { token: "fixture-successor", endpoint: "http://127.0.0.1:2222", organizationId: "org-successor" }
	let deletionStatus = 204
	let readinessStatus = "active"
	const requests: Array<{ method: string; url: string; token: string | null; body?: string }> = []
	const record = {
		id: "ses-owned",
		status: "active",
		repoContext: {},
		metadata: {},
		createdAt: new Date(0).toISOString(),
		updatedAt: new Date(0).toISOString(),
	}
	const wait = async (point: WaitPoint) => {
		if (waitPoint === point) {
			entered.resolve()
			await barrier.promise
		}
	}
	const service = new CloudSessionsService({
		get apiBaseUrl() {
			return scope.endpoint
		},
		appBaseUrl: "http://127.0.0.1:1111",
		getAuthToken: async () => scope.token,
		getActiveOrganizationId: () => scope.organizationId,
		fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input)
			const method = init?.method ?? "GET"
			requests.push({
				method,
				url,
				token: new Headers(init?.headers).get("Authorization"),
				body: typeof init?.body === "string" ? init.body : undefined,
			})
			if (method === "POST") {
				await wait("create")
				return Response.json({
					data: {
						sessionId: record.id,
						status: waitPoint === "readiness" ? "provisioning" : "active",
						sandboxUrl: origin.endpoint,
					},
				})
			}
			if (method === "DELETE") {
				await wait("delete")
				return deletionStatus === 204
					? new Response(null, { status: 204 })
					: Response.json({ error: "untrusted private server detail" }, { status: deletionStatus })
			}
			if (url.endsWith("/status")) {
				await wait("readiness")
				return Response.json({ data: { status: readinessStatus } })
			}
			if (method === "PATCH") return Response.json({ data: record })
			return Response.json({ data: [{ ...record, id: scope === origin ? record.id : "ses-successor" }] })
		}) as typeof fetch,
	})
	const host = {
		status: "idle",
		start: async () => {
			await wait("lifecycle")
			return { sessionId: record.id }
		},
		stop: async () => {},
		dispose: vi.fn(async () => {}),
		subscribe: () => () => {},
		send: vi.fn(async () => {}),
	} as unknown as CloudSessionHost
	vi.spyOn(CloudSessionHost, "connect").mockImplementation(async () => {
		await wait("connect")
		return host
	})
	const lifecycle = new SdkSessionLifecycle({
		mcpHub: {} as never,
		requestToolApproval: vi.fn(),
		askQuestion: vi.fn(),
		onSessionEvent: vi.fn(),
		onSendComplete: vi.fn(),
		onSendError: vi.fn(),
	})
	let task: TaskProxy | undefined
	let viewGeneration = 0
	const options = {
		cloudSessions: service,
		stateManager: {
			getApiConfiguration: () => ({ actModeApiProvider: "cline", actModeClineModelId: "fixture-model" }),
			getGlobalSettingsKey: () => "act",
		},
		sessions: lifecycle,
		messages: { appendAndEmit: vi.fn(), finalizeMessagesForSave: (messages: unknown) => messages },
		getMinter: () => new MessageIdMinter(),
		getTask: () => task,
		setTask: (next: TaskProxy | undefined) => {
			task = next
		},
		onAskResponse: vi.fn(),
		onCancelTask: vi.fn(),
		clearTask: async () => {
			task = undefined
			viewGeneration++
		},
		claimTaskViewGeneration: () => {
			const claim = ++viewGeneration
			return () => claim !== viewGeneration
		},
		requestToolApproval: vi.fn(),
		getAuthToken: async () => scope.token,
		isSignedIn: () => true,
		isEnabled: () => true,
		resetMessageTranslator: vi.fn(),
		setTurnPhase: vi.fn(),
		postStateToWebview: vi.fn(async () => {}),
		invalidateHistoryCache: vi.fn(),
		resolveContextMentions: async (prompt: string) => {
			await wait("prompt")
			return prompt
		},
	} as unknown as SdkCloudSessionCoordinatorOptions
	const coordinator = new SdkCloudSessionCoordinator(options)
	const changeScope = vi.fn(async () => {
		scope = successor
	})
	return {
		coordinator,
		service,
		host,
		lifecycle,
		options,
		requests,
		origin,
		successor,
		record,
		entered,
		barrier,
		changeScope,
		get scope() {
			return scope
		},
		setDeletionStatus: (status: number) => {
			deletionStatus = status
		},
		setReadinessStatus: (status: string) => {
			readinessStatus = status
		},
	}
}

const startInput = { prompt: "fixture task", repoUrl: "https://github.com/cline/fixture" }
afterEach(() => {
	vi.restoreAllMocks()
	vi.clearAllMocks()
	vi.useRealTimers()
})

describe("originating-account cloud cleanup", () => {
	it.each([
		"create",
		"readiness",
		"connect",
		"lifecycle",
		"prompt",
	] as const)("drains %s and its DELETE through the real service before switching account", async (waitPoint) => {
		const f = fixture(waitPoint, waitPoint === "create" ? undefined : "org-origin")
		const starting = f.coordinator.startCloudTask(startInput)
		await f.entered.promise
		const switching = f.coordinator.reset(f.changeScope)
		expect(f.changeScope).not.toHaveBeenCalled()
		f.barrier.resolve()
		await Promise.all([starting, switching])
		const deletion = f.requests.filter((request) => request.method === "DELETE")
		expect(deletion).toEqual([
			{
				method: "DELETE",
				url: `${f.origin.endpoint}/api/v1/session/${f.record.id}`,
				token: `Bearer ${f.origin.token}`,
				body: undefined,
			},
		])
		expect(
			f.requests.every(
				(request) => request.token === `Bearer ${f.origin.token}` && request.url.startsWith(f.origin.endpoint),
			),
		).toBe(true)
		expect(JSON.parse(f.requests[0].body ?? "{}").organizationId).toBe(f.origin.organizationId)
		expect(f.changeScope).toHaveBeenCalledOnce()
		expect(f.host.send).not.toHaveBeenCalled()
		expect(await f.coordinator.listHistoryRecords()).toMatchObject([{ sessionId: "ses-successor" }])
		await f.coordinator.dispose()
	})

	it("keeps the original account on timeout and can explicitly retry after cleanup settles", async () => {
		vi.useFakeTimers()
		const f = fixture("create")
		const starting = f.coordinator.startCloudTask(startInput)
		await f.entered.promise
		const switching = f.coordinator.reset(f.changeScope)
		const rejected = expect(switching).rejects.toThrow("Your account has not changed")
		await vi.advanceTimersByTimeAsync(15_000)
		await rejected
		expect(f.scope).toBe(f.origin)
		expect(f.changeScope).not.toHaveBeenCalled()
		f.barrier.resolve()
		await starting
		await f.coordinator.reset(f.changeScope)
		expect(f.requests.find((request) => request.method === "DELETE")?.token).toBe(`Bearer ${f.origin.token}`)
		expect(f.changeScope).toHaveBeenCalledOnce()
		await f.coordinator.dispose()
	})

	it("reports rejected cleanup once without exposing response text or retrying as the successor", async () => {
		const f = fixture("create")
		f.setDeletionStatus(401)
		const starting = f.coordinator.startCloudTask(startInput)
		await f.entered.promise
		const switching = f.coordinator.reset(f.changeScope)
		f.barrier.resolve()
		await Promise.all([starting, switching])
		expect(f.requests.filter((request) => request.method === "DELETE")).toHaveLength(1)
		expect(HostProvider.window.showMessage).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ message: expect.stringContaining("account that started it") }),
		)
		expect(JSON.stringify(vi.mocked(HostProvider.window.showMessage).mock.calls)).not.toContain("private server detail")
		expect(await f.coordinator.listHistoryRecords()).toMatchObject([{ sessionId: "ses-successor" }])
		await f.coordinator.dispose()
	})

	it("has one cleanup owner when readiness fails after provisioning returns an id", async () => {
		const f = fixture("readiness")
		f.setReadinessStatus("failed")
		const starting = f.coordinator.startCloudTask(startInput)
		await f.entered.promise
		const switching = f.coordinator.reset(f.changeScope)
		f.barrier.resolve()
		await Promise.all([starting, switching])
		expect(f.requests.filter((request) => request.method === "DELETE")).toHaveLength(1)
		expect(HostProvider.window.showMessage).not.toHaveBeenCalled()
		await f.coordinator.dispose()
	})

	it("keeps an ordinary successful start running rather than cleaning its sandbox", async () => {
		const f = fixture("prompt")
		const starting = f.coordinator.startCloudTask(startInput)
		await f.entered.promise
		f.barrier.resolve()
		expect(await starting).toBe(f.record.id)
		expect(f.host.send).toHaveBeenCalledOnce()
		expect(f.requests.some((request) => request.method === "DELETE")).toBe(false)
		await f.coordinator.reset(f.changeScope)
		expect(f.requests.some((request) => request.method === "DELETE")).toBe(false)
		await f.coordinator.dispose()
	})

	it("includes explicit History deletion in the same account boundary", async () => {
		const f = fixture("delete")
		const deleting = f.coordinator.deleteSession(f.record.id)
		await f.entered.promise
		const switching = f.coordinator.reset(f.changeScope)
		expect(f.changeScope).not.toHaveBeenCalled()
		f.barrier.resolve()
		await Promise.all([deleting, switching])
		expect(f.requests[0].token).toBe(`Bearer ${f.origin.token}`)
		expect(f.changeScope).toHaveBeenCalledOnce()
		await f.coordinator.dispose()
	})

	it.each(["lifecycle", "prompt"] as const)("cleans up a rejected %s wait without touching successor state", async (point) => {
		const f = fixture(point)
		const starting = f.coordinator.startCloudTask(startInput)
		await f.entered.promise
		const switching = f.coordinator.reset(f.changeScope)
		f.barrier.reject(new Error("fixture failure"))
		await Promise.all([starting, switching])
		expect(f.requests.filter((request) => request.method === "DELETE")).toHaveLength(1)
		expect(f.requests.every((request) => request.token === `Bearer ${f.origin.token}`)).toBe(true)
		expect(await f.coordinator.listHistoryRecords()).toMatchObject([{ sessionId: "ses-successor" }])
		await f.coordinator.dispose()
	})

	it("keeps old connectors enrolled after a timed-out transition and concurrent retry", async () => {
		vi.useFakeTimers()
		const f = fixture("connect")
		const starting = f.coordinator.startCloudTask(startInput)
		await f.entered.promise
		const first = f.coordinator.reset(f.changeScope)
		const rejected = expect(first).rejects.toThrow("Your account has not changed")
		await vi.advanceTimersByTimeAsync(15_000)
		await rejected
		const second = f.coordinator.reset(f.changeScope)
		f.barrier.resolve()
		await Promise.all([starting, second])
		expect(f.changeScope).toHaveBeenCalledOnce()
		expect(f.requests.find((request) => request.method === "DELETE")?.token).toBe(`Bearer ${f.origin.token}`)
		await f.coordinator.dispose()
	})

	it("cleans up an in-flight create during controller disposal", async () => {
		const f = fixture("create")
		const starting = f.coordinator.startCloudTask(startInput)
		await f.entered.promise
		const disposing = f.coordinator.dispose()
		f.barrier.resolve()
		await Promise.all([starting, disposing])
		expect(f.requests.filter((request) => request.method === "DELETE")).toHaveLength(1)
		expect(await f.coordinator.listHistoryRecords()).toEqual([])
	})

	it("delays successor starts until originating cleanup and account mutation finish", async () => {
		const f = fixture("create")
		const first = f.coordinator.startCloudTask(startInput)
		await f.entered.promise
		const switching = f.coordinator.reset(f.changeScope)
		const second = f.coordinator.startCloudTask(startInput)
		f.barrier.resolve()
		await Promise.all([first, switching, second])
		const posts = f.requests.filter((request) => request.method === "POST")
		expect(posts.map((request) => request.token)).toEqual([`Bearer ${f.origin.token}`, `Bearer ${f.successor.token}`])
		const deletedAt = f.requests.findIndex((request) => request.method === "DELETE")
		const newPostAt = f.requests.findIndex(
			(request) => request.method === "POST" && request.token === `Bearer ${f.successor.token}`,
		)
		expect(deletedAt).toBeLessThan(newPostAt)
		expect(f.host.send).toHaveBeenCalledOnce()
		await f.coordinator.dispose()
	})

	it("does not suppress a rejected explicit History deletion", async () => {
		const f = fixture("delete")
		f.setDeletionStatus(403)
		const deleting = f.coordinator.deleteSession(f.record.id)
		await f.entered.promise
		const switching = f.coordinator.reset(f.changeScope)
		const rejected = expect(deleting).rejects.toMatchObject({ status: 403 })
		f.barrier.resolve()
		await Promise.all([rejected, switching])
		expect(f.requests.filter((request) => request.method === "DELETE")).toHaveLength(1)
		await f.coordinator.dispose()
	})

	it("rejects deletion superseded before it can enter the account scope", async () => {
		const f = fixture("delete")
		const deleting = f.coordinator.deleteSession(f.record.id)
		const rejected = expect(deleting).rejects.toThrow("account scope changed")
		await Promise.all([rejected, f.coordinator.reset(f.changeScope)])
		expect(f.requests).toEqual([])
		await f.coordinator.dispose()
	})

	it("allows controller teardown to continue after its deadline without dropping late cleanup", async () => {
		vi.useFakeTimers()
		const f = fixture("create")
		const starting = f.coordinator.startCloudTask(startInput)
		await f.entered.promise
		const disposing = f.coordinator.dispose()
		await vi.advanceTimersByTimeAsync(15_000)
		await disposing
		f.barrier.resolve()
		await starting
		expect(f.requests.filter((request) => request.method === "DELETE")).toHaveLength(1)
		expect(f.requests.every((request) => request.token === `Bearer ${f.origin.token}`)).toBe(true)
	})

	it("cleans ordinary pre-send failures and leaves a truthful error phase", async () => {
		const f = fixture("prompt")
		const starting = f.coordinator.startCloudTask(startInput)
		await f.entered.promise
		f.barrier.reject(new Error("cannot resolve prompt"))
		expect(await starting).toBeUndefined()
		expect(f.options.setTurnPhase).toHaveBeenLastCalledWith("error")
		expect(f.requests.filter((request) => request.method === "DELETE")).toHaveLength(1)
		expect(f.lifecycle.getActiveSession()).toBeUndefined()
		await f.coordinator.dispose()
	})

	it("keeps originating cleanup enrolled until its DELETE response settles", async () => {
		const f = fixture("delete")
		vi.spyOn(f.options, "resolveContextMentions").mockRejectedValue(new Error("prompt failure"))
		const starting = f.coordinator.startCloudTask(startInput)
		await f.entered.promise
		const switching = f.coordinator.reset(f.changeScope)
		expect(f.changeScope).not.toHaveBeenCalled()
		f.barrier.resolve()
		await Promise.all([starting, switching])
		expect(f.changeScope).toHaveBeenCalledOnce()
		expect(f.requests.filter((request) => request.method === "DELETE")).toHaveLength(1)
		await f.coordinator.dispose()
	})

	it("keeps service-owned readiness cleanup when no coordinator callback takes ownership", async () => {
		const f = fixture("readiness")
		f.setReadinessStatus("failed")
		const creating = f.service.createSession({ modelId: "fixture-model", repoUrl: startInput.repoUrl })
		const rejected = expect(creating).rejects.toMatchObject({ code: "session_failed" })
		await f.entered.promise
		f.barrier.resolve()
		await rejected
		expect(f.requests.filter((request) => request.method === "DELETE")).toHaveLength(1)
		await f.coordinator.dispose()
	})
})
