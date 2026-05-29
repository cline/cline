import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "mocha"
import { ClineFileStorage } from "../ClineFileStorage"

describe("ClineFileStorage", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-file-storage-"))
	})

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	it("surfaces batch write failures", () => {
		const storagePath = path.join(tempDir, "secrets.json")
		const storage = new ClineFileStorage<string>(storagePath, "TestStorage")
		fs.mkdirSync(storagePath)

		assert.throws(() => storage.setBatch({ key: "value" }))
	})
})
