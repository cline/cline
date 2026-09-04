import { afterEach, describe, expect, it } from "vitest"
import { CloudSessionError, CloudSessionsService } from "@/services/cloud/CloudSessionsService"
import { type LocalCloudEnvironment, startLocalCloudEnvironment } from "./local-cloud-environment"

describe("local cloud service boundary", () => {
	let environment: LocalCloudEnvironment | undefined

	afterEach(async () => {
		await environment?.dispose()
		environment = undefined
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
			status: "active",
			repoContext: { repoUrl: "https://github.com/cline/fixture", branch: "fixture" },
			metadata: { modelId: "fixture-model" },
		})
		expect(service.sessionSocketUrl(created.id)).toBe(
			environment.apiBaseUrl.replace("http://", "ws://") + `/api/v1/session/${created.id}`,
		)

		await service.renameSession(created.id, "renamed")
		expect(await service.listSessions()).toEqual([expect.objectContaining({ id: created.id, title: "renamed" })])
		expect(await service.getStatus(created.id)).toEqual({ status: "active" })
		expect(await service.getHistory(created.id)).toEqual([])

		await service.deleteSession(created.id)
		expect(await service.listSessions()).toEqual([])
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
