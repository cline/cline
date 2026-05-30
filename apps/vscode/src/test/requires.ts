const Module = require("module")
const originalRequire = Module.prototype.require

/**
 * Load the real `@cline/llms` module for unit tests.
 *
 * `@cline/llms` ships as ESM with an `exports` map that exposes only an
 * `import` condition, so `require("@cline/llms")` fails under the CommonJS
 * Mocha + ts-node harness. Node (>= 22, matching the repo's `.nvmrc`) can
 * `require()` an ESM module when pointed straight at its file, so resolve the
 * package's entry from its `package.json` and require it by absolute path,
 * bypassing the exports map. Provider handlers and their tests depend on the
 * real SDK model catalog, so a stub would not exercise their behavior.
 */
let cachedClineLlms: unknown
function loadRealClineLlms(): unknown {
	if (cachedClineLlms === undefined) {
		const nodePath = require("node:path") as typeof import("node:path")
		const nodeFs = require("node:fs") as typeof import("node:fs")
		// Find the @cline/llms package directory by walking up from this file
		// to the nearest node_modules that contains it. The package's exports
		// map exposes only an import condition and does not expose package.json,
		// so require.resolve cannot be used to locate it.
		let dir = __dirname
		let pkgDir: string | undefined
		while (true) {
			const candidate = nodePath.join(dir, "node_modules", "@cline", "llms")
			if (nodeFs.existsSync(nodePath.join(candidate, "package.json"))) {
				pkgDir = candidate
				break
			}
			const parent = nodePath.dirname(dir)
			if (parent === dir) {
				break
			}
			dir = parent
		}
		if (!pkgDir) {
			throw new Error("Unable to locate the @cline/llms package for unit tests")
		}
		const pkg = originalRequire.call(module, nodePath.join(pkgDir, "package.json")) as {
			module?: string
			main?: string
		}
		const entry = nodePath.join(pkgDir, pkg.module ?? pkg.main ?? "dist/index.js")
		// Require the ESM entry by absolute path so the package's import-only
		// `exports` map does not reject the lookup.
		cachedClineLlms = originalRequire.call(module, entry)
	}
	return cachedClineLlms
}

/**
 * VSCode is not available during unit tests
 * @see {@link file://./vscode-mock.ts}
 */
Module.prototype.require = function (path: string) {
	if (path === "vscode") {
		return require("./vscode-mock")
	}
	// Avoid pulling in VSCode-integrated checkpoint/editor code during unit tests
	if (path === "@integrations/checkpoints") {
		return {}
	}
	if (path === "@integrations/checkpoints/MultiRootCheckpointManager") {
		return { MultiRootCheckpointManager: class {} }
	}
	// @cline/core is ESM-only. Unit tests run through Mocha + ts-node in CommonJS mode,
	// so requiring SDK adapter modules would otherwise make Mocha fall back to native
	// ESM loading and bypass tsconfig-paths aliases such as @shared/*.
	if (path === "@cline/core") {
		const createNoopTelemetry = () => ({
			setDistinctId() {},
			setMetadata() {},
			updateMetadata() {},
			setCommonProperties() {},
			updateCommonProperties() {},
			isEnabled: () => false,
			capture() {},
			captureRequired() {},
			recordCounter() {},
			recordHistogram() {},
			recordGauge() {},
			flush: async () => {},
			dispose: async () => {},
		})

		class ProviderSettingsManager {
			private state = { providers: {}, lastUsedProvider: undefined }

			constructor(_options?: unknown) {}

			read() {
				return this.state
			}

			getLastUsedProviderSettings() {
				return undefined
			}

			getProviderSettings(_provider: string) {
				return undefined
			}

			saveProviderSettings(_settings: unknown, _options?: unknown) {}
		}

		return {
			createClineTelemetryServiceConfig: (config: Record<string, unknown> = {}) => ({
				enabled: false,
				metadata: {
					extension_version: "test",
					cline_type: "test",
					platform: "test",
					platform_version: "test",
					os_type: "test",
					os_version: "test",
				},
				...config,
			}),
			createConfiguredTelemetryHandle: () => ({
				telemetry: createNoopTelemetry(),
				flush: async () => {},
				dispose: async () => {},
			}),
			ClineCore: class {
				static async create() {
					return new this()
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
	if (path === "@cline/shared") {
		return {
			buildClineSystemPrompt: () => "",
			createTool: (tool: unknown) => tool,
		}
	}
	if (path === "@cline/llms") {
		return loadRealClineLlms()
	}
	if (path === "vitest") {
		const assert = require("node:assert/strict")
		const makeMockFn = (implementation: (...args: unknown[]) => unknown = () => undefined) => {
			const fn: any = (...args: unknown[]) => implementation(...args)
			fn.mockImplementation = (next: (...args: unknown[]) => unknown) => {
				implementation = next
				return fn
			}
			fn.mockResolvedValue = (value: unknown) => fn.mockImplementation(() => Promise.resolve(value))
			fn.mockReturnValue = (value: unknown) => fn.mockImplementation(() => value)
			return fn
		}
		const expect = (actual: unknown) => ({
			toBe: (expected: unknown) => assert.equal(actual, expected),
			toEqual: (expected: unknown) => assert.deepEqual(actual, expected),
			toBeDefined: () => assert.notEqual(actual, undefined),
			toBeTruthy: () => assert.ok(actual),
			toBeGreaterThanOrEqual: (expected: number) => assert.ok((actual as number) >= expected),
			toContain: (expected: unknown) => assert.ok((actual as { includes(value: unknown): boolean }).includes(expected)),
			toHaveLength: (expected: number) => assert.equal((actual as { length: number }).length, expected),
			not: {
				toBe: (expected: unknown) => assert.notEqual(actual, expected),
				toContain: (expected: unknown) =>
					assert.ok(!(actual as { includes(value: unknown): boolean }).includes(expected)),
			},
		})
		const mochaGlobals = globalThis as any
		return {
			afterAll: mochaGlobals.after ?? (() => undefined),
			afterEach: mochaGlobals.afterEach ?? (() => undefined),
			beforeAll: mochaGlobals.before ?? (() => undefined),
			beforeEach: mochaGlobals.beforeEach ?? (() => undefined),
			describe: mochaGlobals.describe ?? (() => undefined),
			expect,
			it: mochaGlobals.it ?? (() => undefined),
			vi: {
				fn: makeMockFn,
				mock: () => undefined,
				clearAllMocks: () => undefined,
				restoreAllMocks: () => undefined,
			},
		}
	}

	return originalRequire.call(this, path)
}

// Required to have access to String.prototype.toPosix
import "../utils/path"
