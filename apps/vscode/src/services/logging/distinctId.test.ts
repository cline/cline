import { afterEach, beforeEach, describe, it, mock } from "bun:test"
import { expect } from "chai"
import * as actualNodeMachineId from "node-machine-id"
import * as sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"

// bun loads real ESM, so sinon cannot stub the `node-machine-id` namespace
// export ("ES Modules cannot be stubbed"). Inject a module-level sinon stub for
// `machineId` via mock.module so the full sinon stub API keeps working.
const machineIdStub: sinon.SinonStub = sinon.stub()
mock.module("node-machine-id", () => ({ ...actualNodeMachineId, machineId: machineIdStub }))

import { _GENERATED_MACHINE_ID_KEY, getDistinctId, initializeDistinctId, setDistinctId } from "@/services/logging/distinctId"
import { StorageContext } from "@/shared/storage"

describe("distinctId", () => {
	let sandbox: sinon.SinonSandbox
	let mockStorage: StorageContext
	let mockGlobalState: any
	let hostProviderInitialized = false

	const MOCK_GLOBAL_STATE_ID = "existing-distinct-id-123"
	const MOCK_MACHINE_ID = "machine-id-456"
	const MOCK_UUID = "mock-uuid-12345678-1234-1234-1234-123456789012"
	const GENERATED_MACHINE_ID = "cl-" + MOCK_UUID

	const mockUuidGenerator = () => MOCK_UUID

	beforeEach(() => {
		sandbox = sinon.createSandbox()

		// Initialize HostProvider if not already done
		if (!HostProvider.isInitialized()) {
			const mockHostBridge: any = {
				workspaceClient: {},
				envClient: {
					getHostVersion: sandbox.stub().resolves({
						clineVersion: "1.0.0",
						platform: "darwin",
						clineType: "vscode",
					}),
				},
				windowClient: {},
				diffClient: {},
			}

			HostProvider.initialize(
				() => null as any, // createWebviewProvider
				() => null as any, // createDiffViewProvider
				() => null as any, // createCommentReviewController
				() => null as any, // createTerminalManager
				mockHostBridge,
				() => {}, // logToChannel
				async () => "http://localhost", // getCallbackUrl
				async () => "", // getBinaryLocation
				"/test/extension", // extensionFsPath
				"/test/storage", // globalStorageFsPath
			)
			hostProviderInitialized = true
		}

		// Mock global state
		mockGlobalState = { get: sandbox.stub(), update: sandbox.stub() }

		// Mock extension storage
		mockStorage = { globalState: mockGlobalState } as unknown as StorageContext

		// Reset the module-level node-machine-id stub
		machineIdStub.reset()

		// Reset the distinctId module state
		setDistinctId("")
	})

	afterEach(() => {
		sandbox.restore()

		// Reset HostProvider if we initialized it
		if (hostProviderInitialized) {
			HostProvider.reset()
			hostProviderInitialized = false
		}
	})

	it("should use id from extension globalstate if it exists", async () => {
		mockGlobalState.get.withArgs(_GENERATED_MACHINE_ID_KEY).returns(MOCK_GLOBAL_STATE_ID)
		// machineIdStub is the module-level stub (left unconfigured -> resolves undefined)

		await initializeDistinctId(mockStorage, mockUuidGenerator)

		expect(getDistinctId()).to.equal(MOCK_GLOBAL_STATE_ID)
		expect(machineIdStub.notCalled).to.be.true
		expect(mockGlobalState.update.notCalled).to.be.true
	})

	it("should use the machine ID from node-machine-id", async () => {
		// Mock node-machine-id to return a machine ID
		machineIdStub.resolves(MOCK_MACHINE_ID)

		await initializeDistinctId(mockStorage, mockUuidGenerator)

		expect(getDistinctId()).to.equal(MOCK_MACHINE_ID)
		expect(machineIdStub.calledOnce).to.be.true
		expect(mockGlobalState.update.notCalled).to.be.true
	})

	it("distinct ID should be stable", async () => {
		mockGlobalState.get.withArgs(_GENERATED_MACHINE_ID_KEY).returns(undefined)
		// Mock node-machine-id to return a machine ID
		machineIdStub.resolves(MOCK_MACHINE_ID)

		await initializeDistinctId(mockStorage, mockUuidGenerator)
		expect(getDistinctId()).to.equal(MOCK_MACHINE_ID)

		await initializeDistinctId(mockStorage, mockUuidGenerator)
		expect(getDistinctId()).to.equal(MOCK_MACHINE_ID)

		expect(mockGlobalState.update.notCalled).to.be.true
	})

	it("should generate and store UUID if node-machine-id returns empty string", async () => {
		mockGlobalState.get.withArgs(_GENERATED_MACHINE_ID_KEY).returns(undefined)
		// Mock node-machine-id to return empty string
		machineIdStub.resolves("")

		await initializeDistinctId(mockStorage, mockUuidGenerator)

		expect(getDistinctId()).to.equal(GENERATED_MACHINE_ID)
		expect(machineIdStub.calledOnce).to.be.true
		expect(mockGlobalState.update.calledWith(_GENERATED_MACHINE_ID_KEY, GENERATED_MACHINE_ID)).to.be.true
	})

	it("should handle node-machine-id errors gracefully", async () => {
		mockGlobalState.get.withArgs(_GENERATED_MACHINE_ID_KEY).returns(undefined)
		// Mock node-machine-id to throw an error
		machineIdStub.rejects(new Error("Failed to get machine ID"))

		await initializeDistinctId(mockStorage, mockUuidGenerator)

		expect(getDistinctId()).to.equal(GENERATED_MACHINE_ID)
		expect(machineIdStub.calledOnce).to.be.true
		expect(mockGlobalState.update.calledWith(_GENERATED_MACHINE_ID_KEY, GENERATED_MACHINE_ID)).to.be.true
	})
})
