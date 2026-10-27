import type { HubCloudSessionClient } from "@cline/core/cloud"
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
	let account: { key: string; organizationId: string | null; organizationName: string } = {
		key: "test-account",
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
		send: vi.fn<HubCloudSessionClient["send"]>(async () => ({ sessionId: "ses_example", ok: true })),
		subscribe: vi.fn<HubCloudSessionClient["subscribe"]>(() => () => {}),
	}
	const capture = vi.fn(async () => source)
	const summarize = vi.fn(async () => "Widget implemented; tests remain.")
	const coordinator = new SdkCloudHandoffCoordinator({
		capture,
		getCloud: async () => cloud,
		getAccount: () => account,
		assertEnabled: () => {},
		changed: async () => {},
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
		id,
		switchAccount: () => {
			account = { ...account, key: "other-account" }
		},
	}
}

describe("cloud conversation handoff", () => {
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
			cloud.scope,
		)
		expect(coordinator.viewFor(input.sourceTaskId)).toMatchObject({ phase: "complete", delivery: "sent" })
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
	it.each([false, true])("retries only the unsent continuation in the existing task (failure=%s)", async (failure) => {
		const { coordinator, cloud, id } = setup()
		cloud.create.mockResolvedValue({
			sessionId: "ses_example",
			status: "idle",
			initialSend: { dispatched: false, message: "unavailable" },
		})
		await coordinator.prepare(input)
		await coordinator.confirm(id())
		if (failure) cloud.send.mockRejectedValue(new Error("connection closed"))
		await Promise.all([coordinator.retryMessage(id()), coordinator.retryMessage(id())])
		await coordinator.retryMessage(id())
		expect(cloud.create).toHaveBeenCalledTimes(1)
		expect(cloud.send).toHaveBeenCalledTimes(1)
		expect(cloud.send).toHaveBeenCalledWith(
			"ses_example",
			"Widget implemented; tests remain.\n\nNext instruction from the user:\nFinish the tests",
			"queue",
			"test-model",
			[image],
		)
		expect(coordinator.viewFor(input.sourceTaskId)).toMatchObject({
			phase: "complete",
			delivery: failure ? "unconfirmed" : "sent",
		})
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
		expect(cloud.send).not.toHaveBeenCalled()
	})
})
