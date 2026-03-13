import { afterEach, before, beforeEach, describe, it } from "mocha"
import "should"
import { Controller } from "@core/controller"
import * as sinon from "sinon"
import { ClineEndpoint } from "@/config"
import { HostProvider } from "@/hosts/host-provider"

describe("Controller postStateToWebview", () => {
	let controller: Controller
	let stateManagerStub: sinon.SinonStub
	let mockStateManager: any
	let hostProviderInitialized = false
	let mockGetHostVersion: sinon.SinonStub

	before(async () => {
		if (!ClineEndpoint.isInitialized()) {
			await ClineEndpoint.initialize("/test/extension")
		}
	})

	beforeEach(async () => {
		if (!HostProvider.isInitialized()) {
			mockGetHostVersion = sinon.stub().resolves({
				clineVersion: "1.0.0",
				platform: "darwin",
				clineType: "vscode",
			})
			const mockHostBridge: any = {
				workspaceClient: {},
				envClient: {
					getHostVersion: mockGetHostVersion,
				},
				windowClient: {},
				diffClient: {},
			}

			HostProvider.initialize(
				() => null as any,
				() => null as any,
				() => null as any,
				() => null as any,
				mockHostBridge,
				() => {},
				async (path: string) => `http://localhost${path}`,
				async () => "",
				"/test/extension",
				"/test/storage",
			)
			hostProviderInitialized = true
		}

		await require("@/registry").HostRegistryInfo.init()

		mockStateManager = {
			getRemoteConfigSettings: sinon.stub().returns({}),
			getApiConfiguration: sinon.stub().returns({}),
			getGlobalStateKey: sinon.stub().returns(undefined),
			getGlobalSettingsKey: sinon.stub().returns(undefined),
			getWorkspaceStateKey: sinon.stub().returns(undefined),
			setGlobalState: sinon.stub(),
			setApiConfiguration: sinon.stub(),
			registerCallbacks: sinon.stub(),
		}

		const StateManager = require("@core/storage/StateManager").StateManager
		stateManagerStub = sinon.stub(StateManager, "get").returns(mockStateManager)

		controller = new Controller({
			globalState: { get: sinon.stub(), update: sinon.stub().resolves() },
			workspaceState: { get: sinon.stub(), update: sinon.stub().resolves() },
			secrets: { get: sinon.stub().resolves(), store: sinon.stub().resolves(), delete: sinon.stub().resolves() },
			subscriptions: [],
			extensionPath: "/test/path",
			globalStoragePath: "/test/storage",
			globalStorageUri: { fsPath: "/test/storage" },
		} as any)
	})

	afterEach(() => {
		stateManagerStub.restore()
		if (hostProviderInitialized) {
			HostProvider.reset()
			hostProviderInitialized = false
		}
	})

	it("flushes immediately when there is no active task", async () => {
		const flushNow = sinon.stub().resolves()
		const requestFlush = sinon.stub()
		;(controller as any).stateUpdateScheduler = {
			flushNow,
			requestFlush,
			dispose: sinon.stub().resolves(),
		}

		await controller.postStateToWebview()

		sinon.assert.calledOnce(flushNow)
		sinon.assert.notCalled(requestFlush)
	})

	it("coalesces through the scheduler when the active task is streaming", async () => {
		const flushNow = sinon.stub().resolves()
		const requestFlush = sinon.stub()
		;(controller as any).stateUpdateScheduler = {
			flushNow,
			requestFlush,
			dispose: sinon.stub().resolves(),
		}
		;(controller as any).task = {
			taskState: {
				isStreaming: true,
			},
		}

		await controller.postStateToWebview()

		sinon.assert.calledOnceWithExactly(requestFlush, "normal")
		sinon.assert.notCalled(flushNow)
	})

	it("honors explicit immediate priority even while streaming", async () => {
		const flushNow = sinon.stub().resolves()
		const requestFlush = sinon.stub()
		;(controller as any).stateUpdateScheduler = {
			flushNow,
			requestFlush,
			dispose: sinon.stub().resolves(),
		}
		;(controller as any).task = {
			taskState: {
				isStreaming: true,
			},
		}

		await controller.postStateToWebview({ priority: "immediate" })

		sinon.assert.calledOnce(flushNow)
		sinon.assert.notCalled(requestFlush)
	})

	it("treats non-streaming active tasks as immediate by default", async () => {
		const flushNow = sinon.stub().resolves()
		const requestFlush = sinon.stub()
		;(controller as any).stateUpdateScheduler = {
			flushNow,
			requestFlush,
			dispose: sinon.stub().resolves(),
		}
		;(controller as any).task = {
			taskState: {
				isStreaming: false,
			},
		}

		await controller.postStateToWebview()

		sinon.assert.calledOnce(flushNow)
		sinon.assert.notCalled(requestFlush)
	})

	it("records state update metrics when a flush occurs", async () => {
		const noteStateUpdateMetrics = sinon.stub()
		;(controller as any).task = { noteStateUpdateMetrics }
		const getStateToPostToWebview = sinon.stub(controller, "getStateToPostToWebview").resolves({ foo: "bar" } as any)
		const stateModule = require("@core/controller/state/subscribeToState")
		const sendStateUpdateStub = sinon.stub(stateModule, "sendStateUpdate").resolves({
			payloadBytes: 123,
			sendDurationMs: 7,
			subscriberCount: 1,
		})

		try {
			await (controller as any).flushStateToWebview()

			sinon.assert.calledOnce(getStateToPostToWebview)
			sinon.assert.calledOnce(sendStateUpdateStub)
			sinon.assert.calledOnce(noteStateUpdateMetrics)
			const metrics = noteStateUpdateMetrics.firstCall.args[0]
			metrics.serializedBytes.should.equal(123)
			metrics.sendDurationMs.should.equal(7)
			metrics.buildDurationMs.should.be.greaterThanOrEqual(0)
		} finally {
			getStateToPostToWebview.restore()
			sendStateUpdateStub.restore()
		}
	})

	it("posts background command state updates at normal priority", async () => {
		const postStateToWebview = sinon.stub(controller, "postStateToWebview").resolves()

		controller.updateBackgroundCommandState(true, "task-123")
		await Promise.resolve()

		sinon.assert.calledOnceWithExactly(postStateToWebview, { priority: "normal" })
	})

	it("keeps mode switches on the immediate path", async () => {
		const postStateToWebview = sinon.stub(controller, "postStateToWebview").resolves()

		const didSwitch = await controller.togglePlanActMode("plan")

		didSwitch.should.equal(false)
		sinon.assert.calledOnceWithExactly(postStateToWebview, { priority: "immediate" })
		sinon.assert.calledWith(mockStateManager.setGlobalState, "mode", "plan")
	})

	it("keeps auth callback state hydration on the immediate path", async () => {
		mockStateManager.getGlobalSettingsKey.callsFake((key: string) => {
			switch (key) {
				case "planActSeparateModelsSetting":
					return false
				case "mode":
					return "act"
				default:
					return undefined
			}
		})
		mockStateManager.getApiConfiguration.returns({
			planModeApiProvider: "openrouter",
			actModeApiProvider: "openrouter",
		})

		const handleAuthCallback = sinon.stub(controller.authService, "handleAuthCallback").resolves()
		const postStateToWebview = sinon.stub(controller, "postStateToWebview").resolves()
		const fetchRemoteConfigModule = require("@core/storage/remote-config/fetch")
		const fetchRemoteConfigStub = sinon.stub(fetchRemoteConfigModule, "fetchRemoteConfig").resolves()

		try {
			await controller.handleAuthCallback("token-123", "google")

			sinon.assert.calledOnce(handleAuthCallback)
			sinon.assert.calledWith(mockStateManager.setGlobalState, "welcomeViewCompleted", true)
			sinon.assert.calledOnceWithExactly(postStateToWebview, { priority: "immediate" })
		} finally {
			fetchRemoteConfigStub.restore()
		}
	})

	it("reinitializes an existing task from history when switching tasks", async () => {
		const historyItem = { id: "task-2", task: "Continue task", ts: Date.now() } as any
		const getTaskWithId = sinon.stub(controller, "getTaskWithId").resolves({ historyItem } as any)
		const initTask = sinon.stub(controller, "initTask").resolves("task-2")

		await controller.reinitExistingTaskFromId("task-2")

		sinon.assert.calledOnceWithExactly(getTaskWithId, "task-2")
		sinon.assert.calledOnceWithExactly(initTask, undefined, undefined, undefined, historyItem)
	})

	it("updates task history state and notifies the UI when deleting a task", async () => {
		const existingHistory = [
			{ id: "task-1", task: "Keep me", ts: 1 },
			{ id: "task-2", task: "Remove me", ts: 2 },
		]
		mockStateManager.getGlobalStateKey.callsFake((key: string) => {
			if (key === "taskHistory") {
				return existingHistory
			}
			return undefined
		})
		const postStateToWebview = sinon.stub(controller, "postStateToWebview").resolves()

		const updatedHistory = await controller.deleteTaskFromState("task-2")

		updatedHistory.should.deepEqual([{ id: "task-1", task: "Keep me", ts: 1 }])
		sinon.assert.calledWith(mockStateManager.setGlobalState, "taskHistory", updatedHistory)
		sinon.assert.calledOnce(postStateToWebview)
	})

	it("detects remote workspace host metadata during controller initialization", async () => {
		HostProvider.reset()
		hostProviderInitialized = false

		mockGetHostVersion = sinon.stub().resolves({
			clineVersion: "1.0.0",
			platform: "darwin",
			clineType: "vscode",
			remoteName: "ssh-remote",
		})

		HostProvider.initialize(
			() => null as any,
			() => null as any,
			() => null as any,
			() => null as any,
			{
				workspaceClient: {},
				envClient: {
					getHostVersion: mockGetHostVersion,
				},
				windowClient: {},
				diffClient: {},
			} as any,
			() => {},
			async (path: string) => `http://localhost${path}`,
			async () => "",
			"/test/extension",
			"/test/storage",
		)
		hostProviderInitialized = true

		controller = new Controller({
			globalState: { get: sinon.stub(), update: sinon.stub().resolves() },
			workspaceState: { get: sinon.stub(), update: sinon.stub().resolves() },
			secrets: { get: sinon.stub().resolves(), store: sinon.stub().resolves(), delete: sinon.stub().resolves() },
			subscriptions: [],
			extensionPath: "/test/path",
			globalStoragePath: "/test/storage",
			globalStorageUri: { fsPath: "/test/storage" },
		} as any)

		await Promise.resolve()
		await Promise.resolve()

		sinon.assert.called(mockGetHostVersion)
		;(controller as any).isRemoteWorkspaceEnvironment.should.equal(true)
	})
})
