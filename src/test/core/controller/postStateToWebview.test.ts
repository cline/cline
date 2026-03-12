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

	before(async () => {
		if (!ClineEndpoint.isInitialized()) {
			await ClineEndpoint.initialize("/test/extension")
		}
	})

	beforeEach(async () => {
		if (!HostProvider.isInitialized()) {
			const mockHostBridge: any = {
				workspaceClient: {},
				envClient: {
					getHostVersion: sinon.stub().resolves({
						clineVersion: "1.0.0",
						platform: "darwin",
						clineType: "vscode",
					}),
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
})
