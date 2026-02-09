import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import fs from "fs/promises"
import os from "os"
import path from "path"
import sinon from "sinon"
import { BeadsmithConfigurationError, BeadsmithEndpoint, BeadsmithEnv, Environment } from "../config"

describe("BeadsmithEndpoint configuration", () => {
	let sandbox: sinon.SinonSandbox
	let tempDir: string
	let originalHomedir: typeof os.homedir

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		tempDir = path.join(os.tmpdir(), `config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(tempDir, { recursive: true })

		// Create .cline directory
		await fs.mkdir(path.join(tempDir, ".beadsmith"), { recursive: true })

		// Stub os.homedir to return our temp directory
		originalHomedir = os.homedir
		sandbox
			.stub(os, "homedir")
			.returns(tempDir)

		// Reset the singleton state using internal method
		;(BeadsmithEndpoint as any)._instance = null
		;(BeadsmithEndpoint as any)._initialized = false
	})

	afterEach(async () => {
		sandbox.restore()
		// Reset singleton state
		;(BeadsmithEndpoint as any)._instance = null
		;(BeadsmithEndpoint as any)._initialized = false
		try {
			await fs.rm(tempDir, { recursive: true, force: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	describe("valid config parsing", () => {
		it("should parse valid endpoints.json with all required fields", async () => {
			const validConfig = {
				appBaseUrl: "https://app.enterprise.com",
				apiBaseUrl: "https://api.enterprise.com",
				mcpBaseUrl: "https://mcp.enterprise.com",
			}

			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), JSON.stringify(validConfig), "utf8")

			await BeadsmithEndpoint.initialize()

			const config = BeadsmithEndpoint.config
			config.appBaseUrl.should.equal("https://app.enterprise.com")
			config.apiBaseUrl.should.equal("https://api.enterprise.com")
			config.mcpBaseUrl.should.equal("https://mcp.enterprise.com")
			config.environment.should.equal(Environment.selfHosted)
		})

		it("should work without endpoints.json (standard mode)", async () => {
			// No endpoints.json file exists

			await BeadsmithEndpoint.initialize()

			const config = BeadsmithEndpoint.config
			config.environment.should.not.equal(Environment.selfHosted)
			// Should use production defaults
			config.appBaseUrl.should.equal("https://app.cline.bot")
			config.apiBaseUrl.should.equal("https://api.cline.bot")
		})

		it("should accept URLs with ports", async () => {
			const validConfig = {
				appBaseUrl: "http://localhost:3000",
				apiBaseUrl: "http://localhost:7777",
				mcpBaseUrl: "http://localhost:8080/mcp",
			}

			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), JSON.stringify(validConfig), "utf8")

			await BeadsmithEndpoint.initialize()

			const config = BeadsmithEndpoint.config
			config.appBaseUrl.should.equal("http://localhost:3000")
			config.apiBaseUrl.should.equal("http://localhost:7777")
			config.mcpBaseUrl.should.equal("http://localhost:8080/mcp")
		})

		it("should accept URLs with paths", async () => {
			const validConfig = {
				appBaseUrl: "https://proxy.enterprise.com/cline/app",
				apiBaseUrl: "https://proxy.enterprise.co./beadsmith/api",
				mcpBaseUrl: "https://proxy.enterprise.com/cline/mcp",
			}

			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), JSON.stringify(validConfig), "utf8")

			await BeadsmithEndpoint.initialize()

			const config = BeadsmithEndpoint.config
			config.appBaseUrl.should.equal("https://proxy.enterprise.com/cline/app")
		})
	})

	describe("invalid JSON handling", () => {
		it("should throw BeadsmithConfigurationError for invalid JSON syntax", async () => {
			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), "{ invalid json }", "utf8")

			try {
				await BeadsmithEndpoint.initialize()
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.should.be.instanceof(BeadsmithConfigurationError)
				error.message.should.containEql("Invalid JSON")
			}
		})

		it("should throw BeadsmithConfigurationError for truncated JSON", async () => {
			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), '{"appBaseUrl": "https://test.com"', "utf8")

			try {
				await BeadsmithEndpoint.initialize()
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.should.be.instanceof(BeadsmithConfigurationError)
				error.message.should.containEql("Invalid JSON")
			}
		})

		it("should throw BeadsmithConfigurationError for empty file", async () => {
			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), "", "utf8")

			try {
				await BeadsmithEndpoint.initialize()
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.should.be.instanceof(BeadsmithConfigurationError)
			}
		})

		it("should throw BeadsmithConfigurationError for non-object JSON", async () => {
			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), '"just a string"', "utf8")

			try {
				await BeadsmithEndpoint.initialize()
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.should.be.instanceof(BeadsmithConfigurationError)
				error.message.should.containEql("must contain a JSON object")
			}
		})

		it("should throw BeadsmithConfigurationError for array JSON", async () => {
			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), "[]", "utf8")

			try {
				await BeadsmithEndpoint.initialize()
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.should.be.instanceof(BeadsmithConfigurationError)
				// Arrays pass the object check but fail on required fields
				error.message.should.containEql("Missing required field")
			}
		})

		it("should throw BeadsmithConfigurationError for null JSON", async () => {
			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), "null", "utf8")

			try {
				await BeadsmithEndpoint.initialize()
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.should.be.instanceof(BeadsmithConfigurationError)
				error.message.should.containEql("must contain a JSON object")
			}
		})
	})

	describe("missing required fields", () => {
		it("should throw BeadsmithConfigurationError when appBaseUrl is missing", async () => {
			const config = {
				apiBaseUrl: "https://api.enterprise.com",
				mcpBaseUrl: "https://mcp.enterprise.com",
			}

			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), JSON.stringify(config), "utf8")

			try {
				await BeadsmithEndpoint.initialize()
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.should.be.instanceof(BeadsmithConfigurationError)
				error.message.should.containEql('Missing required field "appBaseUrl"')
			}
		})

		it("should throw BeadsmithConfigurationError when apiBaseUrl is missing", async () => {
			const config = {
				appBaseUrl: "https://app.enterprise.com",
				mcpBaseUrl: "https://mcp.enterprise.com",
			}

			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), JSON.stringify(config), "utf8")

			try {
				await BeadsmithEndpoint.initialize()
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.should.be.instanceof(BeadsmithConfigurationError)
				error.message.should.containEql('Missing required field "apiBaseUrl"')
			}
		})

		it("should throw BeadsmithConfigurationError when mcpBaseUrl is missing", async () => {
			const config = {
				appBaseUrl: "https://app.enterprise.com",
				apiBaseUrl: "https://api.enterprise.com",
			}

			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), JSON.stringify(config), "utf8")

			try {
				await BeadsmithEndpoint.initialize()
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.should.be.instanceof(BeadsmithConfigurationError)
				error.message.should.containEql('Missing required field "mcpBaseUrl"')
			}
		})

		it("should throw BeadsmithConfigurationError when all fields are missing", async () => {
			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), "{}", "utf8")

			try {
				await BeadsmithEndpoint.initialize()
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.should.be.instanceof(BeadsmithConfigurationError)
				error.message.should.containEql("Missing required field")
			}
		})

		it("should throw BeadsmithConfigurationError when field is null", async () => {
			const config = {
				appBaseUrl: null,
				apiBaseUrl: "https://api.enterprise.com",
				mcpBaseUrl: "https://mcp.enterprise.com",
			}

			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), JSON.stringify(config), "utf8")

			try {
				await BeadsmithEndpoint.initialize()
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.should.be.instanceof(BeadsmithConfigurationError)
				error.message.should.containEql('Missing required field "appBaseUrl"')
			}
		})

		it("should throw BeadsmithConfigurationError when field is empty string", async () => {
			const config = {
				appBaseUrl: "",
				apiBaseUrl: "https://api.enterprise.com",
				mcpBaseUrl: "https://mcp.enterprise.com",
			}

			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), JSON.stringify(config), "utf8")

			try {
				await BeadsmithEndpoint.initialize()
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.should.be.instanceof(BeadsmithConfigurationError)
				error.message.should.containEql("cannot be empty")
			}
		})

		it("should throw BeadsmithConfigurationError when field is whitespace only", async () => {
			const config = {
				appBaseUrl: "   ",
				apiBaseUrl: "https://api.enterprise.com",
				mcpBaseUrl: "https://mcp.enterprise.com",
			}

			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), JSON.stringify(config), "utf8")

			try {
				await BeadsmithEndpoint.initialize()
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.should.be.instanceof(BeadsmithConfigurationError)
				error.message.should.containEql("cannot be empty")
			}
		})

		it("should throw BeadsmithConfigurationError when field is non-string", async () => {
			const config = {
				appBaseUrl: 12345,
				apiBaseUrl: "https://api.enterprise.com",
				mcpBaseUrl: "https://mcp.enterprise.com",
			}

			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), JSON.stringify(config), "utf8")

			try {
				await BeadsmithEndpoint.initialize()
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.should.be.instanceof(BeadsmithConfigurationError)
				error.message.should.containEql("must be a string")
			}
		})
	})

	describe("invalid URL detection", () => {
		it("should throw BeadsmithConfigurationError for invalid URL format", async () => {
			const config = {
				appBaseUrl: "not-a-valid-url",
				apiBaseUrl: "https://api.enterprise.com",
				mcpBaseUrl: "https://mcp.enterprise.com",
			}

			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), JSON.stringify(config), "utf8")

			try {
				await BeadsmithEndpoint.initialize()
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.should.be.instanceof(BeadsmithConfigurationError)
				error.message.should.containEql("must be a valid URL")
			}
		})

		it("should throw BeadsmithConfigurationError for URL without protocol", async () => {
			const config = {
				appBaseUrl: "app.enterprise.com",
				apiBaseUrl: "https://api.enterprise.com",
				mcpBaseUrl: "https://mcp.enterprise.com",
			}

			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), JSON.stringify(config), "utf8")

			try {
				await BeadsmithEndpoint.initialize()
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.should.be.instanceof(BeadsmithConfigurationError)
				error.message.should.containEql("must be a valid URL")
			}
		})

		it("should throw BeadsmithConfigurationError for malformed URL", async () => {
			const config = {
				appBaseUrl: "https://",
				apiBaseUrl: "https://api.enterprise.com",
				mcpBaseUrl: "https://mcp.enterprise.com",
			}

			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), JSON.stringify(config), "utf8")

			try {
				await BeadsmithEndpoint.initialize()
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.should.be.instanceof(BeadsmithConfigurationError)
				error.message.should.containEql("must be a valid URL")
			}
		})

		it("should include the invalid URL value in error message", async () => {
			const invalidUrl = "definitely-not-a-url"
			const config = {
				appBaseUrl: invalidUrl,
				apiBaseUrl: "https://api.enterprise.com",
				mcpBaseUrl: "https://mcp.enterprise.com",
			}

			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), JSON.stringify(config), "utf8")

			try {
				await BeadsmithEndpoint.initialize()
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.should.be.instanceof(BeadsmithConfigurationError)
				error.message.should.containEql(invalidUrl)
			}
		})
	})

	describe("environment switching blocked in self-hosted mode", () => {
		it("should throw error when trying to change environment in self-hosted mode", async () => {
			const config = {
				appBaseUrl: "https://app.enterprise.com",
				apiBaseUrl: "https://api.enterprise.com",
				mcpBaseUrl: "https://mcp.enterprise.com",
			}

			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), JSON.stringify(config), "utf8")

			await BeadsmithEndpoint.initialize()

			// Verify we're in self-hosted mode
			BeadsmithEndpoint.config.environment.should.equal(Environment.selfHosted)

			// Try to change environment - should throw
			try {
				BeadsmithEnv.setEnvironment("staging")
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.containEql("Cannot change environment in on-premise mode")
			}
		})

		it("should throw error for all environment values in self-hosted mode", async () => {
			const config = {
				appBaseUrl: "https://app.enterprise.com",
				apiBaseUrl: "https://api.enterprise.com",
				mcpBaseUrl: "https://mcp.enterprise.com",
			}

			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), JSON.stringify(config), "utf8")

			await BeadsmithEndpoint.initialize()

			const environments = ["staging", "local", "production", "anything"]
			for (const env of environments) {
				try {
					BeadsmithEnv.setEnvironment(env)
					throw new Error(`Should have thrown for environment: ${env}`)
				} catch (error: any) {
					error.message.should.containEql("Cannot change environment in on-premise mode")
				}
			}
		})

		it("should allow environment switching in standard mode", async () => {
			// No endpoints.json file - standard mode

			await BeadsmithEndpoint.initialize()

			// Verify we're NOT in self-hosted mode
			BeadsmithEndpoint.config.environment.should.not.equal(Environment.selfHosted)

			// Should be able to change environment
			BeadsmithEnv.setEnvironment("staging")
			BeadsmithEnv.getEnvironment().environment.should.equal("staging")

			BeadsmithEnv.setEnvironment("local")
			BeadsmithEnv.getEnvironment().environment.should.equal("local")

			BeadsmithEnv.setEnvironment("production")
			BeadsmithEnv.getEnvironment().environment.should.equal("production")
		})
	})

	describe("self-hosted mode behavior", () => {
		it("should report selfHosted environment in self-hosted mode", async () => {
			const config = {
				appBaseUrl: "https://app.enterprise.com",
				apiBaseUrl: "https://api.enterprise.com",
				mcpBaseUrl: "https://mcp.enterprise.com",
			}

			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), JSON.stringify(config), "utf8")

			await BeadsmithEndpoint.initialize()

			const envConfig = BeadsmithEndpoint.config
			envConfig.environment.should.equal(Environment.selfHosted)
		})

		it("should use custom endpoints from file", async () => {
			const customConfig = {
				appBaseUrl: "https://custom-app.internal",
				apiBaseUrl: "https://custom-api.internal",
				mcpBaseUrl: "https://custom-mcp.internal/v1",
			}

			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), JSON.stringify(customConfig), "utf8")

			await BeadsmithEndpoint.initialize()

			const config = BeadsmithEndpoint.config
			config.appBaseUrl.should.equal("https://custom-app.internal")
			config.apiBaseUrl.should.equal("https://custom-api.internal")
			config.mcpBaseUrl.should.equal("https://custom-mcp.internal/v1")
		})
	})

	describe("initialization behavior", () => {
		it("should only initialize once", async () => {
			await BeadsmithEndpoint.initialize()
			BeadsmithEndpoint.isInitialized().should.be.true()

			// Second initialize should be a no-op
			await BeadsmithEndpoint.initialize()
			BeadsmithEndpoint.isInitialized().should.be.true()
		})

		it("should throw error when accessing config before initialization", async () => {
			// Already reset in beforeEach, so accessing should throw
			try {
				const _ = BeadsmithEndpoint.config
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.containEql("not initialized")
			}
		})
	})

	describe("isSelfHosted() method", () => {
		it("should return true when not initialized (safety fallback)", async () => {
			// Reset singleton state - already done in beforeEach, not initialized
			BeadsmithEndpoint.isInitialized().should.be.false()
			BeadsmithEndpoint.isSelfHosted().should.be.true()
		})

		it("should return true when in self-hosted mode", async () => {
			const config = {
				appBaseUrl: "https://app.enterprise.com",
				apiBaseUrl: "https://api.enterprise.com",
				mcpBaseUrl: "https://mcp.enterprise.com",
			}
			await fs.writeFile(path.join(tempDir, ".beadsmith", "endpoints.json"), JSON.stringify(config), "utf8")
			await BeadsmithEndpoint.initialize()

			BeadsmithEndpoint.isSelfHosted().should.be.true()
		})

		it("should return false when in normal mode (no endpoints.json)", async () => {
			// No endpoints.json file exists
			await BeadsmithEndpoint.initialize()

			BeadsmithEndpoint.isSelfHosted().should.be.false()
		})
	})
})
