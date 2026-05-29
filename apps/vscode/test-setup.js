const tsConfigPaths = require("tsconfig-paths")
const fs = require("fs")
const path = require("path")
const Module = require("module")

const baseUrl = path.resolve(__dirname)

const tsConfig = JSON.parse(fs.readFileSync(path.join(baseUrl, "tsconfig.json"), "utf-8"))

/**
 * The aliases point towards the `src` directory.
 * However, `tsc` doesn't compile paths by itself
 * (https://www.typescriptlang.org/docs/handbook/modules/reference.html#paths-does-not-affect-emit)
 * So we need to use tsconfig-paths to resolve the aliases when running tests,
 * but pointing to `out` instead.
 */
const outPaths = {}
Object.keys(tsConfig.compilerOptions.paths).forEach((key) => {
	const value = tsConfig.compilerOptions.paths[key]
	outPaths[key] = value.map((path) => path.replace("src", "out/src"))
})

tsConfigPaths.register({
	baseUrl: baseUrl,
	paths: outPaths,
})

// Mock the @google/genai module to avoid ESM compatibility issues in tests
// The module is ES6 only, but the integration tests are compiled to commonJS.
const originalRequire = Module.prototype.require
Module.prototype.require = function (id) {
	// Intercept requires for @google/genai
	if (id === "@google/genai") {
		// Return the mock instead
		const mockPath = path.join(baseUrl, "out/src/core/api/providers/gemini-mock.test.js")
		return originalRequire.call(this, mockPath)
	}

	// The SDK packages are ESM-only and expose only an `import` condition.
	// Integration tests run the tsc-built `out/` tree as CommonJS in VS Code's
	// extension host, so `require("@cline/core")` fails before tests start.
	// Mock the small surface needed by legacy VS Code integration tests.
	if (id === "@cline/core") {
		class ProviderSettingsManager {
			constructor(_options) {
				this.state = { providers: {}, lastUsedProvider: undefined }
			}

			read() {
				return this.state
			}

			getLastUsedProviderSettings() {
				return undefined
			}

			getProviderSettings(_provider) {
				return undefined
			}

			saveProviderSettings(_settings, _options) {}
		}

		return {
			ClineCore: class {
				constructor() {
					this.runtimeAddress = undefined
					this.pendingPrompts = {
						list: async () => [],
						update: async () => ({ updated: false }),
						delete: async () => ({ updated: false }),
					}
				}

				static async create() {
					return new this()
				}

				async start() {
					return { sessionId: "test-session" }
				}

				async send() {
					return undefined
				}

				async getAccumulatedUsage() {
					return { usage: undefined }
				}

				async abort() {}
				async stop() {}
				async dispose() {}
				async get() {
					return undefined
				}
				async list() {
					return []
				}
				async listHistory() {
					return []
				}
				async delete() {
					return false
				}
				async readMessages() {
					return []
				}
				async update() {
					return { updated: false }
				}
				async ingestHookEvent() {}
				async updateSessionModel() {}
				subscribe() {
					return () => {}
				}
			},
			ProviderSettingsManager,
			resolveProviderConfig: async () => undefined,
			createDefaultExecutors: () => ({}),
			createMcpTools: () => ({}),
			createOAuthClientCallbacks: () => ({}),
			getValidClineCredentials: async () => undefined,
			loginClineOAuth: async () => undefined,
			loginOcaOAuth: async () => undefined,
			loginOpenAICodex: async () => undefined,
		}
	}

	if (id === "@cline/shared") {
		return {
			buildClineSystemPrompt: () => "",
			createTool: (tool) => tool,
		}
	}

	if (id === "@cline/llms") {
		return {
			getAllProviders: async () => [],
			getGeneratedModelsForProvider: () => ({}),
			MODEL_COLLECTIONS_BY_PROVIDER_ID: {},
		}
	}

	if (id === "vitest") {
		const assert = require("node:assert/strict")
		const makeMockFn = (implementation = () => undefined) => {
			const fn = (...args) => implementation(...args)
			fn.mock = { calls: [] }
			const wrapped = (...args) => {
				wrapped.mock.calls.push(args)
				return implementation(...args)
			}
			wrapped.mock = fn.mock
			wrapped.mockImplementation = (next) => {
				implementation = next
				return wrapped
			}
			wrapped.mockResolvedValue = (value) => wrapped.mockImplementation(() => Promise.resolve(value))
			wrapped.mockReturnValue = (value) => wrapped.mockImplementation(() => value)
			return wrapped
		}
		const expect = (actual) => ({
			toBe: (expected) => assert.equal(actual, expected),
			toEqual: (expected) => assert.deepEqual(actual, expected),
			toBeDefined: () => assert.notEqual(actual, undefined),
			toBeTruthy: () => assert.ok(actual),
			toBeGreaterThanOrEqual: (expected) => assert.ok(actual >= expected),
			toContain: (expected) => assert.ok(actual.includes(expected)),
			toHaveLength: (expected) => assert.equal(actual.length, expected),
			not: {
				toBe: (expected) => assert.notEqual(actual, expected),
				toContain: (expected) => assert.ok(!actual.includes(expected)),
			},
		})
		return {
			afterAll: globalThis.after ?? (() => undefined),
			afterEach: globalThis.afterEach ?? (() => undefined),
			beforeAll: globalThis.before ?? (() => undefined),
			beforeEach: globalThis.beforeEach ?? (() => undefined),
			describe: globalThis.describe ?? (() => undefined),
			expect,
			it: globalThis.it ?? (() => undefined),
			vi: {
				fn: makeMockFn,
				mock: () => undefined,
				mocked: (value) => value,
				clearAllMocks: () => undefined,
				restoreAllMocks: () => undefined,
			},
		}
	}

	return originalRequire.call(this, id)
}
