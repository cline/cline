const Module = require("module")
const originalRequire = Module.prototype.require

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
			ClineCore: class {
				static async create() {
					return new this()
				}
			},
			ProviderSettingsManager,
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
	if (path === "vitest") {
		const assert = require("node:assert/strict")
		const expect = (actual: unknown) => ({
			toBe: (expected: unknown) => assert.equal(actual, expected),
			toEqual: (expected: unknown) => assert.deepEqual(actual, expected),
			toHaveLength: (expected: number) => assert.equal((actual as { length: number }).length, expected),
			not: {
				toBe: (expected: unknown) => assert.notEqual(actual, expected),
			},
		})
		return {
			afterEach,
			beforeEach,
			describe,
			expect,
			it,
			vi: {
				fn: () => () => undefined,
				mock: () => undefined,
			},
		}
	}

	return originalRequire.call(this, path)
}

// Required to have access to String.prototype.toPosix
import "../utils/path"
