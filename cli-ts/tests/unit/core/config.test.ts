import { expect } from "chai"
import os from "os"
import path from "path"
import { createConfig, DEFAULT_CLI_CONFIG, getDefaultConfigDir } from "../../../src/core/config.js"

describe("Config", () => {
	describe("getDefaultConfigDir", () => {
		it("should return ~/.cline path", () => {
			const result = getDefaultConfigDir()
			const expected = path.join(os.homedir(), ".cline")
			expect(result).to.equal(expected)
		})
	})

	describe("DEFAULT_CLI_CONFIG", () => {
		it("should have verbose=false by default", () => {
			expect(DEFAULT_CLI_CONFIG.verbose).to.be.false
		})

		it("should have configDir set to ~/.cline", () => {
			const expected = path.join(os.homedir(), ".cline")
			expect(DEFAULT_CLI_CONFIG.configDir).to.equal(expected)
		})
	})

	describe("createConfig", () => {
		it("should return default config when called without arguments", () => {
			const config = createConfig()
			expect(config.verbose).to.equal(DEFAULT_CLI_CONFIG.verbose)
			expect(config.configDir).to.equal(DEFAULT_CLI_CONFIG.configDir)
		})

		it("should merge provided options with defaults", () => {
			const config = createConfig({ verbose: true })
			expect(config.verbose).to.be.true
			expect(config.configDir).to.equal(DEFAULT_CLI_CONFIG.configDir)
		})

		it("should override configDir when provided", () => {
			const customDir = "/custom/path"
			const config = createConfig({ configDir: customDir })
			expect(config.configDir).to.equal(customDir)
			expect(config.verbose).to.be.false
		})

		it("should allow overriding all options", () => {
			const customDir = "/custom/path"
			const config = createConfig({
				verbose: true,
				configDir: customDir,
			})
			expect(config.verbose).to.be.true
			expect(config.configDir).to.equal(customDir)
		})
	})
})
