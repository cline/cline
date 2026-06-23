import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import { expandEnvironmentVariables } from "../envExpansion"

describe("expandEnvironmentVariables", () => {
	// Store original environment
	let originalEnv: NodeJS.ProcessEnv

	beforeEach(() => {
		originalEnv = { ...process.env }
	})

	afterEach(() => {
		// Restore original environment
		process.env = originalEnv
	})

	describe("string expansion", () => {
		it("should expand a single environment variable", () => {
			process.env.TEST_VAR = "test_value"
			const result = expandEnvironmentVariables("${env:TEST_VAR}")
			result.should.equal("test_value")
		})

		it("should expand multiple environment variables in one string", () => {
			process.env.VAR1 = "value1"
			process.env.VAR2 = "value2"
			const result = expandEnvironmentVariables("${env:VAR1} and ${env:VAR2}")
			result.should.equal("value1 and value2")
		})

		it("should expand environment variables with surrounding text", () => {
			process.env.API_KEY = "secret123"
			const result = expandEnvironmentVariables("Bearer ${env:API_KEY}")
			result.should.equal("Bearer secret123")
		})

		it("should leave unexpanded when variable is missing", () => {
			const result = expandEnvironmentVariables("${env:MISSING_VAR}")
			result.should.equal("${env:MISSING_VAR}")
		})

		it("should handle empty string values", () => {
			process.env.EMPTY_VAR = ""
			const result = expandEnvironmentVariables("${env:EMPTY_VAR}")
			result.should.equal("")
		})

		it("should trim whitespace from variable names", () => {
			process.env.SPACED_VAR = "value"
			const result = expandEnvironmentVariables("${env: SPACED_VAR }")
			result.should.equal("value")
		})

		it("should handle variable names with hyphens", () => {
			process.env["VAR-NAME"] = "hyphenated"
			const result = expandEnvironmentVariables("${env:VAR-NAME}")
			result.should.equal("hyphenated")
		})

		it("should handle variable names with underscores", () => {
			process.env.VAR_NAME = "underscored"
			const result = expandEnvironmentVariables("${env:VAR_NAME}")
			result.should.equal("underscored")
		})

		it("should not expand malformed syntax", () => {
			process.env.TEST_VAR = "value"
			const result = expandEnvironmentVariables("${env:TEST_VAR")
			result.should.equal("${env:TEST_VAR")
		})

		it("should return string unchanged when no variables present", () => {
			const result = expandEnvironmentVariables("plain string")
			result.should.equal("plain string")
		})
	})

	describe("object expansion", () => {
		it("should expand variables in object values", () => {
			process.env.API_KEY = "secret"
			const result = expandEnvironmentVariables({
				key: "${env:API_KEY}",
			})
			result.should.deepEqual({
				key: "secret",
			})
		})

		it("should expand variables in nested objects", () => {
			process.env.TOKEN = "token123"
			process.env.KEY = "key456"
			const result = expandEnvironmentVariables({
				outer: {
					inner: {
						token: "${env:TOKEN}",
						key: "${env:KEY}",
					},
				},
			})
			result.should.deepEqual({
				outer: {
					inner: {
						token: "token123",
						key: "key456",
					},
				},
			})
		})

		it("should preserve non-string values in objects", () => {
			process.env.VAR = "value"
			const result = expandEnvironmentVariables({
				string: "${env:VAR}",
				number: 42,
				boolean: true,
				nullValue: null,
			})
			result.should.deepEqual({
				string: "value",
				number: 42,
				boolean: true,
				nullValue: null,
			})
		})
	})

	describe("array expansion", () => {
		it("should expand variables in array elements", () => {
			process.env.VAR1 = "first"
			process.env.VAR2 = "second"
			const result = expandEnvironmentVariables(["${env:VAR1}", "${env:VAR2}"])
			result.should.deepEqual(["first", "second"])
		})

		it("should expand variables in arrays within objects", () => {
			process.env.ARG1 = "arg1"
			process.env.ARG2 = "arg2"
			const result = expandEnvironmentVariables({
				args: ["${env:ARG1}", "${env:ARG2}"],
			})
			result.should.deepEqual({
				args: ["arg1", "arg2"],
			})
		})

		it("should preserve non-string values in arrays", () => {
			process.env.VAR = "value"
			const result = expandEnvironmentVariables(["${env:VAR}", 123, true, null])
			result.should.deepEqual(["value", 123, true, null])
		})
	})

	describe("complex nested structures", () => {
		it("should expand variables in deeply nested structures", () => {
			process.env.API_KEY = "key123"
			process.env.TOKEN = "token456"
			const result = expandEnvironmentVariables({
				server: {
					auth: {
						headers: {
							Authorization: "Bearer ${env:TOKEN}",
							"X-API-Key": "${env:API_KEY}",
						},
					},
					config: {
						args: ["--key", "${env:API_KEY}"],
					},
				},
			})
			result.should.deepEqual({
				server: {
					auth: {
						headers: {
							Authorization: "Bearer token456",
							"X-API-Key": "key123",
						},
					},
					config: {
						args: ["--key", "key123"],
					},
				},
			})
		})
	})

	describe("MCP config realistic scenarios", () => {
		it("should expand env variables in stdio server config", () => {
			process.env.MCP_API_KEY = "mykey"
			const result = expandEnvironmentVariables({
				type: "stdio",
				command: "node",
				args: ["server.js"],
				env: {
					API_KEY: "${env:MCP_API_KEY}",
				},
			})
			result.should.deepEqual({
				type: "stdio",
				command: "node",
				args: ["server.js"],
				env: {
					API_KEY: "mykey",
				},
			})
		})

		it("should expand env variables in HTTP server headers", () => {
			process.env.AUTH_TOKEN = "bearer_token_123"
			const result = expandEnvironmentVariables({
				type: "streamableHttp",
				url: "http://localhost:3001/mcp",
				headers: {
					Authorization: "Bearer ${env:AUTH_TOKEN}",
				},
			})
			result.should.deepEqual({
				type: "streamableHttp",
				url: "http://localhost:3001/mcp",
				headers: {
					Authorization: "Bearer bearer_token_123",
				},
			})
		})

		it("should expand env variables in URLs", () => {
			process.env.MCP_HOST = "api.example.com"
			process.env.MCP_PORT = "8080"
			const result = expandEnvironmentVariables({
				url: "https://${env:MCP_HOST}:${env:MCP_PORT}/mcp",
			})
			result.should.deepEqual({
				url: "https://api.example.com:8080/mcp",
			})
		})
	})

	describe("primitive values", () => {
		it("should return numbers unchanged", () => {
			const result = expandEnvironmentVariables(42)
			result.should.equal(42)
		})

		it("should return booleans unchanged", () => {
			const result = expandEnvironmentVariables(true)
			result.should.equal(true)
		})

		it("should return null unchanged", () => {
			const result = expandEnvironmentVariables(null)
			;(result === null).should.be.true()
		})

		it("should return undefined unchanged", () => {
			const result = expandEnvironmentVariables(undefined)
			;(result === undefined).should.be.true()
		})
	})
})
