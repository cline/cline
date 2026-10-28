import { CloudSessionError, type HubCloudSessionClient } from "@cline/core/cloud"
import { describe, expect, it, vi } from "vitest"
import { type CapturedHandoffSource, SdkCloudHandoffCoordinator } from "./sdk-cloud-handoff-coordinator"

const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII="
const input = { sourceTaskId: "local-task", instruction: "Finish the tests", images: [image], files: [] }

function setup() {
	const source: CapturedHandoffSource = {
		messages: [{ role: "user", content: "Implement the widget" }],
		config: { providerId: "cline", modelId: "test-model", thinking: false },
		mode: "act",
		plan: {
			id: "git-plan",
			root: "/workspace",
			workspaceRelativePath: "",
			repoUrl: "https://github.com/example/project",
			remote: "origin",
			branch: "cline/handoff-example",
			sourceBranch: "main",
			headSha: "a".repeat(40),
			treeSha: "b".repeat(40),
			files: [{ path: "widget.ts", status: "M" }],
			commits: [],
		},
	}
	let account: { key: string; accountId: string; organizationId: string | null; organizationName: string } = {
		key: "test-account",
		accountId: "test-user",
		organizationId: null,
		organizationName: "Personal",
	}
	const cloud = {
		connect: vi.fn(async () => {}),
		scope: { serviceId: "test-service", scopeGeneration: 1 },
		prepareHandoffRepository: vi.fn<HubCloudSessionClient["prepareHandoffRepository"]>(async () => ({
			organizationId: undefined,
		})),
		listModels: vi.fn<HubCloudSessionClient["listModels"]>(async () => [
			{ id: "test-model", name: "Test model", catalogId: "cline" },
		]),
		create: vi.fn<HubCloudSessionClient["create"]>(async () => ({
			sessionId: "ses_example",
			status: "running",
			initialSend: { sessionId: "ses_example", ok: true },
		})),
		sendWithOutcome: vi.fn<HubCloudSessionClient["sendWithOutcome"]>(async () => ({ sessionId: "ses_example", ok: true })),
		subscribe: vi.fn<HubCloudSessionClient["subscribe"]>(() => () => {}),
	}
	const capture = vi.fn(async () => source)
	const summarize = vi.fn(async () => "Widget implemented; tests remain.")
	const changed = vi.fn(async () => {})
	const coordinator = new SdkCloudHandoffCoordinator({
		capture,
		getCloud: () => cloud,
		getAccount: () => account,
		assertEnabled: () => {},
		changed,
		summarize,
	})
	const id = () => {
		const view = coordinator.viewFor(input.sourceTaskId)
		if (!view) throw new Error("Expected handoff view")
		return view.id
	}
	return {
		coordinator,
		cloud,
		source,
		capture,
		summarize,
		changed,
		id,
		switchAccount: () => {
			account = { ...account, key: "other-account", accountId: "other-user" }
		},
	}
}

describe("cloud conversation handoff", () => {
	it("settles a failed state update so preparation can be dismissed and restarted", async () => {
		const { coordinator, changed, capture, id } = setup()
		changed.mockRejectedValueOnce(new Error("Webview unavailable"))
		await coordinator.prepare(input)
		expect(coordinator.viewFor(input.sourceTaskId)).toMatchObject({ phase: "failed", message: "Webview unavailable" })
		expect(capture).not.toHaveBeenCalled()
		await coordinator.discard(id())
		await coordinator.prepare(input)
		expect(coordinator.viewFor(input.sourceTaskId)?.phase).toBe("ready")
	})

	it.each([
		[
			new Error(new CloudSessionError("github_not_connected", "Connect GitHub before handing off.").message),
			"Connect GitHub before handing off.",
		],
		[new Error("CLOUD_SESSION_ERROR:not-json"), "CLOUD_SESSION_ERROR:not-json"],
		[new Error('CLOUD_SESSION_ERROR:{"message":42}'), 'CLOUD_SESSION_ERROR:{"message":42}'],
		[new Error("Network unavailable"), "Network unavailable"],
		[new Error(""), "Unable to prepare cloud handoff."],
	])("shows a readable preparation error for %s", async (error, message) => {
		const { coordinator, cloud } = setup()
		cloud.prepareHandoffRepository.mockRejectedValue(error)
		await coordinator.prepare(input)
		expect(coordinator.viewFor(input.sourceTaskId)).toMatchObject({ phase: "failed", message })
		expect(cloud.create).not.toHaveBeenCalled()
	})

	it("publishes only after confirmation and sends the captured summary, instruction and images once", async () => {
		const { coordinator, cloud, summarize, id } = setup()
		await coordinator.prepare(input)
		expect(cloud.create).not.toHaveBeenCalled()
		expect(coordinator.viewFor(input.sourceTaskId)).toMatchObject({
			phase: "ready",
			imageCount: 1,
			git: { files: [{ path: "widget.ts" }] },
		})
		await Promise.all([coordinator.confirm(id()), coordinator.confirm(id())])
		await coordinator.confirm(id())
		expect(cloud.create).toHaveBeenCalledTimes(1)
		expect(summarize).toHaveBeenCalledTimes(1)
		expect(cloud.create).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: null,
				thinking: false,
				localGit: expect.objectContaining({ treeSha: "b".repeat(40) }),
				initialMessage: {
					text: "Widget implemented; tests remain.\n\nNext instruction from the user:\nFinish the tests",
					images: [image],
				},
			}),
			{ ...cloud.scope, expectedAccountId: "test-user" },
		)
		expect(coordinator.viewFor(input.sourceTaskId)).toMatchObject({ phase: "complete", delivery: "sent" })
	})

	it("binds preparation to the signed-in account before summarizing or publishing", async () => {
		const { coordinator, cloud, summarize } = setup()
		cloud.prepareHandoffRepository.mockRejectedValue(new Error("Cloud account does not match the signed-in account"))
		await coordinator.prepare(input)
		expect(cloud.prepareHandoffRepository).toHaveBeenCalledWith("https://github.com/example/project", {
			...cloud.scope,
			expectedAccountId: "test-user",
		})
		expect(coordinator.viewFor(input.sourceTaskId)).toMatchObject({
			phase: "failed",
			message: expect.stringContaining("account"),
		})
		expect(summarize).not.toHaveBeenCalled()
		expect(cloud.create).not.toHaveBeenCalled()
	})

	it("cancels a prepared snapshot without publishing", async () => {
		const { coordinator, cloud, id } = setup()
		await coordinator.prepare(input)
		const preparationId = id()
		await coordinator.discard(preparationId)
		await expect(coordinator.confirm(preparationId)).rejects.toThrow("expired")
		expect(coordinator.viewFor(input.sourceTaskId)).toBeUndefined()
		expect(cloud.create).not.toHaveBeenCalled()
	})

	it("rejects unsupported file attachments before capture", async () => {
		const { coordinator, capture } = setup()
		await expect(coordinator.prepare({ ...input, files: ["/workspace/notes.txt"] })).rejects.toThrow("Only image")
		expect(capture).not.toHaveBeenCalled()
	})

	it("refuses an old account's approval", async () => {
		const { coordinator, cloud, id, switchAccount } = setup()
		await coordinator.prepare(input)
		const preparationId = id()
		switchAccount()
		await expect(coordinator.confirm(preparationId)).rejects.toThrow("account")
		expect(coordinator.viewFor(input.sourceTaskId)).toBeUndefined()
		expect(cloud.create).not.toHaveBeenCalled()
	})

	it.each([false, true])("distinguishes unsent from dispatched=%s initial-message failure", async (dispatched) => {
		const { coordinator, cloud, id } = setup()
		cloud.create.mockResolvedValue({
			sessionId: "ses_example",
			status: "idle",
			initialSend: { dispatched, message: "connection failed" },
		})
		await coordinator.prepare(input)
		await coordinator.confirm(id())
		expect(coordinator.viewFor(input.sourceTaskId)).toMatchObject({
			phase: "complete",
			delivery: dispatched ? "unconfirmed" : "unsent",
			sessionId: "ses_example",
		})
		await coordinator.confirm(id())
		expect(cloud.create).toHaveBeenCalledTimes(1)
	})

	it("does not recreate after an unknown result, including a fresh prepare request", async () => {
		const { coordinator, cloud, id } = setup()
		cloud.create.mockRejectedValue(new Error("Connection closed"))
		await coordinator.prepare(input)
		await coordinator.confirm(id())
		await coordinator.confirm(id())
		await expect(coordinator.prepare(input)).rejects.toThrow("existing cloud handoff")
		expect(coordinator.viewFor(input.sourceTaskId)).toMatchObject({
			phase: "failed",
			message: expect.stringContaining("Check Cline Cloud"),
		})
		expect(cloud.create).toHaveBeenCalledTimes(1)
	})
	it.each([
		"sent",
		"unsent",
		"dispatched",
		"unknown",
	])("retries only the unsent continuation in the existing task (%s)", async (outcome) => {
		const { coordinator, cloud, id } = setup()
		cloud.create.mockResolvedValue({
			sessionId: "ses_example",
			status: "idle",
			initialSend: { dispatched: false, message: "unavailable" },
		})
		await coordinator.prepare(input)
		await coordinator.confirm(id())
		if (outcome === "unknown") cloud.sendWithOutcome.mockRejectedValueOnce(new Error("connection closed"))
		else if (outcome !== "sent")
			cloud.sendWithOutcome.mockResolvedValueOnce({ dispatched: outcome === "dispatched", message: "Connection failed" })
		await Promise.all([coordinator.retryMessage(id()), coordinator.retryMessage(id())])
		expect(cloud.create).toHaveBeenCalledTimes(1)
		expect(cloud.sendWithOutcome).toHaveBeenCalledTimes(1)
		expect(cloud.sendWithOutcome).toHaveBeenCalledWith(
			"ses_example",
			"Widget implemented; tests remain.\n\nNext instruction from the user:\nFinish the tests",
			"queue",
			"test-model",
			[image],
		)
		expect(coordinator.viewFor(input.sourceTaskId)).toMatchObject({
			phase: "complete",
			delivery: outcome === "sent" ? "sent" : outcome === "unsent" ? "unsent" : "unconfirmed",
		})
		await coordinator.retryMessage(id())
		expect(cloud.sendWithOutcome).toHaveBeenCalledTimes(outcome === "unsent" ? 2 : 1)
		if (outcome === "unsent") {
			expect(cloud.sendWithOutcome.mock.calls[1]).toEqual(cloud.sendWithOutcome.mock.calls[0])
			expect(coordinator.viewFor(input.sourceTaskId)).toMatchObject({ delivery: "sent" })
		}
		expect(cloud.create).toHaveBeenCalledTimes(1)
	})

	it("keeps a safe retry when state publication fails before sending", async () => {
		const { coordinator, cloud, changed, id } = setup()
		cloud.create.mockResolvedValue({
			sessionId: "ses_example",
			status: "idle",
			initialSend: { dispatched: false, message: "unavailable" },
		})
		await coordinator.prepare(input)
		await coordinator.confirm(id())
		changed.mockRejectedValueOnce(new Error("Webview unavailable"))
		await expect(coordinator.retryMessage(id())).rejects.toThrow("Webview unavailable")
		expect(cloud.sendWithOutcome).not.toHaveBeenCalled()
		expect(coordinator.viewFor(input.sourceTaskId)).toMatchObject({ phase: "complete", delivery: "unsent" })
		await coordinator.retryMessage(id())
		expect(cloud.sendWithOutcome).toHaveBeenCalledTimes(1)
		expect(coordinator.viewFor(input.sourceTaskId)).toMatchObject({ phase: "complete", delivery: "sent" })
	})

	it("does not retry an unsent continuation after the Hub scope changes", async () => {
		const { coordinator, cloud, id } = setup()
		cloud.create.mockResolvedValue({
			sessionId: "ses_example",
			status: "idle",
			initialSend: { dispatched: false, message: "unavailable" },
		})
		await coordinator.prepare(input)
		await coordinator.confirm(id())
		cloud.scope = { ...cloud.scope, scopeGeneration: cloud.scope.scopeGeneration + 1 }
		await expect(coordinator.retryMessage(id())).rejects.toThrow("account changed")
		expect(cloud.sendWithOutcome).not.toHaveBeenCalled()
	})
})
