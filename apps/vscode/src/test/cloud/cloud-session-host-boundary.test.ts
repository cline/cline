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
		let releaseSecondTurn!: () => void
		let secondTurnEntered!: () => void
		const entered = new Promise<void>((resolve) => {
			secondTurnEntered = resolve
		})
		const released = new Promise<void>((resolve) => {
			releaseSecondTurn = resolve
		})
		let turns = 0
		environment = await startLocalCloudEnvironment({
			beforeModelResponse: async () => {
				if (++turns === 2) {
					secondTurnEntered()
					await released
				}
			},
		})
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
		const taskId = record.metadata.taskId
		expect(taskId).toMatch(/^tsk-/)
		if (!taskId) throw new Error("Local cloud session did not return a task id")

		host = await CloudSessionHost.connect({
			outerSessionId: record.id,
			taskId,
			socketUrl: service.sessionSocketUrl(record.id),
			workspaceRoot: owned?.root,
			getAuthToken: async () => environment?.accessToken,
		})

		const started = await host.start({
			source: SessionSource.CORE,
			interactive: true,
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
		expect(taskId).not.toBe(record.id)
		await host.send({ sessionId: record.id, prompt: "reply from the fixture" })
		expect(host.status).not.toBe("running")
		expect(owned.sessionStore?.get(taskId)?.sessionId).toBe(taskId)
		expect(owned.sessionStore?.get(record.id)).toBeUndefined()
		const messages = await host.readMessages(record.id)
		expect(JSON.stringify(messages)).toContain("cloud fixture reply")
		expect(JSON.stringify(messages)).toContain("reply from the fixture")
		expect(CLOUD_GITHUB_AUTH_SYSTEM_PROMPT).toContain("GitHub API authentication")

		// A status-only connection has no turn subscription. Re-read its snapshot
		// when another client resumes the same canonical task.
		const observer = await CloudSessionHost.connect({
			outerSessionId: record.id,
			taskId,
			socketUrl: service.sessionSocketUrl(record.id),
			workspaceRoot: owned.root,
			getAuthToken: async () => environment?.accessToken,
		})
		const sending = host.send({ sessionId: record.id, prompt: "resume from another client" })
		void sending.catch(() => {})
		try {
			await Promise.race([
				entered,
				sending.then(() => {
					throw new Error("Second turn ended before reaching the model")
				}),
			])
			expect(await observer.refreshStatus()).toBe("running")
			releaseSecondTurn()
			await sending
			expect(await observer.refreshStatus()).not.toBe("running")
		} finally {
			releaseSecondTurn()
			await sending.catch(() => {})
			await observer.dispose()
		}
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
		const taskId = record.metadata.taskId
		if (!taskId) throw new Error("Local cloud session did not return a task id")

		await expect(
			CloudSessionHost.connect({
				outerSessionId: record.id,
				taskId,
				socketUrl: service.sessionSocketUrl(record.id),
				getAuthToken: async () => "wrong-token",
			}),
		).rejects.toThrow()
	})
})
