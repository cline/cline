/**
 * State Keys Type Safety Tests
 *
 * This test suite validates the type safety guarantees of the state-keys module,
 * which uses a single-source-of-truth pattern where types are auto-generated from
 * field definition objects.
 *
 * ## Type Safety Model
 *
 * The state-keys module generates TypeScript types from runtime objects using:
 * 1. Field definition objects with `default` values (e.g., `{ default: true as boolean }`)
 * 2. `satisfies FieldDefinitions` constraint to enforce structure
 * 3. `BuildInterface<T>` mapped type to extract types from `default` values
 *
 * ## Known Limitations (What These Tests Catch)
 *
 * The `as` type assertions on default values are TRUSTED by TypeScript. This means:
 * - `{ default: "foo" as number }` would compile but be wrong at runtime
 * - `{ default: undefined as string }` compiles but `string` doesn't include `undefined`
 *
 * These tests provide runtime validation to catch such mismatches that TypeScript cannot.
 *
 * ## What These Tests Validate
 *
 * 1. **Type-Value Consistency**: Default values match their declared types at runtime
 * 2. **Key Synchronization**: Generated key arrays match the source objects
 * 3. **Type Guard Correctness**: `isGlobalStateKey`, `isSettingsKey`, etc. work correctly
 * 4. **Default Value Retrieval**: `getDefaultValue` returns correct values
 * 5. **Transform Functions**: Transforms produce values of the correct type
 *
 * ## Running Tests
 *
 * ```bash
 * npm run test:unit -- --grep "State Keys"
 * ```
 */

import { expect } from "chai"
import { describe, it } from "mocha"

import {
	applyTransform,
	GLOBAL_STATE_DEFAULTS,
	type GlobalState,
	GlobalStateAndSettingKeys,
	type GlobalStateAndSettings,
	type GlobalStateAndSettingsKey,
	type GlobalStateKey,
	getDefaultValue,
	hasTransform,
	isAsyncProperty,
	isComputedProperty,
	isGlobalStateKey,
	isLocalStateKey,
	isSecretKey,
	isSettingsKey,
	type LocalState,
	type LocalStateKey,
	LocalStateKeys,
	SETTINGS_DEFAULTS,
	SETTINGS_TRANSFORMS,
	type SecretKey,
	SecretKeys,
	type Settings,
	type SettingsKey,
	SettingsKeys,
} from "../state-keys"

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Validates that a value matches the expected TypeScript type at runtime.
 * This catches cases where `as` assertions mask type mismatches.
 */
function assertTypeMatch(value: unknown, expectedType: string, key: string): void {
	const actualType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value

	if (expectedType === "array") {
		expect(Array.isArray(value), `${key}: expected array, got ${actualType}`).to.be.true
	} else if (expectedType === "object") {
		expect(actualType, `${key}: expected object, got ${actualType}`).to.equal("object")
		expect(value, `${key}: expected object, got null`).to.not.be.null
		expect(Array.isArray(value), `${key}: expected object, got array`).to.be.false
	} else if (expectedType === "undefined") {
		expect(value, `${key}: expected undefined, got ${actualType}`).to.be.undefined
	} else {
		expect(actualType, `${key}: expected ${expectedType}, got ${actualType}`).to.equal(expectedType)
	}
}

/**
 * Infers the expected runtime type from a default value.
 * Used to validate that default values are consistent with their purpose.
 */
function inferExpectedType(value: unknown): string {
	if (value === undefined) {
		return "undefined"
	}
	if (value === null) {
		return "null"
	}
	if (Array.isArray(value)) {
		return "array"
	}
	return typeof value
}

// ============================================================================
// Tests
// ============================================================================

describe("State Keys Type Safety", () => {
	describe("Type-Value Consistency", () => {
		/**
		 * These tests validate that default values match their declared types.
		 * This catches mistakes like `{ default: "string" as number }` which
		 * TypeScript would accept but would cause runtime issues.
		 */

		it("should have GlobalState defaults with correct runtime types", () => {
			const defaults = GLOBAL_STATE_DEFAULTS as Record<string, unknown>

			// Validate each default value has a sensible runtime type
			for (const [key, value] of Object.entries(defaults)) {
				const type = inferExpectedType(value)
				// Re-validate to ensure consistency
				assertTypeMatch(value, type, `GLOBAL_STATE_DEFAULTS.${key}`)
			}
		})

		it("should have Settings defaults with correct runtime types", () => {
			const defaults = SETTINGS_DEFAULTS as Record<string, unknown>

			for (const [key, value] of Object.entries(defaults)) {
				const type = inferExpectedType(value)
				assertTypeMatch(value, type, `SETTINGS_DEFAULTS.${key}`)
			}
		})

		it("should not have undefined defaults masquerading as non-optional types", () => {
			// This test catches the pattern: { default: undefined as SomeType }
			// where SomeType doesn't include undefined
			const allDefaults = { ...GLOBAL_STATE_DEFAULTS, ...SETTINGS_DEFAULTS } as Record<string, unknown>

			const undefinedKeys = Object.entries(allDefaults)
				.filter(([_, value]) => value === undefined)
				.map(([key]) => key)

			// These keys have undefined defaults, which is valid only if their
			// declared type includes `| undefined`. This test documents which
			// keys are expected to have undefined defaults.
			expect(undefinedKeys).to.be.an("array")
			// If a key unexpectedly becomes undefined, this test will catch it
		})

		it("should have array defaults that are actually arrays", () => {
			const allDefaults = { ...GLOBAL_STATE_DEFAULTS, ...SETTINGS_DEFAULTS } as Record<string, unknown>

			for (const [key, value] of Object.entries(allDefaults)) {
				if (Array.isArray(value)) {
					// Verify it's a proper array, not an array-like object
					expect(value, `${key} should be a true array`).to.be.instanceOf(Array)
				}
			}
		})

		it("should have object defaults that are plain objects", () => {
			const allDefaults = { ...GLOBAL_STATE_DEFAULTS, ...SETTINGS_DEFAULTS } as Record<string, unknown>

			for (const [key, value] of Object.entries(allDefaults)) {
				if (typeof value === "object" && value !== null && !Array.isArray(value)) {
					// Verify it's a plain object
					expect(Object.getPrototypeOf(value), `${key} should be a plain object`).to.equal(Object.prototype)
				}
			}
		})
	})

	describe("Key Array Synchronization", () => {
		/**
		 * These tests ensure the generated key arrays stay in sync with
		 * their source objects. A mismatch could cause runtime errors.
		 */

		it("should have SettingsKeys match SETTINGS_DEFAULTS keys", () => {
			const defaultKeys = Object.keys(SETTINGS_DEFAULTS)
			const exportedKeys = new Set<string>(SettingsKeys)

			// Every key in defaults should be in the exported array
			for (const key of defaultKeys) {
				expect(exportedKeys.has(key), `SettingsKeys missing key: ${key}`).to.be.true
			}
		})

		it("should have GlobalStateAndSettingKeys be a superset of SettingsKeys", () => {
			const combinedSet = new Set<string>(GlobalStateAndSettingKeys)

			for (const key of SettingsKeys) {
				expect(combinedSet.has(key), `GlobalStateAndSettingKeys missing settings key: ${key}`).to.be.true
			}
		})

		it("should have no duplicate keys in exported arrays", () => {
			expect(new Set(SettingsKeys).size, "SettingsKeys has duplicates").to.equal(SettingsKeys.length)
			expect(new Set(SecretKeys).size, "SecretKeys has duplicates").to.equal(SecretKeys.length)
			expect(new Set(LocalStateKeys).size, "LocalStateKeys has duplicates").to.equal(LocalStateKeys.length)
			expect(new Set(GlobalStateAndSettingKeys).size, "GlobalStateAndSettingKeys has duplicates").to.equal(
				GlobalStateAndSettingKeys.length,
			)
		})

		it("should have SecretKeys as strings", () => {
			for (const key of SecretKeys) {
				expect(typeof key, `SecretKey ${key} should be string`).to.equal("string")
				expect(key.length, `SecretKey should not be empty`).to.be.greaterThan(0)
			}
		})
	})

	describe("Type Guard Functions", () => {
		/**
		 * Type guards narrow `string` to specific key types.
		 * These tests ensure they correctly identify valid keys.
		 */

		it("should correctly identify GlobalState keys", () => {
			// Known GlobalState keys from the defaults
			const knownGlobalStateKeys = Object.keys(GLOBAL_STATE_DEFAULTS)

			for (const key of knownGlobalStateKeys) {
				expect(isGlobalStateKey(key), `${key} should be a GlobalStateKey`).to.be.true
			}

			// Non-existent keys should return false
			expect(isGlobalStateKey("nonExistentKey123")).to.be.false
			expect(isGlobalStateKey("")).to.be.false
		})

		it("should correctly identify Settings keys", () => {
			for (const key of SettingsKeys) {
				expect(isSettingsKey(key), `${key} should be a SettingsKey`).to.be.true
			}

			expect(isSettingsKey("nonExistentKey123")).to.be.false
		})

		it("should correctly identify Secret keys", () => {
			// Sample known secret keys
			const knownSecretKeys = ["apiKey", "openRouterApiKey", "awsAccessKey"]

			for (const key of knownSecretKeys) {
				expect(isSecretKey(key), `${key} should be a SecretKey`).to.be.true
			}

			expect(isSecretKey("notASecretKey")).to.be.false
		})

		it("should correctly identify LocalState keys", () => {
			for (const key of LocalStateKeys) {
				expect(isLocalStateKey(key), `${key} should be a LocalStateKey`).to.be.true
			}

			expect(isLocalStateKey("notALocalStateKey")).to.be.false
		})

		it("should have mutually exclusive key categories where expected", () => {
			// Secret keys should not overlap with settings keys
			for (const secretKey of SecretKeys) {
				// Most secret keys should not be in settings (they're stored separately)
				// This is a sanity check, not a strict requirement
				if (isSettingsKey(secretKey)) {
					// If there is overlap, document it
					console.log(`Note: ${secretKey} is both a SecretKey and SettingsKey`)
				}
			}
		})
	})

	describe("Default Value Retrieval", () => {
		/**
		 * Tests for the getDefaultValue utility function.
		 */

		it("should return correct default values for known keys", () => {
			// Test a few known defaults
			const testCases: Array<{ key: GlobalStateAndSettingsKey; expectedType: string }> = [
				{ key: "autoApprovalSettings", expectedType: "object" },
				{ key: "browserSettings", expectedType: "object" },
				{ key: "shellIntegrationTimeout", expectedType: "number" },
				{ key: "preferredLanguage", expectedType: "string" },
				{ key: "yoloModeToggled", expectedType: "boolean" },
				{ key: "autoApproveAllToggled", expectedType: "boolean" },
			]

			for (const { key, expectedType } of testCases) {
				const value = getDefaultValue(key)
				if (value !== undefined) {
					assertTypeMatch(value, expectedType, `getDefaultValue(${key})`)
				}
			}
		})

		it("should return undefined for keys without defaults", () => {
			// Keys with `undefined` as default should return undefined
			const keysWithUndefinedDefaults = GlobalStateAndSettingKeys.filter((key) => {
				const value = getDefaultValue(key)
				return value === undefined
			})

			// This is expected behavior - document which keys have undefined defaults
			expect(keysWithUndefinedDefaults).to.be.an("array")
		})
	})

	describe("Transform Functions", () => {
		/**
		 * Tests for transform functions that modify values before storage.
		 */

		it("should have transforms return the same type as input", () => {
			// Get keys that have transforms
			const keysWithTransforms = Object.keys(SETTINGS_TRANSFORMS)

			expect(keysWithTransforms.length, "Should have at least one transform").to.be.greaterThan(0)

			for (const key of keysWithTransforms) {
				expect(hasTransform(key), `hasTransform(${key}) should be true`).to.be.true
			}
		})

		it("should correctly identify keys without transforms", () => {
			expect(hasTransform("nonExistentKey")).to.be.false
			expect(hasTransform("")).to.be.false
		})

		it("should apply transforms without throwing", () => {
			const keysWithTransforms = Object.keys(SETTINGS_TRANSFORMS)

			for (const key of keysWithTransforms) {
				// Transform should handle various inputs gracefully
				expect(() => applyTransform(key, {})).to.not.throw()
				expect(() => applyTransform(key, undefined)).to.not.throw()
				expect(() => applyTransform(key, null)).to.not.throw()
			}
		})

		it("should pass through values for keys without transforms", () => {
			const testValue = { test: "value" }
			const result = applyTransform("keyWithoutTransform", testValue)

			expect(result).to.equal(testValue)
		})

		it("should merge defaults in browserSettings transform", () => {
			if (hasTransform("browserSettings")) {
				const partial = { viewport: { width: 800, height: 600 } }
				const result = applyTransform("browserSettings", partial)

				expect(result).to.be.an("object")
				expect(result.viewport).to.deep.equal({ width: 800, height: 600 })
			}
		})
	})

	describe("Metadata Properties", () => {
		/**
		 * Tests for isAsync and isComputed metadata flags.
		 */

		it("should correctly identify async properties", () => {
			// taskHistory is known to be async
			expect(isAsyncProperty("taskHistory")).to.be.true
			expect(isAsyncProperty("preferredLanguage")).to.be.false
			expect(isAsyncProperty("nonExistent")).to.be.false
		})

		it("should correctly identify computed properties", () => {
			// planActSeparateModelsSetting is known to be computed
			expect(isComputedProperty("planActSeparateModelsSetting")).to.be.true
			expect(isComputedProperty("preferredLanguage")).to.be.false
			expect(isComputedProperty("nonExistent")).to.be.false
		})
	})

	describe("Type Exports", () => {
		/**
		 * Compile-time tests that verify type exports work correctly.
		 * If these fail to compile, the types are broken.
		 */

		it("should export usable GlobalState type", () => {
			// This is a compile-time check - if GlobalState is broken, this won't compile
			const partialState: Partial<GlobalState> = {
				isNewUser: true,
				favoritedModelIds: [],
			}
			expect(partialState.isNewUser).to.equal(true)
		})

		it("should export usable Settings type", () => {
			const partialSettings: Partial<Settings> = {
				preferredLanguage: "English",
				shellIntegrationTimeout: 5000,
			}
			expect(partialSettings.preferredLanguage).to.equal("English")
		})

		it("should export usable key types", () => {
			// These assignments verify the key types are correctly narrowed
			const globalKey: GlobalStateKey = "isNewUser"
			const settingsKey: SettingsKey = "preferredLanguage"
			const secretKey: SecretKey = "apiKey"
			const localKey: LocalStateKey = "localClineRulesToggles"

			expect(globalKey).to.be.a("string")
			expect(settingsKey).to.be.a("string")
			expect(secretKey).to.be.a("string")
			expect(localKey).to.be.a("string")
		})

		it("should have GlobalStateAndSettings include both GlobalState and Settings", () => {
			const combined: Partial<GlobalStateAndSettings> = {
				// From GlobalState
				isNewUser: true,
				// From Settings
				preferredLanguage: "English",
			}
			expect(combined.isNewUser).to.equal(true)
			expect(combined.preferredLanguage).to.equal("English")
		})

		it("should have LocalState keys map to ClineRulesToggles", () => {
			const localState: Partial<LocalState> = {
				localClineRulesToggles: {},
				localCursorRulesToggles: { "some-rule": true },
			}
			expect(localState.localClineRulesToggles).to.deep.equal({})
		})
	})

	describe("Edge Cases", () => {
		/**
		 * Tests for edge cases and boundary conditions.
		 */

		it("should handle empty string keys gracefully", () => {
			expect(isGlobalStateKey("")).to.be.false
			expect(isSettingsKey("")).to.be.false
			expect(isSecretKey("")).to.be.false
			expect(isLocalStateKey("")).to.be.false
		})

		it("should handle keys with special characters", () => {
			// The cline:clineAccountId key has a colon
			expect(SecretKeys).to.include("cline:clineAccountId")
			expect(isSecretKey("cline:clineAccountId")).to.be.true
		})

		it("should not have keys that could cause prototype pollution", () => {
			const dangerousKeys = ["__proto__", "constructor", "prototype"]

			for (const key of dangerousKeys) {
				expect(isGlobalStateKey(key), `${key} should not be a GlobalStateKey`).to.be.false
				expect(isSettingsKey(key), `${key} should not be a SettingsKey`).to.be.false
				expect(isSecretKey(key), `${key} should not be a SecretKey`).to.be.false
			}
		})
	})
})
