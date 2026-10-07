import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
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
			repoContext: { repoUrl: "https://github.com/cline/fixture", branch: "fixture" },
			metadata: { modelId: "fixture-model", taskId: expect.stringMatching(/^tsk-/) },
		})
		expect(service.sessionSocketUrl(created.id)).toBe(
			environment.apiBaseUrl.replace("http://", "ws://") + `/api/v1/session/${created.id}`,
		)

		await service.renameSession(created.id, "renamed")
		expect(await service.listSessions()).toEqual([expect.objectContaining({ id: created.id, title: "renamed" })])
		expect(await service.getStatus(created.id)).toEqual({ status: "ready" })
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
		expect(await service.getStatus(provisioningId!)).toEqual({ status: "provisioning" })
		await service.deleteSession(provisioningId!)
		expect(await service.listSessions()).toEqual([])
	})

	it("explains an unreachable control plane, but leaves a caller's cancellation alone", async () => {
		const server = createServer()
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
		const { port } = server.address() as AddressInfo
		await new Promise((resolve) => server.close(resolve))
		const service = new CloudSessionsService({
			apiBaseUrl: `http://127.0.0.1:${port}`,
			appBaseUrl: `http://127.0.0.1:${port}`,
			getAuthToken: async () => "token",
			getActiveOrganizationId: () => undefined,
		})

		await expect(service.listSessions()).rejects.toMatchObject({
			code: "request_failed",
			message:
				"Could not reach Cline Cloud (ECONNREFUSED). Check your internet connection and proxy settings, then try again.",
		})
		const cancelled = new Error("cancelled by the user")
		await expect(service.getStatus("ses-any", AbortSignal.abort(cancelled))).rejects.toBe(cancelled)
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
			status: 401,
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
