import { UpdateSettingsRequest } from "@shared/proto/cline/state"
import * as assert from "assert"
import * as sinon from "sinon"
import { Controller } from ".."
import { updateSettings } from "./updateSettings"

// Mock telemetryService
const telemetryServiceMock = {
	captureSubagentToggle: sinon.stub(),
}

describe("updateSettings platform validation", () => {
	let mockController: Controller
	let originalPlatform: NodeJS.Platform

	beforeEach(() => {
		// Store original platform
		originalPlatform = process.platform

		// Create mock controller
		mockController = {
			stateManager: {
				getGlobalSettingsKey: sinon.stub(),
				setGlobalState: sinon.stub(),
				setApiConfiguration: sinon.stub(),
			},
			postStateToWebview: sinon.stub().resolves({}),
			task: undefined,
			updateTelemetrySetting: sinon.stub(),
		} as unknown as Controller

		// Clear telemetry service mock
		telemetryServiceMock.captureSubagentToggle.reset()
	})

	afterEach(() => {
		// Restore original platform
		Object.defineProperty(process, "platform", {
			value: originalPlatform,
			writable: true,
			configurable: true,
		})
		sinon.restore()
	})

	it("should allow enabling subagents on macOS (darwin)", async () => {
		// Set platform to macOS
		Object.defineProperty(process, "platform", { value: "darwin" })

		;(mockController.stateManager.getGlobalSettingsKey as sinon.SinonStub).returns(false)

		const request = UpdateSettingsRequest.create({
			subagentsEnabled: true,
		})

		// Should not throw
		await updateSettings(mockController, request)

		assert.ok(
			(mockController.stateManager.setGlobalState as sinon.SinonStub).calledWith("subagentsEnabled", true),
			"Should enable subagents on macOS",
		)
	})

	it("should allow enabling subagents on Linux", async () => {
		// Set platform to Linux
		Object.defineProperty(process, "platform", { value: "linux" })

		;(mockController.stateManager.getGlobalSettingsKey as sinon.SinonStub).returns(false)

		const request = UpdateSettingsRequest.create({
			subagentsEnabled: true,
		})

		// Should not throw
		await updateSettings(mockController, request)

		assert.ok(
			(mockController.stateManager.setGlobalState as sinon.SinonStub).calledWith("subagentsEnabled", true),
			"Should enable subagents on Linux",
		)
	})

	it("should throw error when trying to enable subagents on Windows", async () => {
		// Set platform to Windows
		Object.defineProperty(process, "platform", { value: "win32" })

		;(mockController.stateManager.getGlobalSettingsKey as sinon.SinonStub).returns(false)

		const request = UpdateSettingsRequest.create({
			subagentsEnabled: true,
		})

		try {
			await updateSettings(mockController, request)
			assert.fail("Should have thrown an error")
		} catch (error) {
			assert.strictEqual(
				(error as Error).message,
				"CLI subagents are only supported on macOS and Linux platforms",
				"Should throw platform restriction error",
			)
		}

		assert.ok(
			!(mockController.stateManager.setGlobalState as sinon.SinonStub).called,
			"Should not call setGlobalState when platform validation fails",
		)
	})

	it("should allow disabling subagents on any platform", async () => {
		// Test on Windows
		Object.defineProperty(process, "platform", { value: "win32" })

		;(mockController.stateManager.getGlobalSettingsKey as sinon.SinonStub).returns(true)

		const request = UpdateSettingsRequest.create({
			subagentsEnabled: false,
		})

		// Should not throw
		await updateSettings(mockController, request)

		assert.ok(
			(mockController.stateManager.setGlobalState as sinon.SinonStub).calledWith("subagentsEnabled", false),
			"Should allow disabling subagents on any platform",
		)
	})

	it("should allow keeping subagents disabled on non-macOS platforms", async () => {
		// Test on Windows with subagents already disabled
		Object.defineProperty(process, "platform", { value: "win32" })

		;(mockController.stateManager.getGlobalSettingsKey as sinon.SinonStub).returns(false)

		const request = UpdateSettingsRequest.create({
			subagentsEnabled: false,
		})

		// Should not throw
		await updateSettings(mockController, request)

		assert.ok(
			(mockController.stateManager.setGlobalState as sinon.SinonStub).calledWith("subagentsEnabled", false),
			"Should allow keeping subagents disabled on non-macOS platforms",
		)
	})

	it("should not perform platform validation when subagentsEnabled is undefined", async () => {
		// Test on Windows but don't try to change subagents setting
		Object.defineProperty(process, "platform", { value: "win32" })

		const request = UpdateSettingsRequest.create({
			strictPlanModeEnabled: true, // Some other setting
		})

		// Should not throw error since subagentsEnabled is not being changed
		await updateSettings(mockController, request)

		assert.ok(
			(mockController.postStateToWebview as sinon.SinonStub).called,
			"Should complete successfully when subagentsEnabled is not being changed",
		)
	})
})
