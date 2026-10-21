import { strict as assert } from "node:assert"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import { StateManager } from "@/core/storage/StateManager"
import { readGlobalStateFromStorage } from "@/core/storage/utils/state-helpers"
import { createStorageContext } from "@/shared/storage/storage-context"
import { Task } from "@/core/task"
import { MessageStateHandler } from "@/core/task/message-state"
import { TaskState } from "@/core/task/TaskState"
import { getSavedClineMessages, saveClineMessages } from "@/core/storage/disk"
import { updateSettings } from "@/core/controller/state/updateSettings"
import { updateSettingsCli } from "@/core/controller/state/updateSettingsCli"
import { HostProvider } from "@/hosts/host-provider"
import type { ClineMessage } from "@/shared/ExtensionMessage"
import { ClineMessage as ProtoMessage } from "@/shared/proto/cline/ui"
import { Settings, UpdateSettingsRequest, UpdateSettingsRequestCli } from "@/shared/proto/cline/state"
import { convertClineMessageToProto, convertProtoToClineMessage } from "@/shared/proto-conversions/cline-message"
import { isProseResponse, responseCompletion } from "@/shared/response-timing"

describe("Chat usability lifecycle and persistence", () => {
	let directory: string
	let handler: MessageStateHandler
	let task: any
	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "cline-chat-usability-"))
		sinon.stub(HostProvider, "get").returns({ globalStorageFsPath: directory } as any)
		handler = new MessageStateHandler({
			taskId: "synthetic",
			ulid: "synthetic",
			taskState: new TaskState(),
			updateTaskHistory: async () => [],
		})
		handler.setClineMessages([{ ts: 100, type: "say", say: "task", text: "Synthetic task" }])
		task = Object.create(Task.prototype)
		task.messageStateHandler = handler
		task.taskState = new TaskState()
		task.postStateToWebview = async () => {}
		task.stateManager = { getGlobalSettingsKey: () => false, getApiConfiguration: () => ({}) }
		task.api = { getModel: () => ({ id: "synthetic" }) }
		task.getCurrentProviderInfo = () => ({ providerId: "anthropic", model: { id: "synthetic" }, mode: "act" })
	})
	afterEach(async () => {
		sinon.restore()
		await rm(directory, { recursive: true, force: true })
	})

	it("records streamed completion once without changing start identity or copied text", async () => {
		await task.say("text", "partial", undefined, undefined, true)
		const message = handler.getClineMessages().at(-1)!
		const start = message.ts
		assert.equal(message.completedAt, undefined)
		await task.say("text", "complete", undefined, undefined, false)
		assert.equal(message.ts, start)
		assert.equal(message.text, "complete")
		assert.ok(message.completedAt! >= start)
		assert.equal(responseCompletion(message, message.completedAt! + 100).completedAt, message.completedAt)
		await handler.updateClineMessage(1, { text: "still complete" })
		assert.equal(handler.getClineMessages()[1].completedAt, message.completedAt)
	})

	it("records non-streamed responses at their creation time", async () => {
		await task.say("completion_result", "Synthetic answer")
		const message = handler.getClineMessages().at(-1)!
		assert.equal(message.completedAt, message.ts)
	})

	it("finishes follow-up text before waiting for the user's answer", async () => {
		await assert.rejects(task.ask("followup", "Question", true), /ignored/)
		const pending = task.ask("followup", "Question?", false)
		setTimeout(() => task.handleWebviewAskResponse("yesButtonClicked"), 20)
		await pending
		assert.ok(handler.getClineMessages().at(-1)!.completedAt)
	})

	it("native tool-call text finalization publishes and persists its timing", async () => {
		await task.say("text", "Before tool", undefined, undefined, true)
		await task.processNativeToolCalls("Before tool", [
			{ type: "tool_use", name: "read_file", input: { path: "synthetic.txt" }, partial: true },
		])
		const message = handler.getClineMessages().at(-1)!
		assert.equal(message.partial, false)
		assert.ok(message.completedAt)
		assert.equal((await getSavedClineMessages("synthetic")).at(-1)!.completedAt, message.completedAt)
	})

	it("interruption never receives successful completion during later cleanup", async () => {
		await task.say("text", "Interrupted", undefined, undefined, true)
		task.shouldRunTaskCancelHook = async () => false
		task.getActiveHookExecution = async () => undefined
		task.commandExecutor = { hasActiveBackgroundCommand: () => false }
		task.terminalManager = { disposeAll() {} }
		task.urlContentFetcher = { closeBrowser() {} }
		task.browserSession = { async dispose() {} }
		task.clineIgnoreController = { dispose() {} }
		task.fileContextTracker = { dispose() {} }
		task.diffViewProvider = { async revertChanges() {} }
		task.mcpHub = { clearNotificationCallback() {} }
		task.presentationScheduler = { async dispose() {} }
		await task.abortTask()
		// Stream cleanup may clear partial later; it must not turn interruption into success.
		await handler.updateClineMessage(1, { partial: false })
		const message = handler.getClineMessages()[1]
		assert.equal(message.completedAt, undefined)
		assert.ok(message.interruptedAt! >= message.ts)
		assert.deepEqual(responseCompletion(message, message.interruptedAt! + 100), {})
		assert.equal((await getSavedClineMessages("synthetic"))[1].interruptedAt, message.interruptedAt)
	})

	it("disk and binary protobuf round-trip optional timing, including legacy absence", async () => {
		const legacy: ClineMessage = { ts: 1000, type: "say", say: "text", text: "Legacy" }
		for (const message of [legacy, { ...legacy, completedAt: 1200 }, { ...legacy, interruptedAt: 1100 }]) {
			await saveClineMessages("synthetic", [message])
			const stored = (await getSavedClineMessages("synthetic"))[0]
			const proto = ProtoMessage.decode(ProtoMessage.encode(convertClineMessageToProto(stored)).finish())
			const restored = convertProtoToClineMessage(proto)
			assert.equal(restored.ts, message.ts)
			assert.equal(restored.completedAt, message.completedAt)
			assert.equal(restored.interruptedAt, message.interruptedAt)
		}
	})

	it("does not stamp tools, request metrics, hidden reasoning or history reloads", async () => {
		for (const say of ["reasoning", "tool", "api_req_started"] as const) {
			const message: ClineMessage = { ts: 1000, type: "say", say, text: "synthetic" }
			assert.equal(isProseResponse(message), false)
			assert.deepEqual(responseCompletion(message, 2000), {})
		}
		handler.setClineMessages([{ ts: 1000, type: "say", say: "text", text: "Legacy" }])
		assert.equal(handler.getClineMessages()[0].completedAt, undefined)
	})

	it("StateManager persists false and reloads it from file-backed storage", async () => {
		// Isolate caches without starting the application's singleton, telemetry or file watcher.
		const loadManager = async () => {
			const storage = createStorageContext({ clineDir: directory, workspacePath: directory })
			const manager = new (StateManager as any)(storage)
			manager.populateCache(await readGlobalStateFromStorage(storage.globalState), {}, {})
			manager.isInitialized = true
			return manager
		}
		const manager = await loadManager()
		try {
			assert.equal(manager.getGlobalSettingsKey("showUserMessageTimestamps"), true)
			manager.setGlobalState("showUserMessageTimestamps", false)
			await manager.flushPendingState()
			const reloaded = await loadManager()
			try {
				assert.equal(reloaded.getGlobalSettingsKey("showUserMessageTimestamps"), false)
			} finally {
				reloaded.dispose()
			}
		} finally {
			manager.dispose()
		}
	})

	it("both settings paths retain false through protobuf and do not recreate a provider", async () => {
		let stored: boolean | undefined
		const controller: any = {
			stateManager: {
				setGlobalState: (key: string, value: boolean) => {
					assert.equal(key, "showUserMessageTimestamps")
					stored = value
				},
				setGlobalStateBatch: (values: any) => {
					assert.deepEqual(Object.keys(values), ["showUserMessageTimestamps"])
					stored = values.showUserMessageTimestamps
				},
				getGlobalSettingsKey: () => undefined,
			},
			postStateToWebview: async () => {},
			task: { api: "original provider" },
		}
		for (const value of [true, false]) {
			const request = UpdateSettingsRequest.decode(
				UpdateSettingsRequest.encode(UpdateSettingsRequest.create({ showUserMessageTimestamps: value })).finish(),
			)
			await updateSettings(controller, request)
			assert.equal(stored, value)
			const settings = Settings.decode(Settings.encode(Settings.create({ showUserMessageTimestamps: value })).finish())
			await updateSettingsCli(controller, UpdateSettingsRequestCli.create({ settings }))
			assert.equal(stored, value)
			assert.equal(controller.task.api, "original provider")
		}
	})
})
