import { CloudCreationUnconfirmedError } from "@cline/core/cloud"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CloudSessionError, CloudSessionsService, type CloudSessionsServiceOptions } from "@/services/cloud/CloudSessionsService"
import { type LocalCloudEnvironment, startLocalCloudEnvironment } from "./local-cloud-environment"

describe("local cloud service boundary", () => {
	let environment: LocalCloudEnvironment | undefined
	const createInput = { modelId: "fixture-model", repoUrl: "https://github.com/cline/fixture", branch: "main" }
	const controlledService = (
		fetchImpl: (url: string | URL | Request, init?: RequestInit) => Promise<Response>,
		options: Partial<CloudSessionsServiceOptions> = {},
	) =>
		new CloudSessionsService({
			apiBaseUrl: "http://127.0.0.1",
			appBaseUrl: "http://127.0.0.1",
			getAuthToken: async () => "fixture-token",
			getActiveOrganizationId: () => undefined,
			...options,
			fetch: Object.assign(fetchImpl, { preconnect: vi.fn() }),
		})

	afterEach(async () => {
		vi.restoreAllMocks()
		await environment?.dispose()
		environment = undefined
	})

	it.each([true, false])("handles a lost create response with a visible recovery match: %s", async (hasMatch) => {
		const calls: string[] = []
		const lostResponse = new Error("response lost")
		let recoveryTitle = ""
		let organizationId = "original-org"
		const service = controlledService(
			async (url, init) => {
				const path = new URL(String(url)).pathname
				if (init?.method === "POST") {
					calls.push("post")
					const body = JSON.parse(String(init.body))
					expect(body).toMatchObject({ ...createInput, organizationId: "original-org" })
					recoveryTitle = body.title
					expect(recoveryTitle).toMatch(/^__cline_create_request__:/)
					throw lostResponse
				}
				if (path.endsWith("/status")) {
					calls.push("status")
					return Response.json({ data: { status: "ready" } })
				}
				calls.push("list")
				expect(new URL(String(url)).searchParams.get("organizationId")).toBe("original-org")
				return Response.json({
					data: hasMatch
						? [
								{
									id: "ses-fixture",
									title: recoveryTitle,
									status: "active",
									repoContext: { repoUrl: createInput.repoUrl, branch: createInput.branch },
									metadata: { modelId: createInput.modelId },
									createdAt: "",
									updatedAt: "",
								},
							]
						: [],
				})
			},
			{ getActiveOrganizationId: () => organizationId },
		)
		const onProvisioning = vi.fn((id: string) => {
			expect(id).toBe("ses-fixture")
			calls.push("provisioning")
			organizationId = "later-org"
		})
		const result = service.createSession(createInput, onProvisioning)
		if (hasMatch) {
			await expect(result).resolves.toMatchObject({
				id: "ses-fixture",
				title: undefined,
				metadata: { createRequestTitle: expect.stringMatching(/^__cline_create_request__:/) },
			})
			expect(calls).toEqual(["post", "list", "provisioning", "status", "list"])
		} else {
			await expect(result).rejects.toBeInstanceOf(CloudCreationUnconfirmedError)
			await expect(result).rejects.toMatchObject({ cause: lostResponse })
			expect(onProvisioning).not.toHaveBeenCalled()
			expect(calls).toEqual(["post", "list"])
		}
	})

	it.each([422, 403])("keeps a definite %s rejection friendly and retryable without recovery", async (status) => {
		const fetchImpl = vi.fn(async () => Response.json({ error: "fixture rejection" }, { status }))
		const result = controlledService(fetchImpl).createSession(createInput)
		await expect(result).rejects.toBeInstanceOf(CloudSessionError)
		await expect(result).rejects.toMatchObject({
			status,
			code: "request_failed",
			message: status === 403 ? expect.stringContaining("Switch to Personal") : "fixture rejection",
		})
		expect(fetchImpl).toHaveBeenCalledTimes(1)
	})

	it("preserves GitHub disconnection, branch validation and repository sorting", async () => {
		const fetchImpl = vi.fn(async () => Response.json({ error: "Connect GitHub" }, { status: 412 }))
		const service = controlledService(fetchImpl, { getActiveOrganizationId: () => "fixture-org" })
		await expect(service.getGitHubConnection()).resolves.toEqual({
			connected: false,
			repositories: [],
			connectUrl: "http://127.0.0.1/dashboard/organization/integrations",
		})
		await expect(service.listBranches(-1)).resolves.toEqual([])
		expect(fetchImpl).toHaveBeenCalledTimes(1)
		fetchImpl.mockResolvedValueOnce(
			Response.json({
				data: [
					{ id: 2, full_name: "fixture/z", html_url: "https://github.com/fixture/z" },
					{ id: 1, full_name: "fixture/a", html_url: "https://github.com/fixture/a" },
				],
			}),
		)
		expect((await service.getGitHubConnection()).repositories.map((repo) => repo.fullName)).toEqual([
			"fixture/a",
			"fixture/z",
		])
		fetchImpl.mockResolvedValueOnce(Response.json({ error: "Missing" }, { status: 404 }))
		await expect(service.listBranches(1)).resolves.toEqual([])
	})

	it("does not dispatch creation after the authenticated account changes", async () => {
		const token = (subject: string) =>
			`header.${Buffer.from(JSON.stringify({ sub: subject })).toString("base64url")}.signature`
		const getAuthToken = vi.fn().mockResolvedValueOnce(token("first")).mockResolvedValue(token("second"))
		const fetchImpl = vi.fn(async () => Response.json({ data: [] }))
		await expect(controlledService(fetchImpl, { getAuthToken }).createSession(createInput)).rejects.toMatchObject({
			code: "authentication_required",
			message: "The signed-in account changed during cloud session creation.",
		})
		expect(fetchImpl).not.toHaveBeenCalled()
	})

	it.each(["journal failure", "cancellation"])("returns a learned id before readiness despite %s", async (failure) => {
		const cancel = new AbortController()
		const error = new Error(failure)
		const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
			if (failure === "cancellation") {
				cancel.abort(error)
				expect(init?.signal?.aborted).toBe(false)
			}
			return Response.json({ data: { sessionId: "ses-fixture", status: "provisioning" } })
		})
		let learnedId: string | undefined
		await expect(
			controlledService(fetchImpl).createSession(
				createInput,
				(id) => {
					learnedId = id
					if (failure === "journal failure") throw error
				},
				cancel.signal,
			),
		).rejects.toBe(error)
		expect(learnedId).toBe("ses-fixture")
		expect(fetchImpl).toHaveBeenCalledTimes(1)
	})

	it.each(["readiness", "status"] as const)("bounds a hung %s request with a non-expiring caller signal", async (operation) => {
		const timeout = AbortSignal.timeout.bind(AbortSignal)
		vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) =>
			timeout(ms === 610_000 ? 40 : ms === 15_000 ? (operation === "status" ? 20 : 1_000) : ms),
		)
		const cancel = new AbortController()
		const service = controlledService(
			async (_url, init) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
				}),
		)
		let deadline: ReturnType<typeof setTimeout> | undefined
		try {
			const request =
				operation === "readiness"
					? service.waitUntilReady("ses-fixture", cancel.signal)
					: service.getStatus("ses-fixture", cancel.signal)
			const outcome = await Promise.race([
				request.then(
					() => "ready",
					(error) => {
						if (operation === "readiness") {
							expect(error).toMatchObject({
								code: "request_failed",
								message: "Timed out waiting for the cloud sandbox to become ready.",
							})
						} else {
							expect(error).toMatchObject({ name: "TimeoutError" })
						}
						return "bounded"
					},
				),
				new Promise<string>((resolve) => {
					deadline = setTimeout(() => resolve("hung"), 150)
				}),
			])
			expect(outcome).toBe("bounded")
		} finally {
			clearTimeout(deadline)
			cancel.abort()
		}
	})

	it("does not expose server exception details in HTTP errors", async () => {
		environment = await startLocalCloudEnvironment()
		const response = await fetch(`${environment.apiBaseUrl}/api/v1/session`, {
			method: "POST",
			headers: { Authorization: `Bearer ${environment.accessToken}`, "Content-Type": "application/json" },
			body: "{",
		})
		const body = (await response.json()) as { error?: string }

		expect(response.status).toBe(500)
		expect(body.error).toBe("Local cloud fixture request failed")
		expect(body.error).not.toMatch(/json|position|stack/i)
	})

	it("exercises the production service contract without credentials or non-loopback traffic", async () => {
		environment = await startLocalCloudEnvironment()
		const service = new CloudSessionsService({
			apiBaseUrl: environment.apiBaseUrl,
			appBaseUrl: environment.apiBaseUrl,
			getAuthToken: async () => environment?.accessToken,
			getActiveOrganizationId: () => undefined,
		})

		const github = await service.getGitHubConnection()
		expect(github).toMatchObject({
			connected: true,
			repositories: [{ id: 1, fullName: "cline/fixture", defaultBranch: "main" }],
		})
		expect(await service.listBranches(1)).toEqual(["main", "fixture"])

		const created = await service.createSession({
			modelId: "fixture-model",
			repoUrl: "https://github.com/cline/fixture",
			branch: "fixture",
		})
		expect(created).toMatchObject({
			status: "ready",
			sandboxType: "resumable",
			repoContext: { repoUrl: "https://github.com/cline/fixture", branch: "fixture" },
			metadata: { modelId: "fixture-model", taskId: expect.stringMatching(/^tsk-/) },
		})
		expect(service.sessionSocketUrl(created.id)).toBe(
			environment.apiBaseUrl.replace("http://", "ws://") + `/api/v1/session/${created.id}`,
		)

		await service.renameSession(created.id, "renamed")
		expect(await service.listSessions()).toEqual([expect.objectContaining({ id: created.id, title: "renamed" })])
		expect(await service.getStatus(created.id)).toEqual({ status: "ready", phase: "ready" })
		expect(await service.getHistory(created.id)).toEqual([])

		await service.deleteSession(created.id)
		expect(await service.listSessions()).toEqual([])
	})

	it("stops waiting for a provisioning sandbox when the start is cancelled", async () => {
		environment = await startLocalCloudEnvironment({ provisioningDelayMs: 60_000 })
		const service = new CloudSessionsService({
			apiBaseUrl: environment.apiBaseUrl,
			appBaseUrl: environment.apiBaseUrl,
			getAuthToken: async () => environment?.accessToken,
			getActiveOrganizationId: () => undefined,
		})
		const cancel = new AbortController()
		let provisioningId: string | undefined
		const creating = service.createSession(
			{ modelId: "fixture-model", repoUrl: "https://github.com/cline/fixture" },
			(id) => {
				provisioningId = id
				cancel.abort(new Error("cancelled by test"))
			},
			cancel.signal,
		)

		await expect(creating).rejects.toThrow("cancelled by test")
		expect(provisioningId).toMatch(/^ses-/)
		// The record exists in `provisioning`; the caller owns its deletion.
		expect(await service.getStatus(provisioningId!)).toEqual({ status: "provisioning", phase: "cloning_repo" })
		await service.deleteSession(provisioningId!)
		expect(await service.listSessions()).toEqual([])
	})

	it("adopts a sandbox whose create response was lost instead of provisioning a second one", async () => {
		environment = await startLocalCloudEnvironment()
		const service = new CloudSessionsService({
			apiBaseUrl: environment.apiBaseUrl,
			appBaseUrl: environment.apiBaseUrl,
			getAuthToken: async () => environment?.accessToken,
			getActiveOrganizationId: () => undefined,
		})
		environment.loseNextCreateResponse()

		const created = await service.createSession({ modelId: "fixture-model", repoUrl: "https://github.com/cline/fixture" })

		expect([...environment.sessions.keys()]).toEqual([created.id])
		// The request marker used for recovery never reaches History as a title.
		expect(await service.listSessions()).toEqual([expect.objectContaining({ id: created.id, title: undefined })])
	})

	it("reports provisioning phases while a sandbox starts", async () => {
		environment = await startLocalCloudEnvironment({ provisioningDelayMs: 4_000 })
		const service = new CloudSessionsService({
			apiBaseUrl: environment.apiBaseUrl,
			appBaseUrl: environment.apiBaseUrl,
			getAuthToken: async () => environment?.accessToken,
			getActiveOrganizationId: () => undefined,
		})
		const phases: string[] = []

		await service.createSession(
			{ modelId: "fixture-model", repoUrl: "https://github.com/cline/fixture" },
			undefined,
			undefined,
			(phase) => {
				if (phases.at(-1) !== phase) phases.push(phase)
			},
		)

		expect(phases).toEqual(["cloning_repo", "agent_starting", "ready"])
	})

	it("rejects an invalid credential", async () => {
		environment = await startLocalCloudEnvironment()
		const service = new CloudSessionsService({
			apiBaseUrl: environment.apiBaseUrl,
			appBaseUrl: environment.apiBaseUrl,
			getAuthToken: async () => "wrong-token",
			getActiveOrganizationId: () => undefined,
		})

		await expect(service.listSessions()).rejects.toMatchObject({
			code: "authentication_required",
			message: "Unauthorized",
		} satisfies Partial<CloudSessionError>)
	})

	it("serializes concurrent activation as one owned sandbox", async () => {
		environment = await startLocalCloudEnvironment()
		const service = new CloudSessionsService({
			apiBaseUrl: environment.apiBaseUrl,
			appBaseUrl: environment.apiBaseUrl,
			getAuthToken: async () => environment?.accessToken,
			getActiveOrganizationId: () => undefined,
		})
		const created = await service.createSession({
			modelId: "fixture-model",
			repoUrl: "https://github.com/cline/fixture",
		})

		const [first, second] = await Promise.all([
			environment.activateSession(created.id),
			environment.activateSession(created.id),
		])

		expect(first).toBe(second)
		expect(first.hub).toBeDefined()
	})
})
