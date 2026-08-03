import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resetRefactoringFlags, setRefactoringFlag } from "../services/feature-flags/refactoring-flags"
import { ClineFileStorage } from "./ClineFileStorage"

describe("ClineFileStorage JSONL mode (V16 §6)", () => {
	let tmpDir: string

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-filestorage-jsonl-"))
		setRefactoringFlag("jsonlStorage", true)
	})

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true })
		resetRefactoringFlags()
	})

	it("appends to the .jsonl instead of rewriting the full .json on every set", () => {
		const filePath = path.join(tmpDir, "state.json")
		const store = new ClineFileStorage(filePath, "TestStorage")

		store.set("a", 1)
		store.set("b", 2)

		// The .jsonl log holds the appended entries; the main .json is untouched
		// until the compact threshold is crossed.
		expect(fs.existsSync(filePath.replace(/\.json$/, ".jsonl"))).toBe(true)
		expect(fs.existsSync(filePath)).toBe(false)
		expect(store.get("a")).toBe(1)
		expect(store.get("b")).toBe(2)
	})

	it("recovers from a torn .jsonl append by falling back to the main .json", () => {
		const filePath = path.join(tmpDir, "state.json")
		// Healthy main JSON (as written by the periodic compact-merge).
		fs.writeFileSync(filePath, JSON.stringify({ stable: "value", version: 3 }, null, 2), "utf-8")
		// Corrupt append log: two valid entries plus a torn line.
		const jsonlPath = filePath.replace(/\.json$/, ".jsonl")
		fs.writeFileSync(
			jsonlPath,
			'{"k":"fresh","v":"from-log","ts":1}\n{"k":"stable","v":"torn","ts":2}\n{"k":"fresh", broken json\n',
			"utf-8",
		)

		const store = new ClineFileStorage(filePath, "TestStorage")

		// Recovered from the main .json rather than returning an empty cache.
		expect(store.get("stable")).toBe("value")
		expect(store.get("version")).toBe(3)
		expect(store.get("fresh")).toBeUndefined()
	})

	it("replays healthy .jsonl entries when nothing is corrupt", () => {
		const filePath = path.join(tmpDir, "state.json")
		const jsonlPath = filePath.replace(/\.json$/, ".jsonl")
		fs.writeFileSync(jsonlPath, '{"k":"a","v":1,"ts":1}\n{"k":"b","v":"two","ts":2}\n', "utf-8")

		const store = new ClineFileStorage(filePath, "TestStorage")
		expect(store.get("a")).toBe(1)
		expect(store.get("b")).toBe("two")
	})

	it("writes the main .json mirror when the append log crosses the threshold", () => {
		const filePath = path.join(tmpDir, "state.json")
		// Small compact threshold so the compact-merge fires after a handful of
		// appends (the production default is 10_000; using it here would need
		// 10k+ synchronous disk writes and exceed the vitest 5s default timeout).
		const store = new ClineFileStorage(filePath, "TestStorage", { jsonlCompactThreshold: 3 })

		// Write just enough unique keys to cross the threshold.
		for (let i = 0; i < 5; i++) {
			store.set(`key-${i}`, i)
		}

		// Main JSON mirror refreshed, and reads still correct.
		expect(fs.existsSync(filePath)).toBe(true)
		const onDisk = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, number>
		expect(onDisk["key-0"]).toBe(0)
		expect(onDisk["key-4"]).toBe(4)
		expect(store.get("key-2")).toBe(2)
	})

	it("survives a restart when the log is healthy and above threshold (compact + mirror)", () => {
		const filePath = path.join(tmpDir, "state.json")
		const store = new ClineFileStorage(filePath, "TestStorage", { jsonlCompactThreshold: 3 })
		for (let i = 0; i < 5; i++) {
			store.set(`k${i}`, `v${i}`)
		}

		// New instance hydrates from the compacted .jsonl (or .json mirror).
		const store2 = new ClineFileStorage(filePath, "TestStorage")
		expect(store2.get("k0")).toBe("v0")
		expect(store2.get("k4")).toBe("v4")
	})
})
