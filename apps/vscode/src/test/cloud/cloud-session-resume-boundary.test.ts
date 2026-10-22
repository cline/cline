import { SessionSource } from "@cline/core"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CloudSessionHost } from "@/sdk/cloud-session-host"
import { MessageIdMinter } from "@/sdk/message-id-minter"
import { SdkCloudSessionCoordinator, type SdkCloudSessionCoordinatorOptions } from "@/sdk/sdk-cloud-session-coordinator"
import type { SdkSessionHost } from "@/sdk/session-host"
import type { TaskProxy } from "@/sdk/task-proxy"
import { CloudSessionsService } from "@/services/cloud/CloudSessionsService"
import { type LocalCloudEnvironment, startLocalCloudEnvironment } from "./local-cloud-environment"

// Only the IDE window and model-catalog refresh are replaced; the control
// plane, proxy, Hub transport and coordinator are the shipped implementations.
vi.mock("@/hosts/host-provider", () => ({ HostProvider: { window: { showMessage: vi.fn(async () => ({})) } } }))
vi.mock("@/core/controller/models/refreshClineRecommendedModels", () => ({ refreshClineRecommendedModels: vi.fn() }))

const config = {
	providerId: "cline",
	modelId: "fixture-model",
	systemPrompt: "normal Cline guidance",
	enableTools: false,
	enableSpawnAgent: false,
	enableAgentTeams: false,
}

describe("resuming a suspended cloud sandbox through the real Hub", () => {
	let environment: LocalCloudEnvironment | undefined
	let coordinator: SdkCloudSessionCoordinator | undefined
	const hosts: CloudSessionHost[] = []

	afterEach(async () => {
		await coordinator?.dispose()
		coordinator = undefined
		await Promise.allSettled(hosts.map((host) => host.dispose("test teardown")))
		hosts.length = 0
		await environment?.dispose()
		environment = undefined
	})

	/** A cloud task that has finished one turn, with no client connected. */
	async function finishedTask() {
		environment = await startLocalCloudEnvironment()
		const service = new CloudSessionsService({
			apiBaseUrl: environment.apiBaseUrl,
			appBaseUrl: environment.apiBaseUrl,
			getAuthToken: async () => environment?.accessToken,
			getActiveOrganizationId: () => undefined,
		})
		const record = await service.createSession({ modelId: "fixture-model", repoUrl: "https://github.com/cline/fixture" })
		const taskId = record.metadata.taskId
		if (!taskId) throw new Error("Local cloud session did not return a task id")
		const connect = async (restoreConfig?: () => Promise<typeof config>) => {
			const host = await CloudSessionHost.connect({
				outerSessionId: record.id,
				taskId,
				socketUrl: service.sessionSocketUrl(record.id),
				getAuthToken: async () => environment?.accessToken,
				restoreConfig,
			})
			hosts.push(host)
			return host
		}
		const first = await connect()
		await first.start({ source: SessionSource.CORE, interactive: true, prompt: undefined, config })
		await first.send({ sessionId: record.id, prompt: "first prompt" })
		expect(first.status).toBe("completed")
		await first.dispose("left the task")
		return { environment, service, record, connect }
	}

	it("refuses sockets while suspended, then continues the saved conversation after resume", async () => {
		const { environment, service, record, connect } = await finishedTask()

		await environment.suspendSession(record.id)
		await expect(service.getStatus(record.id)).resolves.toMatchObject({ status: "suspended" })
		await expect(connect()).rejects.toThrow("409")

		await service.resumeSession(record.id)
		const resumed = await connect(async () => config)
		expect(JSON.stringify(await resumed.readMessages(record.id))).toContain("first prompt")
		await resumed.send({ sessionId: record.id, prompt: "follow-up after resume" })
		expect(resumed.status).toBe("completed")
		const transcript = JSON.stringify(await resumed.readMessages(record.id))
		expect(transcript).toContain("first prompt")
		expect(transcript).toContain("follow-up after resume")
	})

	it.each([
		"after",
		"before",
	] as const)("opens a task History listed %s its sandbox was suspended by resuming it", async (listed) => {
		const { environment, service, record } = await finishedTask()
		let task: TaskProxy | undefined
		let attached: SdkSessionHost | undefined
		const renders: string[] = []
		coordinator = new SdkCloudSessionCoordinator({
			cloudSessions: service,
			stateManager: { getGlobalSettingsKey: () => "act", getGlobalStateKey: () => ({}), setGlobalState: vi.fn() },
			sessionConfigBuilder: { build: vi.fn(async () => config) },
			sessions: {
				attachExistingSession: vi.fn(async ({ sdkHost }: { sdkHost: SdkSessionHost }) => {
					attached = sdkHost
				}),
			},
			messages: { finalizeMessagesForSave: (messages: unknown) => messages },
			getMinter: () => new MessageIdMinter(),
			getTask: () => task,
			setTask: (next: TaskProxy | undefined) => {
				task = next
			},
			clearTask: async () => {
				task = undefined
				return () => false
			},
			claimTaskViewGeneration: () => () => false,
			getAuthToken: async () => environment.accessToken,
			isSignedIn: () => true,
			isEnabled: () => true,
			resetMessageTranslator: vi.fn(() => renders.push("new epoch")),
			setTurnPhase: vi.fn(),
			postStateToWebview: vi.fn(async () => {
				const text = task?.messageStateHandler.getClineMessages().at(-1)?.text
				if (text !== undefined) renders.push(`post: ${text}`)
			}),
			showChatView: vi.fn(async () => renders.push("chat view shown")),
			invalidateHistoryCache: vi.fn(),
			onAskResponse: vi.fn(),
			onCancelTask: vi.fn(),
		} as unknown as SdkCloudSessionCoordinatorOptions)

		if (listed === "before") await coordinator.listHistoryRecords()
		await environment.suspendSession(record.id)
		if (listed === "after") {
			// Never Unconfirmed, so History does not probe it with sockets that would be refused.
			const [row] = await coordinator.listHistoryRecords()
			expect(row.metadata?.cloudStatus).not.toBe("unknown")
			expect(await coordinator.resolveStatuses([record.id])).not.toContainEqual(
				expect.objectContaining({ status: "unknown" }),
			)
		}

		await coordinator.openCloudTask(record.id)
		// The transcript starts a new epoch after the notice, so the webview replaces the notice.
		const noticePosted = renders.indexOf("post: Resuming the cloud sandbox…")
		expect(noticePosted).toBeGreaterThan(-1)
		// The chat view is brought forward while the notice is showing, before the conversation replaces it.
		expect(renders.indexOf("chat view shown")).toBeGreaterThan(noticePosted)
		expect(renders.lastIndexOf("new epoch")).toBeGreaterThan(renders.indexOf("chat view shown"))
		expect(environment.sessions.get(record.id)?.record.status).toBe("ready")
		const shown = JSON.stringify(task?.messageStateHandler.getClineMessages())
		expect(shown).toContain("first prompt")
		expect(shown).not.toContain("Could not connect")

		if (!attached) throw new Error("The resumed task was not attached")
		await attached.send({ sessionId: record.id, prompt: "follow-up after resume" })
		expect(JSON.stringify(await attached.readMessages(record.id))).toContain("follow-up after resume")
	})
})
