import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { getDistinctId, initializeDistinctId, setDistinctId } from "@/services/logging/distinctId"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"

describe("distinctId", () => {
	let sandbox: sinon.SinonSandbox
	let mockContext: vscode.ExtensionContext
	let mockGlobalState: any

	const MOCK_GLOBAL_STATE_ID = "existing-distinct-id-123"
	const MOCK_UUID = "mock-uuid-12345678-1234-1234-1234-123456789012"
	const MOCK_MACHINE_ID = "machine-id-456"

	const mockUuidGenerator = () => MOCK_UUID

	beforeEach(() => {
		sandbox = sinon.createSandbox()

		// Mock global state
		mockGlobalState = {
			get: sandbox.stub(),
			update: sandbox.stub(),
			keys: sandbox.stub().returns([]),
			setKeysForSync: sandbox.stub(),
		}

		// Mock extension context
		mockContext = {
			globalState: mockGlobalState,
			workspaceState: {} as any,
			secrets: {} as any,
			extensionUri: {} as any,
			extensionPath: "",
			asAbsolutePath: sandbox.stub(),
			storagePath: "",
			globalStoragePath: "",
			logPath: "",
			extensionMode: vscode.ExtensionMode.Development,
			subscriptions: [],
			environmentVariableCollection: {} as any,
			storageUri: {} as any,
			globalStorageUri: {} as any,
			logUri: {} as any,
			extension: {} as any,
		}

		// Mock vscode workspace
		setVscodeHostProviderMock()

		// Reset the distinctId module state
		setDistinctId("")
	})

	afterEach(() => {
		sandbox.restore()
		// Reset HostProvider after each test to ensure clean state
		HostProvider.reset()
	})

	it("should use id from extension globalstate if it exists", async () => {
		mockGlobalState.get.withArgs("cline.distinctId").returns(MOCK_GLOBAL_STATE_ID)
		const getMachineIdStub = sandbox.stub(HostProvider.env, "getMachineId").resolves({ value: MOCK_MACHINE_ID })

		await initializeDistinctId(mockContext, mockUuidGenerator)

		expect(getDistinctId()).to.equal(MOCK_GLOBAL_STATE_ID)
		expect(getMachineIdStub.calledOnce).to.be.true
	})

	it("should use the host machine ID", async () => {
		mockGlobalState.get.withArgs("cline.distinctId").returns(undefined)

		// Mock getMachineId to return a machine ID
		const getMachineIdStub = sandbox.stub(HostProvider.env, "getMachineId").resolves({ value: MOCK_MACHINE_ID })

		await initializeDistinctId(mockContext, mockUuidGenerator)

		expect(getDistinctId()).to.equal(MOCK_MACHINE_ID)
		expect(getMachineIdStub.calledOnce).to.be.true
	})

	it("distinct ID should be stable", async () => {
		mockGlobalState.get.withArgs("cline.distinctId").returns(undefined)

		// Mock getMachineId to return a machine ID
		sandbox.stub(HostProvider.env, "getMachineId").resolves({ value: MOCK_MACHINE_ID })

		await initializeDistinctId(mockContext, mockUuidGenerator)
		expect(getDistinctId()).to.equal(MOCK_MACHINE_ID)

		await initializeDistinctId(mockContext, mockUuidGenerator)
		expect(getDistinctId()).to.equal(MOCK_MACHINE_ID)
	})

	it("should generate a UUID if there is no host ID", async () => {
		mockGlobalState.get.withArgs("cline.distinctId").returns(undefined)

		// Mock getMachineId to return undefined
		const getMachineIdStub = sandbox.stub(HostProvider.env, "getMachineId").resolves({ value: "" })

		await initializeDistinctId(mockContext, mockUuidGenerator)

		const distinctId = getDistinctId()
		expect(distinctId).to.equal(MOCK_UUID)
		expect(getMachineIdStub.calledOnce).to.be.true
	})

	it("should handle getMachineId errors gracefully", async () => {
		mockGlobalState.get.withArgs("cline.distinctId").returns(undefined)

		// Mock getMachineId to throw an error
		const getMachineIdStub = sandbox.stub(HostProvider.env, "getMachineId").rejects(new Error("Network error"))

		await initializeDistinctId(mockContext, mockUuidGenerator)

		const distinctId = getDistinctId()
		expect(distinctId).to.equal(MOCK_UUID)
		expect(getMachineIdStub.calledOnce).to.be.true
	})
})
