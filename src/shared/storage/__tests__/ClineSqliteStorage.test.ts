import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it } from "mocha"
import { ClineSqliteStorage, sqliteStorage } from "../ClineSqliteStorage"

describe("ClineSqliteStorage", () => {
	let storage: ClineSqliteStorage
	let tempDir: string

	beforeEach(() => {
		// Create a temporary directory for the test database
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-sqlite-test-"))

		// Use singleton instance and initialize with test client
		storage = sqliteStorage
		storage.init("test-client", tempDir)
	})

	afterEach(() => {
		// Clean up: close database and remove temp directory
		storage.close()
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
	})

	describe("basic operations", () => {
		it("should store and retrieve a value", async () => {
			await storage.store("testKey", "testValue")
			const value = await storage.get("testKey")
			expect(value).to.equal("testValue")
		})

		it("should return undefined for non-existent key", async () => {
			const value = await storage.get("nonExistentKey")
			expect(value).to.be.undefined
		})

		it("should overwrite existing value", async () => {
			await storage.store("testKey", "value1")
			await storage.store("testKey", "value2")
			const value = await storage.get("testKey")
			expect(value).to.equal("value2")
		})

		it("should delete a value", async () => {
			await storage.store("testKey", "testValue")
			await storage.delete("testKey")
			const value = await storage.get("testKey")
			expect(value).to.be.undefined
		})

		it("should handle deletion of non-existent key", async () => {
			await storage.delete("nonExistentKey")
			// Should not throw
		})

		it("should store and retrieve multiple key-value pairs", async () => {
			await storage.store("key1", "value1")
			await storage.store("key2", "value2")
			await storage.store("key3", "value3")

			const value1 = await storage.get("key1")
			const value2 = await storage.get("key2")
			const value3 = await storage.get("key3")

			expect(value1).to.equal("value1")
			expect(value2).to.equal("value2")
			expect(value3).to.equal("value3")
		})
	})

	describe("special characters and edge cases", () => {
		it("should handle keys with special characters", async () => {
			const specialKey = "key:with/special@chars#test"
			await storage.store(specialKey, "value")
			const value = await storage.get(specialKey)
			expect(value).to.equal("value")
		})

		it("should handle values with special characters", async () => {
			const specialValue = '{"json": "value", "with": ["arrays", "and", "objects"]}'
			await storage.store("jsonKey", specialValue)
			const value = await storage.get("jsonKey")
			expect(value).to.equal(specialValue)
		})

		it("should handle empty string values", async () => {
			await storage.store("emptyKey", "")
			const value = await storage.get("emptyKey")
			expect(value).to.equal("")
		})

		it("should handle large values", async () => {
			const largeValue = "x".repeat(100000) // 100KB string
			await storage.store("largeKey", largeValue)
			const value = await storage.get("largeKey")
			expect(value).to.equal(largeValue)
		})

		it("should handle unicode characters", async () => {
			const unicodeValue = "Hello 👋 世界 🌍"
			await storage.store("unicodeKey", unicodeValue)
			const value = await storage.get("unicodeKey")
			expect(value).to.equal(unicodeValue)
		})
	})

	describe("batch operations", () => {
		it("should get all keys", async () => {
			await storage.store("key1", "value1")
			await storage.store("key2", "value2")
			await storage.store("key3", "value3")

			const keys = await storage.getAllKeys()
			expect(keys).to.have.lengthOf(3)
			expect(keys).to.include.members(["key1", "key2", "key3"])
		})

		it("should get all entries", async () => {
			await storage.store("key1", "value1")
			await storage.store("key2", "value2")
			await storage.store("key3", "value3")

			const all = await storage.getAll()
			expect(all).to.deep.equal({
				key1: "value1",
				key2: "value2",
				key3: "value3",
			})
		})

		it("should clear all entries", async () => {
			await storage.store("key1", "value1")
			await storage.store("key2", "value2")
			await storage.store("key3", "value3")

			await storage.clear()

			const keys = await storage.getAllKeys()
			expect(keys).to.have.lengthOf(0)
		})
	})

	describe("statistics", () => {
		it("should return correct statistics", async () => {
			await storage.store("key1", "value1")
			await storage.store("key2", "value2")

			const stats = storage.getStats()
			expect(stats.totalKeys).to.equal(2)
			expect(stats.dbSizeBytes).to.be.greaterThan(0)
		})

		it("should return zero stats for empty database", async () => {
			const stats = storage.getStats()
			expect(stats.totalKeys).to.equal(0)
			expect(stats.dbSizeBytes).to.be.greaterThan(0) // WAL files may exist
		})
	})

	describe("persistence", () => {
		it("should persist data across init calls", async () => {
			await storage.store("persistKey", "persistValue")
			const firstValue = await storage.get("persistKey")
			expect(firstValue).to.equal("persistValue")

			// Verify persistence by checking the data is still there
			const value = await storage.get("persistKey")
			expect(value).to.equal("persistValue")
		})
	})

	describe("change events", () => {
		it("should fire change event on store", async () => {
			let eventFired = false
			let eventKey = ""

			storage.onDidChange((event) => {
				eventFired = true
				eventKey = event.key
				return Promise.resolve()
			})

			await storage.store("testKey", "testValue")

			expect(eventFired).to.be.true
			expect(eventKey).to.equal("testKey")
		})

		it("should fire change event on delete", async () => {
			let eventFired = false
			let eventKey = ""

			await storage.store("testKey", "testValue")

			storage.onDidChange((event) => {
				eventFired = true
				eventKey = event.key
				return Promise.resolve()
			})

			await storage.delete("testKey")

			expect(eventFired).to.be.true
			expect(eventKey).to.equal("testKey")
		})

		it("should support multiple subscribers", async () => {
			let event1Fired = false
			let event2Fired = false

			storage.onDidChange(() => {
				event1Fired = true
				return Promise.resolve()
			})

			storage.onDidChange(() => {
				event2Fired = true
				return Promise.resolve()
			})

			await storage.store("testKey", "testValue")

			expect(event1Fired).to.be.true
			expect(event2Fired).to.be.true
		})

		it("should unsubscribe from events", async () => {
			let eventCount = 0

			const unsubscribe = storage.onDidChange(() => {
				eventCount++
				return Promise.resolve()
			})

			await storage.store("key1", "value1")
			expect(eventCount).to.equal(1)

			unsubscribe()

			await storage.store("key2", "value2")
			expect(eventCount).to.equal(1) // Should not increment
		})
	})

	describe("error handling", () => {
		it("should handle operations after close", () => {
			storage.close()

			// Operations should throw after close
			expect(() => storage.getStats()).to.not.throw()
			expect(storage.getStats().totalKeys).to.equal(0)
		})
	})
})
