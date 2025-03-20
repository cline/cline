import * as assert from "assert"
import * as sinon from "sinon"
import * as vscode from "vscode"
import {
	BrowserSettings,
	BROWSER_VIEWPORT_PRESETS,
	DEFAULT_BROWSER_SETTINGS,
	getConfiguredBrowserSettings,
	isValidPreset,
} from "../../shared/BrowserSettings"
import { Logger } from "../../services/logging/Logger"

// Get access to the DEFAULT_VIEWPORT constant for testing
// Since it's not exported, we'll define it here with the same values
const DEFAULT_VIEWPORT = { width: 900, height: 600 }

// Using mocha's describe/it pattern
const { describe, it, beforeEach, afterEach } = require("mocha")
const chai = require("chai")
const expect = chai.expect

describe("BrowserSettings Tests", () => {
	let getConfigurationStub: sinon.SinonStub
	let loggerStub: sinon.SinonStub
	let mockConfig: {
		get: sinon.SinonStub
	}

	beforeEach(() => {
		// Stub vscode.workspace.getConfiguration
		getConfigurationStub = sinon.stub(vscode.workspace, "getConfiguration")

		// Create a mock configuration object with a stubbed get method
		mockConfig = {
			get: sinon.stub(),
		}

		// Make getConfiguration return our mock
		getConfigurationStub.returns(mockConfig)

		// Stub Logger.log to prevent actual logging during tests
		loggerStub = sinon.stub(Logger, "log")
	})

	afterEach(() => {
		// Restore all stubs
		sinon.restore()
	})

	it("DEFAULT_BROWSER_SETTINGS should have expected structure", () => {
		expect(DEFAULT_BROWSER_SETTINGS).to.exist
		expect(DEFAULT_BROWSER_SETTINGS.viewport).to.exist
		expect(typeof DEFAULT_BROWSER_SETTINGS.viewport.width).to.equal("number")
		expect(typeof DEFAULT_BROWSER_SETTINGS.viewport.height).to.equal("number")
		expect(typeof DEFAULT_BROWSER_SETTINGS.headless).to.equal("boolean")
	})

	it("BROWSER_VIEWPORT_PRESETS should have all expected presets", () => {
		expect(BROWSER_VIEWPORT_PRESETS["Full HD (1920x1080)"]).to.exist
		expect(BROWSER_VIEWPORT_PRESETS["Large Desktop (1280x800)"]).to.exist
		expect(BROWSER_VIEWPORT_PRESETS["Small Desktop (900x600)"]).to.exist
		expect(BROWSER_VIEWPORT_PRESETS["Tablet (768x1024)"]).to.exist
		expect(BROWSER_VIEWPORT_PRESETS["Mobile (360x640)"]).to.exist

		// Check Full HD preset values
		expect(BROWSER_VIEWPORT_PRESETS["Full HD (1920x1080)"].width).to.equal(1920)
		expect(BROWSER_VIEWPORT_PRESETS["Full HD (1920x1080)"].height).to.equal(1080)
	})

	it("getConfiguredBrowserSettings should return preset dimensions when configured", () => {
		// Configure mock to return a specific preset
		mockConfig.get.withArgs("defaultBrowserViewport", sinon.match.any).returns("Full HD (1920x1080)")

		// Call the function
		const result = getConfiguredBrowserSettings()

		// Verify results
		expect(result.viewport.width).to.equal(1920)
		expect(result.viewport.height).to.equal(1080)
		expect(result.headless).to.equal(true)
	})

	it("getConfiguredBrowserSettings should return custom dimensions when configured", () => {
		// Configure mock to return Custom and specific dimensions
		mockConfig.get.withArgs("defaultBrowserViewport", sinon.match.any).returns("Custom")
		mockConfig.get.withArgs("defaultBrowserViewportWidth", sinon.match.any).returns(1440)
		mockConfig.get.withArgs("defaultBrowserViewportHeight", sinon.match.any).returns(900)

		// Call the function
		const result = getConfiguredBrowserSettings()

		// Verify results
		expect(result.viewport.width).to.equal(1440)
		expect(result.viewport.height).to.equal(900)
	})

	it("getConfiguredBrowserSettings should handle undefined viewport setting", () => {
		// Configure mock to return undefined for viewport setting
		mockConfig.get.withArgs("defaultBrowserViewport", sinon.match.any).returns(undefined)

		// Call the function
		const result = getConfiguredBrowserSettings()

		// Verify default values are used
		expect(result.viewport.width).to.equal(900)
		expect(result.viewport.height).to.equal(600)
		expect(result.headless).to.equal(true)
	})

	it("getConfiguredBrowserSettings should handle partial custom dimensions (width only)", () => {
		// Configure mock to return Custom but only provide width
		mockConfig.get.withArgs("defaultBrowserViewport", sinon.match.any).returns("Custom")
		mockConfig.get.withArgs("defaultBrowserViewportWidth", sinon.match.any).returns(1440)
		// When height is requested with a default, it should return the default
		mockConfig.get.withArgs("defaultBrowserViewportHeight", DEFAULT_VIEWPORT.height).returns(DEFAULT_VIEWPORT.height)

		// Call the function
		const result = getConfiguredBrowserSettings()

		// Verify custom width and default height
		expect(result.viewport.width).to.equal(1440)
		expect(result.viewport.height).to.equal(DEFAULT_VIEWPORT.height) // Default height
	})

	it("getConfiguredBrowserSettings should handle partial custom dimensions (height only)", () => {
		// Configure mock to return Custom but only provide height
		mockConfig.get.withArgs("defaultBrowserViewport", sinon.match.any).returns("Custom")
		// When width is requested with a default, it should return the default
		mockConfig.get.withArgs("defaultBrowserViewportWidth", DEFAULT_VIEWPORT.width).returns(DEFAULT_VIEWPORT.width)
		mockConfig.get.withArgs("defaultBrowserViewportHeight", sinon.match.any).returns(900)

		// Call the function
		const result = getConfiguredBrowserSettings()

		// Verify default width and custom height
		expect(result.viewport.width).to.equal(DEFAULT_VIEWPORT.width) // Default width
		expect(result.viewport.height).to.equal(900) // Custom height
	})

	it("getConfiguredBrowserSettings should return defaults when config unavailable", () => {
		// Configure mock to throw an error
		getConfigurationStub.throws(new Error("Config unavailable"))

		// Call the function
		const result = getConfiguredBrowserSettings()

		// Verify results - should return defaults
		expect(result.viewport.width).to.equal(900)
		expect(result.viewport.height).to.equal(600)
		expect(result.headless).to.equal(true)

		// Verify logger was called with error
		expect(loggerStub.calledOnce).to.be.true
		expect(loggerStub.firstCall.args[0].includes("Failed to read browser settings")).to.be.true
	})

	it("getConfiguredBrowserSettings should return defaults for invalid preset", () => {
		// Configure mock to return an invalid preset
		mockConfig.get.withArgs("defaultBrowserViewport", sinon.match.any).returns("Non-existent Preset")

		// Call the function
		const result = getConfiguredBrowserSettings()

		// Verify results - should return defaults
		expect(result.viewport.width).to.equal(900)
		expect(result.viewport.height).to.equal(600)
	})

	it("isValidPreset should correctly validate preset names", () => {
		// Valid presets
		expect(isValidPreset("Full HD (1920x1080)")).to.be.true
		expect(isValidPreset("Large Desktop (1280x800)")).to.be.true
		expect(isValidPreset("Small Desktop (900x600)")).to.be.true
		expect(isValidPreset("Tablet (768x1024)")).to.be.true
		expect(isValidPreset("Mobile (360x640)")).to.be.true

		// Invalid presets
		expect(isValidPreset("Non-existent Preset")).to.be.false
		expect(isValidPreset("")).to.be.false
		expect(isValidPreset("full hd")).to.be.false // case sensitive
	})

	it("getConfiguredBrowserSettings should handle 'Custom' vs 'custom' case sensitivity", () => {
		// Configure mock to return lowercase "custom" and specific dimensions
		mockConfig.get.withArgs("defaultBrowserViewport", sinon.match.any).returns("custom")
		mockConfig.get.withArgs("defaultBrowserViewportWidth", sinon.match.any).returns(1440)
		mockConfig.get.withArgs("defaultBrowserViewportHeight", sinon.match.any).returns(900)

		// Call the function
		const result = getConfiguredBrowserSettings()

		// Verify results - should not recognize "custom" (lowercase) and return defaults
		expect(result.viewport.width).to.equal(900)
		expect(result.viewport.height).to.equal(600)
	})
})
