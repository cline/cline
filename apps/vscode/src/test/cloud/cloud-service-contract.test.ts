import { afterEach, describe, expect, it } from "vitest"
import { CloudSessionError, CloudSessionsService } from "@/services/cloud/CloudSessionsService"
import { type LocalCloudEnvironment, startLocalCloudEnvironment } from "./local-cloud-environment"

describe("local cloud service boundary", () => {
	let environment: LocalCloudEnvironment | undefined

	afterEach(async () => {
		await environment?.dispose()
		environment = undefined
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
