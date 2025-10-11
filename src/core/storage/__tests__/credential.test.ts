import { spawnSync } from "node:child_process"
import * as os from "node:os"
import { expect } from "chai"
import * as sinon from "sinon"
import { ErrorService } from "@/services/error"
import { Logger } from "@/services/logging/Logger"
import { CredentialStorage } from "../credential"

const platform = os.platform()

function hasCommand(cmd: string): boolean {
	if (process.platform === "win32") {
		return true
	}
	const result = spawnSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" })
	return result.status === 0
}

// Only run on macOS for now; skip Windows/Linux
const shouldSkip = platform !== "darwin" || !hasCommand("security")

describe("CredentialStorage", () => {
	if (shouldSkip) {
		console.warn("Skipping CredentialStorage tests: Windows covered via E2E; or OS tool missing")
		return
	}

	let sandbox: sinon.SinonSandbox
	let store: CredentialStorage
	let testKey: string

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		// Mock Logger methods to avoid HostProvider dependency
		sandbox.stub(Logger, "info").returns()
		sandbox.stub(Logger, "error").returns()
		// Mock ErrorService to avoid telemetry dependency
		const mockErrorService = {
			logMessage: sandbox.stub(),
			logException: sandbox.stub(),
			toClineError: sandbox.stub(),
			isEnabled: sandbox.stub().returns(false),
			getSettings: sandbox.stub().returns({ enabled: false, hostEnabled: false }),
			getProvider: sandbox.stub(),
			dispose: sandbox.stub().resolves(),
		}
		sandbox.stub(ErrorService, "initialize").resolves(mockErrorService as any)
		sandbox.stub(ErrorService, "get").returns(mockErrorService as any)
		await ErrorService.initialize()
		store = new CredentialStorage()
		// Generate unique key for each test to avoid conflicts
		testKey = `e2e_secret_${Date.now()}_${Math.random().toString(36).substring(7)}`
	})

	afterEach(async () => {
		// Clean up any test credentials
		try {
			await store.delete(testKey)
		} catch {
			// Ignore errors during cleanup
		}
		sandbox.restore()
	})

	describe("Basic operations", () => {
		it("should store and retrieve a credential", async () => {
			const value = "test-secret"

			// Store the credential
			await store.store(testKey, value)

			// Retrieve and verify
			const fetched = await store.get(testKey)
			expect(fetched).to.equal(value)
		})

		it("should delete a credential", async () => {
			const value = "test-secret-to-delete"

			// Store the credential
			await store.store(testKey, value)

			// Verify it exists
			const beforeDelete = await store.get(testKey)
			expect(beforeDelete).to.equal(value)

			// Delete the credential
			await store.delete(testKey)

			// Verify it's deleted
			const afterDelete = await store.get(testKey)
			expect(afterDelete).to.be.undefined
		})

		it("should return undefined for non-existent keys", async () => {
			const nonExistentKey = `non_existent_${Date.now()}`

			const result = await store.get(nonExistentKey)
			expect(result).to.be.undefined
		})

		it("should handle updating an existing credential", async () => {
			const initialValue = "initial-secret"
			const updatedValue = "updated-secret"

			// Store initial value
			await store.store(testKey, initialValue)

			// Verify initial value
			const initial = await store.get(testKey)
			expect(initial).to.equal(initialValue)

			// Delete the existing credential first (required on some platforms)
			await store.delete(testKey)

			// Store new value
			await store.store(testKey, updatedValue)

			// Verify updated value
			const updated = await store.get(testKey)
			expect(updated).to.equal(updatedValue)
		})
	})

	describe("Edge cases", () => {
		it("should handle empty string values", async () => {
			const emptyValue = ""

			await store.store(testKey, emptyValue)
			const fetched = await store.get(testKey)

			// Note: Some credential stores might treat empty strings differently
			// This test documents the actual behavior
			expect(fetched).to.satisfy((val: string | undefined) => val === emptyValue || val === undefined)
		})

		it("should handle special characters in values", async () => {
			const specialValue = "test!@#$%^&*()_+-=[]{}|;':\",./<>?"

			await store.store(testKey, specialValue)
			const fetched = await store.get(testKey)
			expect(fetched).to.equal(specialValue)
		})

		it("should handle long values", async () => {
			const longValue = "a".repeat(1000)

			await store.store(testKey, longValue)
			const fetched = await store.get(testKey)
			expect(fetched).to.equal(longValue)
		})

		it("should handle special characters in keys", async () => {
			const specialKey = `test_key_with-special.chars_${Date.now()}`
			const value = "test-value"

			try {
				await store.store(specialKey, value)
				const fetched = await store.get(specialKey)
				expect(fetched).to.equal(value)
			} finally {
				// Clean up
				try {
					await store.delete(specialKey)
				} catch {
					// Ignore cleanup errors
				}
			}
		})
	})

	describe("Error handling", () => {
		it("should handle delete of non-existent key gracefully", async () => {
			const nonExistentKey = `non_existent_delete_${Date.now()}`

			// Should not throw an error
			try {
				await store.delete(nonExistentKey)
				// If we reach here, the operation succeeded without throwing
				expect(true).to.be.true
			} catch (error) {
				// If an error is thrown, fail the test
				expect.fail(`Expected delete to not throw, but got: ${error}`)
			}
		})

		it("should handle concurrent operations", async () => {
			const value1 = "value1"
			const value2 = "value2"
			const key1 = `${testKey}_1`
			const key2 = `${testKey}_2`

			try {
				// Perform multiple operations concurrently
				await Promise.all([store.store(key1, value1), store.store(key2, value2), store.get(key1), store.get(key2)])

				// Verify stored values
				const fetched1 = await store.get(key1)
				const fetched2 = await store.get(key2)

				expect(fetched1).to.equal(value1)
				expect(fetched2).to.equal(value2)
			} finally {
				// Clean up
				await Promise.all([store.delete(key1).catch(() => {}), store.delete(key2).catch(() => {})])
			}
		})
	})

	describe("Platform-specific behavior", () => {
		it(`should work correctly on ${platform}`, async () => {
			const platformSpecificValue = `${platform}-specific-value`

			await store.store(testKey, platformSpecificValue)
			const fetched = await store.get(testKey)
			expect(fetched).to.equal(platformSpecificValue)
		})
	})
})
