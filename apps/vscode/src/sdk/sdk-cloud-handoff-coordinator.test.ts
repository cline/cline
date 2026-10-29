import { CloudSessionError, type HubCloudSessionClient } from "@cline/core/cloud"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { type CapturedHandoffSource, SdkCloudHandoffCoordinator } from "./sdk-cloud-handoff-coordinator"

const resolveCredentials = vi.hoisted(() => vi.fn())
vi.mock("@cline/core", async (original) => ({
	...(await original<typeof import("@cline/core")>()),
	RuntimeOAuthTokenManager: class {
		resolveProviderApiKey = resolveCredentials
	},
}))
beforeEach(() => resolveCredentials.mockReset().mockResolvedValue(null))

const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII="
const input = { sourceTaskId: "local-task", instruction: "Finish the tests", images: [image], files: [] }

function setup() {
	const source: CapturedHandoffSource = {
		messages: [{ role: "user", content: "Implement the widget" }],
		config: { providerId: "cline", modelId: "test-model", apiKey: "original-token", thinking: false },
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
		send: vi.fn<HubCloudSessionClient["send"]>(async () => ({ sessionId: "ses_example", ok: true })),
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
	it("finds a completed handoff from its cloud destination without changing source ownership", async () => {
		const { coordinator, id, switchAccount } = setup()
		await coordinator.prepare(input)
		expect(coordinator.viewFor("ses_example")).toBeUndefined()
		await coordinator.confirm(id())
		const sourceView = coordinator.viewFor(input.sourceTaskId)
		expect(coordinator.viewFor("ses_example")).toEqual(sourceView)
		expect(sourceView).toMatchObject({ phase: "complete", sourceTaskId: input.sourceTaskId, sessionId: "ses_example" })
		expect(coordinator.viewFor("unrelated-task")).toBeUndefined()
		expect(coordinator.viewFor(undefined)).toBeUndefined()
		switchAccount()
		expect(coordinator.viewFor("ses_example")).toBeUndefined()
	})

	it("resolves fresh summary credentials after Hub preparation without changing the captured model", async () => {
		const { coordinator, cloud, summarize } = setup()
		cloud.listModels.mockImplementationOnce(async () => {
			resolveCredentials.mockResolvedValue({ apiKey: "refreshed-token", accountId: "test-user", refreshed: true })
			return [{ id: "test-model", name: "Test model", catalogId: "cline" }]
		})
		await coordinator.prepare(input)
		expect(resolveCredentials).toHaveBeenCalledWith({ providerId: "cline" })
		expect(summarize).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({ providerId: "cline", modelId: "test-model", apiKey: "refreshed-token" }),
			}),
		)
		expect(coordinator.viewFor(input.sourceTaskId)?.phase).toBe("ready")
		expect(cloud.create).not.toHaveBeenCalled()
	})

	it("shows a credential refresh failure without summarizing or publishing", async () => {
		const { coordinator, cloud, summarize } = setup()
		resolveCredentials.mockRejectedValueOnce(new Error("Sign in again"))
		await coordinator.prepare(input)
		expect(coordinator.viewFor(input.sourceTaskId)).toMatchObject({ phase: "failed", message: "Sign in again" })
		expect(summarize).not.toHaveBeenCalled()
		expect(cloud.create).not.toHaveBeenCalled()
	})

	it.each([
		"cline",
		"cline-pass",
	])("rejects %s credentials from another account while the window account is unchanged", async (providerId) => {
		const { coordinator, source, cloud, summarize } = setup()
		source.config.providerId = providerId
		resolveCredentials.mockResolvedValue({ apiKey: "other-account-token", accountId: "other-user", refreshed: false })
		await coordinator.prepare(input)
		expect(coordinator.viewFor(input.sourceTaskId)).toMatchObject({
			phase: "failed",
			message: expect.stringContaining("account"),
		})
		expect(summarize).not.toHaveBeenCalled()
		expect(cloud.create).not.toHaveBeenCalled()
	})

	it("does not reuse captured OAuth credentials after sign-out during refresh", async () => {
		const { coordinator, source, cloud, summarize } = setup()
		source.config.apiKey = "workos:captured-token"
		resolveCredentials.mockResolvedValue(null)
		await coordinator.prepare(input)
		expect(coordinator.viewFor(input.sourceTaskId)).toMatchObject({
			phase: "failed",
			message: expect.stringContaining("account"),
		})
		expect(summarize).not.toHaveBeenCalled()
		expect(cloud.create).not.toHaveBeenCalled()
	})

	it("allows another provider's OAuth identity without comparing it to the cloud account", async () => {
		const { coordinator, source, summarize } = setup()
		source.config.providerId = "openai-codex"
		resolveCredentials.mockResolvedValue({ apiKey: "provider-token", accountId: "provider-user", refreshed: false })
		await coordinator.prepare(input)
		expect(coordinator.viewFor(input.sourceTaskId)?.phase).toBe("ready")
		expect(summarize).toHaveBeenCalledWith(
			expect.objectContaining({ config: expect.objectContaining({ apiKey: "provider-token" }) }),
		)
	})

	it("stops preparation when the window account changes during credential refresh", async () => {
		const { coordinator, cloud, summarize, switchAccount } = setup()
		resolveCredentials.mockImplementationOnce(async () => {
			switchAccount()
			return { apiKey: "other-account-token", refreshed: false }
		})
		await coordinator.prepare(input)
		expect(coordinator.viewFor(input.sourceTaskId)).toBeUndefined()
		expect(summarize).not.toHaveBeenCalled()
		expect(cloud.create).not.toHaveBeenCalled()
	})

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
			"connect_github",
		],
		[new Error("CLOUD_SESSION_ERROR:not-json"), "CLOUD_SESSION_ERROR:not-json", undefined],
		[new Error('CLOUD_SESSION_ERROR:{"message":42}'), 'CLOUD_SESSION_ERROR:{"message":42}', undefined],
		[new Error("Network unavailable"), "Network unavailable", undefined],
		[new Error(new CloudSessionError("request_failed", "Request unavailable.").message), "Request unavailable.", undefined],
		[new Error(""), "Unable to prepare cloud handoff.", undefined],
	])("shows a readable preparation error for %s", async (error, message, recovery) => {
		const { coordinator, cloud } = setup()
		cloud.prepareHandoffRepository.mockRejectedValue(error)
		await coordinator.prepare(input)
		expect(coordinator.viewFor(input.sourceTaskId)).toMatchObject({ phase: "failed", message, recovery })
		expect(cloud.create).not.toHaveBeenCalled()
	})

	it("keeps GitHub recovery and the ambiguity warning when publication fails", async () => {
		const { coordinator, cloud, id } = setup()
		cloud.create.mockRejectedValue(
			new Error(new CloudSessionError("github_not_connected", "Grant repository access.").message),
		)
		await coordinator.prepare(input)
		await coordinator.confirm(id())
		expect(coordinator.viewFor(input.sourceTaskId)).toMatchObject({
			phase: "failed",
			recovery: "connect_github",
			message:
				"Grant repository access. The snapshot may have been published or a cloud task created. Check Cline Cloud before starting another handoff.",
		})
		expect(cloud.create).toHaveBeenCalledTimes(1)
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
		"recovered",
		"error",
		"draining",
	])("retries only the unsent continuation in the existing task (%s)", async (outcome) => {
		const { coordinator, cloud, id } = setup()
		cloud.create.mockResolvedValue({
			sessionId: "ses_example",
			status: "idle",
			initialSend: { dispatched: false, message: "unavailable" },
		})
		await coordinator.prepare(input)
		await coordinator.confirm(id())
		if (outcome === "error") cloud.send.mockRejectedValueOnce(new Error("connection closed"))
		else if (outcome === "draining")
			cloud.send.mockRejectedValueOnce(
				Object.assign(new Error("Hub is restarting"), { name: "HubCommandError", code: "hub_draining" }),
			)
		else if (outcome === "recovered")
			cloud.send.mockResolvedValueOnce({ sessionId: "ses_example", ok: true, recoveredAfterDisconnect: true })
		const retry = Promise.all([coordinator.retryMessage(id()), coordinator.retryMessage(id())])
		if (outcome === "draining") await expect(retry).rejects.toThrow("Hub is restarting")
		else await retry
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
			delivery: outcome === "sent" ? "sent" : outcome === "draining" ? "unsent" : "unconfirmed",
		})
		await coordinator.retryMessage(id())
		expect(cloud.send).toHaveBeenCalledTimes(outcome === "draining" ? 2 : 1)
		if (outcome === "draining") {
			expect(cloud.send.mock.calls[1]).toEqual(cloud.send.mock.calls[0])
			expect(coordinator.viewFor(input.sourceTaskId)).toMatchObject({ delivery: "sent" })
		}
		expect(cloud.create).toHaveBeenCalledTimes(1)
	})

	it("keeps an unsent continuation through discard until it can be retried", async () => {
		const { coordinator, cloud, id } = setup()
		cloud.create.mockResolvedValue({
			sessionId: "ses_example",
			status: "idle",
			initialSend: { dispatched: false, message: "unavailable" },
		})
		await coordinator.prepare(input)
		await coordinator.confirm(id())
		const handoffId = id()
		await coordinator.discard(handoffId)
		expect(coordinator.viewFor(input.sourceTaskId)).toMatchObject({ id: handoffId, delivery: "unsent" })
		await coordinator.retryMessage(handoffId)
		expect(cloud.send).toHaveBeenCalledWith(
			"ses_example",
			expect.stringContaining("Widget implemented; tests remain."),
			"queue",
			"test-model",
			[image],
		)
		expect(cloud.create).toHaveBeenCalledTimes(1)
		await coordinator.discard(handoffId)
		expect(coordinator.viewFor(input.sourceTaskId)).toBeUndefined()
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
		expect(cloud.send).not.toHaveBeenCalled()
		expect(coordinator.viewFor(input.sourceTaskId)).toMatchObject({ phase: "complete", delivery: "unsent" })
		await coordinator.retryMessage(id())
		expect(cloud.send).toHaveBeenCalledTimes(1)
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
		expect(cloud.send).not.toHaveBeenCalled()
	})
})
