import { type CoreSessionEvent, SessionSource } from "@cline/core"
import { afterEach, describe, expect, it } from "vitest"
import { CloudSessionHost } from "@/sdk/cloud-session-host"
import { MessageTranslatorState, translateSessionEvent } from "@/sdk/message-translator"
import { CloudSessionsService } from "@/services/cloud/CloudSessionsService"
import type { ClineMessage } from "@/shared/ExtensionMessage"
import { type LocalCloudEnvironment, startLocalCloudEnvironment } from "./local-cloud-environment"

describe("cloud insufficient-credit failures through the real Hub", () => {
	let environment: LocalCloudEnvironment | undefined
	let host: CloudSessionHost | undefined

	afterEach(async () => {
		await host?.dispose("test teardown")
		await environment?.dispose()
		host = undefined
		environment = undefined
	})

	it("renders the out-of-credits failure instead of an unexplained Retry", async () => {
		environment = await startLocalCloudEnvironment({ insufficientCredits: true })
		const service = new CloudSessionsService({
			apiBaseUrl: environment.apiBaseUrl,
			appBaseUrl: environment.apiBaseUrl,
			getAuthToken: async () => environment?.accessToken,
			getActiveOrganizationId: () => undefined,
		})
		const record = await service.createSession({ modelId: "fixture-model", repoUrl: "https://github.com/cline/fixture" })
		const owned = await environment.activateSession(record.id)
		const taskId = record.metadata.taskId
		if (!taskId) throw new Error("Local cloud session did not return a task id")

		host = await CloudSessionHost.connect({
			outerSessionId: record.id,
			taskId,
			socketUrl: service.sessionSocketUrl(record.id),
			workspaceRoot: owned.root,
			getAuthToken: async () => environment?.accessToken,
		})
		const events: CoreSessionEvent[] = []
		host.subscribe((event) => events.push(event))
		await host.start({
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
				cwd: owned.root,
				workspaceRoot: owned.root,
			},
		})
		await host.send({ sessionId: record.id, prompt: "spend a credit" })
		expect(host.status).toBe("failed")

		const state = new MessageTranslatorState()
		const messages: ClineMessage[] = []
		let turnComplete = false
		for (const event of events) {
			const result = translateSessionEvent(event, state)
			messages.push(...result.messages)
			turnComplete ||= result.turnComplete
		}

		expect(turnComplete).toBe(true)
		expect(state.wasErrorSeen()).toBe(true)
		const failed = messages.filter((message) => message.ask === "api_req_failed")
		expect(failed).toHaveLength(1)
		expect(JSON.parse(failed[0].text ?? "{}")).toMatchObject({
			code: "insufficient_credits",
			providerId: "cline",
			details: { message: "Not enough credits available" },
		})
	})
})
