import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ClineJsonlStorage } from "./ClineJsonlStorage"

describe("ClineJsonlStorage", () => {
	let tmpDir: string
	let store: ClineJsonlStorage

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-jsonl-test-"))
		store = new ClineJsonlStorage(path.join(tmpDir, "test.jsonl"), {
			compactThreshold: 100, // compact after 100 entries
		})
	})

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true })
	})

	it("should store and retrieve a value", () => {
		store.set("hello", "world")
		expect(store.get("hello")).toBe("world")
	})

	it("should return undefined for missing keys", () => {
		expect(store.get("nonexistent")).toBeUndefined()
	})

	it("should overwrite existing keys", () => {
		store.set("key1", "value1")
		store.set("key1", "value2")
		expect(store.get("key1")).toBe("value2")
	})

	it("should delete keys", () => {
		store.set("key1", "value1")
		store.delete("key1")
		expect(store.get("key1")).toBeUndefined()
	})

	it("should set multiple entries via setBatch", () => {
		store.setBatch({ a: 1, b: "two", c: true })
		expect(store.get("a")).toBe(1)
		expect(store.get("b")).toBe("two")
		expect(store.get("c")).toBe(true)
	})

	it("should read all entries", () => {
		store.set("x", 10)
		store.set("y", 20)
		const all = store.readAll()
		expect(all).toEqual({ x: 10, y: 20 })
	})

	it("should persist values across instances", () => {
		const filePath = path.join(tmpDir, "persist.jsonl")
		const s1 = new ClineJsonlStorage(filePath)
		s1.set("persist-key", "persist-value")

		const s2 = new ClineJsonlStorage(filePath)
		expect(s2.get("persist-key")).toBe("persist-value")
	})

	it("should compact and reduce entry count", () => {
		// Write many entries for the same key
		for (let i = 0; i < 50; i++) {
			store.set("volatile", i)
		}
		// Last write wins
		expect(store.get("volatile")).toBe(49)

		// Compact
		store.compact()

		// After compact, `getEntryCount` should be ~1 (only one unique key)
		expect(store.getEntryCount()).toBe(1)
		expect(store.get("volatile")).toBe(49)

		// File should still be valid
		const s2 = new ClineJsonlStorage(store["fsPath"] as any)
		expect(s2.get("volatile")).toBe(49)
	})

	it("should auto-compact when threshold is reached", () => {
		// Set compactThreshold to 10; write 15 entries with different keys
		const store2 = new ClineJsonlStorage(path.join(tmpDir, "auto-compact.jsonl"), {
			compactThreshold: 10,
		})
		for (let i = 0; i < 15; i++) {
			store2.set(`key-${i}`, i)
		}

		// Auto-compact runs on microtask; wait for it
		const waiter = new Promise<void>((resolve) => queueMicrotask(resolve))
		return waiter.then(() => {
			// After compact, entry count should be 15 unique keys
			expect(store2.getEntryCount()).toBe(15)
			expect(store2.get("key-14")).toBe(14)
		})
	})

	it("should handle empty file gracefully", () => {
		const filePath = path.join(tmpDir, "empty.jsonl")
		fs.writeFileSync(filePath, "")
		const s = new ClineJsonlStorage(filePath)
		expect(s.readAll()).toEqual({})
		expect(s.get("anything")).toBeUndefined()
	})

	it("should handle missing file gracefully", () => {
		const filePath = path.join(tmpDir, "missing.jsonl")
		const s = new ClineJsonlStorage(filePath)
		expect(s.readAll()).toEqual({})
		expect(s.get("anything")).toBeUndefined()
	})

	it("should skip corrupt lines and report them via diagnostics", () => {
		const filePath = path.join(tmpDir, "corrupt.jsonl")
		fs.writeFileSync(
			filePath,
			'{"k":"a","v":1,"ts":1}\n{"k":"b", broken\n{"k":"c","v":3,"ts":3}\n{not json at all}\n',
			"utf-8",
		)
		const s = new ClineJsonlStorage(filePath)

		// Healthy entries survive; corrupt lines are skipped without crashing.
		expect(s.readAll()).toEqual({ a: 1, c: 3 })
		const diag = s.readAllWithDiagnostics()
		expect(diag.state).toEqual({ a: 1, c: 3 })
		expect(diag.corruptLines).toBe(2)
	})

	it("should report a fully unreadable file as corrupt", () => {
		const filePath = path.join(tmpDir, "unreadable.jsonl")
		fs.writeFileSync(filePath, "{truncated and torn", "utf-8")
		// Simulate a file we cannot even open.
		fs.chmodSync(filePath, 0o000)
		const s = new ClineJsonlStorage(filePath)
		const diag = s.readAllWithDiagnostics()
		expect(diag.corruptLines).toBeGreaterThan(0)
		fs.chmodSync(filePath, 0o600)
	})
})
