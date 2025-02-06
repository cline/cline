/// <reference types="mocha" />

const assert = require("assert")
const axios = require("axios")
import type { CustomGatewayHandler } from "../api/providers/custom-gateway"
import type { ApiHandlerOptions, CustomGatewayConfig } from "../shared/api"

// Mock axios
const mockAxios = {
	create: () => ({
		get: async () => ({}),
		post: async () => ({}),
	}),
}
;(axios as any).create = mockAxios.create

describe("CustomGatewayHandler", () => {
	// Default test configuration
	const defaultConfig = {
		baseUrl: "https://api.example.com",
		compatibilityMode: "openai",
		headers: [{ key: "Authorization", value: "Bearer test-token" }],
	} as const

	const defaultOptions = {
		customGatewayConfig: defaultConfig,
		webview: {
			postMessage: () => {},
		},
	}

	before(() => {
		// Reset axios mock before each test
		;(axios as any).create = mockAxios.create
	})

	after(() => {
		// Clean up after each test
		;(axios as any).create = mockAxios.create
	})

	describe("Constructor", () => {
		it("should throw error if customGatewayConfig is missing", () => {
			const { CustomGatewayHandler } = require("../api/providers/custom-gateway")
			assert.throws(() => new CustomGatewayHandler({}), /Custom gateway configuration is required/)
		})

		it("should throw error if baseUrl is missing", () => {
			const { CustomGatewayHandler } = require("../api/providers/custom-gateway")
			const options = {
				customGatewayConfig: {
					compatibilityMode: "openai",
					headers: [],
					baseUrl: "", // Empty but present to satisfy type
				},
			}

			assert.throws(() => new CustomGatewayHandler(options), /Base URL is required/)
		})

		it("should throw error if compatibilityMode is missing", () => {
			const { CustomGatewayHandler } = require("../api/providers/custom-gateway")
			const options = {
				customGatewayConfig: {
					baseUrl: "https://api.example.com",
					headers: [],
					compatibilityMode: "openai", // Added to satisfy type
				},
			}

			assert.throws(() => new CustomGatewayHandler(options), /Compatibility mode is required/)
		})

		it("should initialize with valid configuration", () => {
			const { CustomGatewayHandler } = require("../api/providers/custom-gateway")
			const handler = new CustomGatewayHandler(defaultOptions)
			assert.ok(handler instanceof CustomGatewayHandler)
		})

		it("should handle path prefix in baseUrl construction", () => {
			const { CustomGatewayHandler } = require("../api/providers/custom-gateway")
			const configWithPrefix = {
				...defaultConfig,
				pathPrefix: "/v1",
			}

			const createSpy = {
				called: false,
				args: null as any,
			}

			;(axios as any).create = (config: any) => {
				createSpy.called = true
				createSpy.args = config
				return mockAxios.create()
			}

			new CustomGatewayHandler({
				...defaultOptions,
				customGatewayConfig: configWithPrefix,
			})

			assert.ok(createSpy.called)
			assert.strictEqual(createSpy.args.baseURL, "https://api.example.com/v1")
		})

		it("should properly build headers", () => {
			const { CustomGatewayHandler } = require("../api/providers/custom-gateway")
			const configWithHeaders = {
				...defaultConfig,
				headers: [
					{ key: "Authorization", value: "Bearer test-token" },
					{ key: "Custom-Header", value: "test-value" },
				],
			}

			const createSpy = {
				called: false,
				args: null as any,
			}

			;(axios as any).create = (config: any) => {
				createSpy.called = true
				createSpy.args = config
				return mockAxios.create()
			}

			new CustomGatewayHandler({
				...defaultOptions,
				customGatewayConfig: configWithHeaders,
			})

			assert.ok(createSpy.called)
			assert.deepStrictEqual(createSpy.args.headers, {
				"Content-Type": "application/json",
				Authorization: "Bearer test-token",
				"Custom-Header": "test-value",
			})
		})
	})

	describe("Health Check", () => {
		it("should start health check when enabled", () => {
			const { CustomGatewayHandler } = require("../api/providers/custom-gateway")
			const configWithHealthCheck = {
				...defaultConfig,
				healthCheck: {
					enabled: true,
					interval: 5000,
					timeout: 2000,
				},
			}

			let healthCheckCalled = false
			const mockAxiosInstance = {
				get: async (url: string) => {
					if (url === "/health") {
						healthCheckCalled = true
					}
					return {
						data: {
							type: "pong",
							status: "healthy",
							timestamp: Date.now(),
						},
					}
				},
				post: async () => ({}),
			}

			;(axios as any).create = () => mockAxiosInstance

			new CustomGatewayHandler({
				...defaultOptions,
				customGatewayConfig: configWithHealthCheck,
			})

			assert.ok(healthCheckCalled)
		})

		it("should handle health check errors", async () => {
			const { CustomGatewayHandler } = require("../api/providers/custom-gateway")
			const configWithHealthCheck = {
				...defaultConfig,
				healthCheck: {
					enabled: true,
				},
			}

			let postedMessage: any = null
			const mockWebview = {
				postMessage: (message: any) => {
					postedMessage = message
				},
			}

			const mockAxiosInstance = {
				get: async () => {
					throw new Error("Network error")
				},
				post: async () => ({}),
			}

			;(axios as any).create = () => mockAxiosInstance

			new CustomGatewayHandler({
				...defaultOptions,
				customGatewayConfig: configWithHealthCheck,
				webview: mockWebview,
			})

			// Wait for next tick to allow health check to run
			await new Promise((resolve) => setTimeout(resolve, 0))

			assert.ok(postedMessage)
			assert.strictEqual(postedMessage.type, "customGatewayHealthStatus")
			assert.strictEqual(postedMessage.healthStatus.status, "unhealthy")
			assert.strictEqual(postedMessage.healthStatus.message, "Network error")
		})
	})

	describe("Model Management", () => {
		it("should use default model when no modelListSource", () => {
			const { CustomGatewayHandler } = require("../api/providers/custom-gateway")
			const configWithDefaultModel = {
				...defaultConfig,
				defaultModel: {
					id: "test-model",
					info: {
						supportsPromptCache: false,
						description: "A test model",
					},
				},
			}

			const handler = new CustomGatewayHandler({
				...defaultOptions,
				customGatewayConfig: configWithDefaultModel,
			})

			const model = handler.getModel()
			assert.deepStrictEqual(model, configWithDefaultModel.defaultModel)
		})

		it("should fetch and cache model list", async () => {
			const { CustomGatewayHandler } = require("../api/providers/custom-gateway")
			const configWithModelList = {
				...defaultConfig,
				modelListSource: "/models",
			}

			const mockModels = {
				models: [
					{
						id: "model-1",
						info: {
							supportsPromptCache: false,
							description: "First test model",
						},
					},
				],
			}

			let getCallCount = 0
			const mockAxiosInstance = {
				get: async (url: string) => {
					if (url === "/models") {
						getCallCount++
						return { data: mockModels }
					}
					return {}
				},
				post: async () => ({}),
			}

			;(axios as any).create = () => mockAxiosInstance

			const handler = new CustomGatewayHandler({
				...defaultOptions,
				customGatewayConfig: configWithModelList,
			})

			// Initial call should fetch from source
			await handler.getModel()
			assert.strictEqual(getCallCount, 1)

			// Subsequent calls should use cache
			await handler.getModel()
			assert.strictEqual(getCallCount, 1)
		})
	})

	describe("Message Creation", () => {
		it("should create message with proper format", async () => {
			const { CustomGatewayHandler } = require("../api/providers/custom-gateway")
			const mockAxiosInstance = {
				get: async () => ({}),
				post: async () => ({
					data: [
						Buffer.from(
							JSON.stringify({
								choices: [
									{
										delta: { content: "Hello" },
									},
								],
							}),
						),
					],
					headers: {
						"x-usage": JSON.stringify({
							prompt_tokens: 10,
							completion_tokens: 5,
							total_cost: 0.001,
						}),
					},
				}),
			}

			;(axios as any).create = () => mockAxiosInstance

			const handler = new CustomGatewayHandler({
				...defaultOptions,
				customGatewayConfig: {
					...defaultConfig,
					defaultModel: {
						id: "test-model",
						info: {
							supportsPromptCache: false,
							description: "Test Model",
						},
					},
				},
			})

			const messageIterator = handler.createMessage("You are a helpful assistant", [{ role: "user", content: "Hello" }])

			const messages = []
			for await (const message of messageIterator) {
				messages.push(message)
			}

			assert.deepStrictEqual(messages, [
				{ type: "text", text: "Hello" },
				{
					type: "usage",
					inputTokens: 10,
					outputTokens: 5,
					totalCost: 0.001,
				},
			])
		})

		it("should handle streaming errors", async () => {
			const { CustomGatewayHandler } = require("../api/providers/custom-gateway")
			const mockAxiosInstance = {
				get: async () => ({}),
				post: async () => ({
					data: [
						Buffer.from(
							JSON.stringify({
								error: {
									message: "Test error",
								},
							}),
						),
					],
				}),
			}

			;(axios as any).create = () => mockAxiosInstance

			const handler = new CustomGatewayHandler({
				...defaultOptions,
				customGatewayConfig: {
					...defaultConfig,
					defaultModel: {
						id: "test-model",
						info: {
							supportsPromptCache: false,
							description: "Test Model",
						},
					},
				},
			})

			const messageIterator = handler.createMessage("You are a helpful assistant", [{ role: "user", content: "Hello" }])

			try {
				for await (const message of messageIterator) {
					// Consume iterator
				}
				assert.fail("Expected error was not thrown")
			} catch (error) {
				assert.ok(error instanceof Error)
				assert.strictEqual(error.message, "Gateway API Error: Test error")
			}
		})
	})
})
