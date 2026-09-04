import { SessionSource } from "@cline/core"
import { afterEach, describe, expect, it } from "vitest"
import { CLOUD_GITHUB_AUTH_SYSTEM_PROMPT, CloudSessionHost } from "@/sdk/cloud-session-host"
import { CloudSessionsService } from "@/services/cloud/CloudSessionsService"
import { type LocalCloudEnvironment, startLocalCloudEnvironment } from "./local-cloud-environment"

describe("CloudSessionHost real Hub boundary", () => {
	let environment: LocalCloudEnvironment | undefined
	let host: CloudSessionHost | undefined

	afterEach(async () => {
		await environment?.dispose()
		await host?.dispose("test teardown")
		host = undefined
		environment = undefined
	})

	it("authenticates, maps the outer id, and runs a turn through the real Hub", async () => {
		environment = await startLocalCloudEnvironment()
		const service = new CloudSessionsService({
			apiBaseUrl: environment.apiBaseUrl,
			appBaseUrl: environment.apiBaseUrl,
			getAuthToken: async () => environment?.accessToken,
			getActiveOrganizationId: () => undefined,
		})
		const record = await service.createSession({
			modelId: "fixture-model",
			repoUrl: "https://github.com/cline/fixture",
			branch: "main",
		})
		const owned = await environment.activateSession(record.id)
		expect(owned).toBeDefined()

		host = await CloudSessionHost.connect({
			outerSessionId: record.id,
			socketUrl: service.sessionSocketUrl(record.id),
			workspaceRoot: owned?.root,
			getAuthToken: async () => environment?.accessToken,
		})

		const started = await host.start({
			source: SessionSource.CORE,
			prompt: undefined,
			config: {
				providerId: "cline",
				modelId: "fixture-model",
				apiKey: "fixture-key",
				systemPrompt: "normal Cline guidance",
				enableTools: false,
				enableSpawnAgent: false,
				enableAgentTeams: false,
				cwd: owned?.root,
				workspaceRoot: owned?.root,
			},
		})

		expect(started.sessionId).toBe(record.id)
		expect(host.sessionId).toBe(record.id)
		await host.send({ sessionId: record.id, prompt: "reply from the fixture" })
		expect(host.status).not.toBe("running")
		const messages = await host.readMessages(record.id)
		expect(JSON.stringify(messages)).toContain("cloud fixture reply")
		expect(JSON.stringify(messages)).toContain("reply from the fixture")
		expect(CLOUD_GITHUB_AUTH_SYSTEM_PROMPT).toContain("GitHub API authentication")
	})

	it("rejects the WebSocket connection when the cloud credential is wrong", async () => {
		environment = await startLocalCloudEnvironment()
		const service = new CloudSessionsService({
			apiBaseUrl: environment.apiBaseUrl,
			appBaseUrl: environment.apiBaseUrl,
			getAuthToken: async () => environment?.accessToken,
			getActiveOrganizationId: () => undefined,
		})
		const record = await service.createSession({
			modelId: "fixture-model",
			repoUrl: "https://github.com/cline/fixture",
		})

		await expect(
			CloudSessionHost.connect({
				outerSessionId: record.id,
				socketUrl: service.sessionSocketUrl(record.id),
				getAuthToken: async () => "wrong-token",
			}),
		).rejects.toThrow()
	})
})
