import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import * as sinon from "sinon"
import * as vscode from "vscode"
import { getTerminalEnvironmentVariables, substituteEnvironmentVariables } from "../utils"

// Mock vscode module
const mockWorkspace = {
	getConfiguration: sinon.stub(),
}

// Override the vscode module workspace property
Object.defineProperty(vscode, "workspace", {
	value: mockWorkspace,
	configurable: true,
})

describe("MCP Utils Tests", () => {
	let mockGetConfiguration: sinon.SinonStub
	let originalPlatform: string
	let originalProcessEnv: NodeJS.ProcessEnv
	let consoleWarnStub: sinon.SinonStub

	beforeEach(() => {
		mockGetConfiguration = mockWorkspace.getConfiguration
		originalPlatform = process.platform
		originalProcessEnv = { ...process.env }

		// Mock console.warn to avoid noise in tests
		consoleWarnStub = sinon.stub(console, "warn")

		// Reset the stub
		mockGetConfiguration.reset()
	})

	afterEach(() => {
		// Restore original values
		Object.defineProperty(process, "platform", { value: originalPlatform })
		// Restore original process.env properties
		if (originalProcessEnv) {
			Object.keys(process.env).forEach((key) => {
				if (originalProcessEnv && !(key in originalProcessEnv)) {
					delete process.env[key]
				}
			})
			Object.keys(originalProcessEnv).forEach((key) => {
				if (originalProcessEnv[key] !== undefined) {
					process.env[key] = originalProcessEnv[key]
				}
			})
		}
		sinon.restore()
	})

	describe("getTerminalEnvironmentVariables", () => {
		const platformTests = [
			{ platform: "darwin", envKey: "env.osx", description: "macOS" },
			{ platform: "win32", envKey: "env.windows", description: "Windows" },
			{ platform: "linux", envKey: "env.linux", description: "Linux" },
		]

		const mockEnvData = {
			API_KEY: "test-api-key",
			DATABASE_URL: "postgres://localhost:5432/test",
		}

		platformTests.forEach(({ platform, envKey, description }) => {
			it(`should get environment variables for ${description}`, () => {
				Object.defineProperty(process, "platform", { value: platform })

				const mockConfig = {
					get: sinon.stub().returns(mockEnvData),
				}
				mockGetConfiguration.returns(mockConfig as any)

				const result = getTerminalEnvironmentVariables()

				expect(mockGetConfiguration.calledWith("terminal.integrated")).to.be.true
				expect(mockConfig.get.calledWith(envKey)).to.be.true
				expect(result).to.deep.equal(mockEnvData)
			})
		})

		it("should return empty object when VS Code config fails", () => {
			mockGetConfiguration.throws(new Error("Config error"))

			const result = getTerminalEnvironmentVariables()

			expect(result).to.deep.equal({})
			expect(consoleWarnStub.calledWith("Failed to get terminal environment variables:", sinon.match.instanceOf(Error))).to
				.be.true
		})

		it("should return empty object when get method returns null", () => {
			const mockConfig = {
				get: sinon.stub().returns(null),
			}
			mockGetConfiguration.returns(mockConfig as any)

			const result = getTerminalEnvironmentVariables()

			expect(result).to.deep.equal({})
		})
	})

	describe("substituteEnvironmentVariables", () => {
		beforeEach(() => {
			// Set up default platform for these tests
			Object.defineProperty(process, "platform", { value: "darwin" })
		})

		it("should substitute variables from terminal.integrated.env", () => {
			const mockConfig = {
				get: sinon.stub().returns({
					API_KEY: "terminal-api-key",
					DATABASE_URL: "terminal-db-url",
				}),
			}
			mockGetConfiguration.returns(mockConfig as any)

			// Set specific environment variables for this test
			process.env["API_KEY"] = "system-api-key" // This should be ignored in favor of terminal env
			process.env["SYSTEM_VAR"] = "system-value"

			const content = `{
				"url": "\${env:DATABASE_URL}",
				"headers": {
					"Authorization": "Bearer \${env:API_KEY}"
				}
			}`

			const result = substituteEnvironmentVariables(content)

			expect(result).to.equal(`{
				"url": "terminal-db-url",
				"headers": {
					"Authorization": "Bearer terminal-api-key"
				}
			}`)
		})

		it("should fallback to system environment variables", () => {
			const mockConfig = {
				get: sinon.stub().returns({
					TERMINAL_VAR: "terminal-value",
				}),
			}
			mockGetConfiguration.returns(mockConfig as any)

			// Set specific environment variables for this test
			process.env["SYSTEM_VAR"] = "system-value"
			process.env["API_KEY"] = "system-api-key"

			const content = `{
				"terminal": "\${env:TERMINAL_VAR}",
				"system": "\${env:SYSTEM_VAR}",
				"api": "\${env:API_KEY}"
			}`

			const result = substituteEnvironmentVariables(content)

			expect(result).to.equal(`{
				"terminal": "terminal-value",
				"system": "system-value",
				"api": "system-api-key"
			}`)
		})

		it("should keep placeholder for undefined variables", () => {
			const mockConfig = {
				get: sinon.stub().returns({}),
			}
			mockGetConfiguration.returns(mockConfig as any)

			// Set specific environment variables for this test
			process.env["DEFINED_VAR"] = "defined-value"

			const content = `{
				"defined": "\${env:DEFINED_VAR}",
				"undefined": "\${env:UNDEFINED_VAR}"
			}`

			const result = substituteEnvironmentVariables(content)

			expect(result).to.equal(`{
				"defined": "defined-value",
				"undefined": "\${env:UNDEFINED_VAR}"
			}`)
			expect(
				consoleWarnStub.calledWith(
					'Environment variable "UNDEFINED_VAR" is not defined in terminal.integrated.env or system environment, keeping placeholder: ${env:UNDEFINED_VAR}',
				),
			).to.be.true
		})

		it("should handle multiple occurrences of the same variable", () => {
			const mockConfig = {
				get: sinon.stub().returns({
					API_KEY: "my-api-key",
				}),
			}
			mockGetConfiguration.returns(mockConfig as any)

			const content = `{
				"header1": "Bearer \${env:API_KEY}",
				"header2": "Token \${env:API_KEY}",
				"backup": "\${env:API_KEY}"
			}`

			const result = substituteEnvironmentVariables(content)

			expect(result).to.equal(`{
				"header1": "Bearer my-api-key",
				"header2": "Token my-api-key",
				"backup": "my-api-key"
			}`)
		})

		it("should handle empty content", () => {
			const mockConfig = {
				get: sinon.stub().returns({}),
			}
			mockGetConfiguration.returns(mockConfig as any)

			const result = substituteEnvironmentVariables("")

			expect(result).to.equal("")
		})

		it("should handle content with no placeholders", () => {
			const mockConfig = {
				get: sinon.stub().returns({}),
			}
			mockGetConfiguration.returns(mockConfig as any)

			const content = `{
				"url": "https://api.example.com",
				"headers": {
					"Content-Type": "application/json"
				}
			}`

			const result = substituteEnvironmentVariables(content)

			expect(result).to.equal(content)
		})

		it("should handle malformed placeholders", () => {
			const mockConfig = {
				get: sinon.stub().returns({}),
			}
			mockGetConfiguration.returns(mockConfig as any)

			const content = `{
				"valid": "\${env:VALID_VAR}",
				"malformed1": "\${env:}",
				"malformed2": "\${env",
				"malformed3": "env:MISSING_BRACKETS}"
			}`

			// Set specific environment variables for this test
			process.env["VALID_VAR"] = "valid-value"

			const result = substituteEnvironmentVariables(content)

			expect(result).to.equal(`{
				"valid": "valid-value",
				"malformed1": "\${env:}",
				"malformed2": "\${env",
				"malformed3": "env:MISSING_BRACKETS}"
			}`)
		})
	})
})
