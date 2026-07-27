import { afterEach, beforeEach, describe, it } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { expect } from "chai"
import { resolveClineDataDir } from "../data-dir"
import { createStorageContext } from "../storage-context"

describe("resolveClineDataDir", () => {
	let originalClineDir: string | undefined
	let originalClineDataDir: string | undefined

	beforeEach(() => {
		originalClineDir = process.env.CLINE_DIR
		originalClineDataDir = process.env.CLINE_DATA_DIR
		delete process.env.CLINE_DIR
		delete process.env.CLINE_DATA_DIR
	})

	afterEach(() => {
		if (originalClineDir === undefined) {
			delete process.env.CLINE_DIR
		} else {
			process.env.CLINE_DIR = originalClineDir
		}
		if (originalClineDataDir === undefined) {
			delete process.env.CLINE_DATA_DIR
		} else {
			process.env.CLINE_DATA_DIR = originalClineDataDir
		}
	})

	it("defaults to ~/.cline/data", () => {
		expect(resolveClineDataDir()).to.equal(path.join(os.homedir(), ".cline", "data"))
	})

	it("uses CLINE_DIR/data when only CLINE_DIR is set", () => {
		process.env.CLINE_DIR = "/tmp/home-cline"
		expect(resolveClineDataDir()).to.equal(path.join("/tmp/home-cline", "data"))
	})

	it("prefers CLINE_DATA_DIR over CLINE_DIR", () => {
		process.env.CLINE_DIR = "/tmp/home-cline"
		process.env.CLINE_DATA_DIR = "/tmp/isolated/data"
		expect(resolveClineDataDir()).to.equal("/tmp/isolated/data")
	})

	it("prefers an explicit clineDir over both env vars", () => {
		process.env.CLINE_DIR = "/tmp/home-cline"
		process.env.CLINE_DATA_DIR = "/tmp/isolated/data"
		expect(resolveClineDataDir({ clineDir: "/tmp/explicit" })).to.equal(path.join("/tmp/explicit", "data"))
	})

	it("prefers an explicit dataDir over everything else", () => {
		process.env.CLINE_DATA_DIR = "/tmp/isolated/data"
		expect(resolveClineDataDir({ clineDir: "/tmp/explicit", dataDir: "/tmp/override" })).to.equal("/tmp/override")
	})
})

describe("createStorageContext data directory", () => {
	let tempDir: string
	let originalClineDir: string | undefined
	let originalClineDataDir: string | undefined

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-storage-context-"))
		originalClineDir = process.env.CLINE_DIR
		originalClineDataDir = process.env.CLINE_DATA_DIR
		delete process.env.CLINE_DIR
		delete process.env.CLINE_DATA_DIR
	})

	afterEach(() => {
		if (originalClineDir === undefined) {
			delete process.env.CLINE_DIR
		} else {
			process.env.CLINE_DIR = originalClineDir
		}
		if (originalClineDataDir === undefined) {
			delete process.env.CLINE_DATA_DIR
		} else {
			process.env.CLINE_DATA_DIR = originalClineDataDir
		}
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	// Regression: globalState.json/secrets.json used to ignore CLINE_DATA_DIR and
	// stay in ~/.cline/data while the SDK wrote settings/providers.json under
	// CLINE_DATA_DIR, splitting provider state across two directories.
	it("honours CLINE_DATA_DIR so the extension's stores sit beside providers.json", () => {
		const dataDir = path.join(tempDir, "isolated", "data")
		process.env.CLINE_DATA_DIR = dataDir
		process.env.CLINE_DIR = path.join(tempDir, "home-cline")

		const storage = createStorageContext({ workspacePath: tempDir })

		expect(storage.dataDir).to.equal(dataDir)
		storage.globalState.update("actModeApiProvider", "anthropic")
		storage.secrets.update("apiKey", "sk-ant-test")
		expect(fs.existsSync(path.join(dataDir, "globalState.json"))).to.equal(true)
		expect(fs.existsSync(path.join(dataDir, "secrets.json"))).to.equal(true)
		expect(fs.existsSync(path.join(tempDir, "home-cline", "data", "globalState.json"))).to.equal(false)
	})

	it("keeps an explicit clineDir isolated from an ambient CLINE_DATA_DIR", () => {
		process.env.CLINE_DATA_DIR = path.join(tempDir, "ambient")
		const clineDir = path.join(tempDir, "explicit")

		const storage = createStorageContext({ clineDir, workspacePath: tempDir })

		expect(storage.dataDir).to.equal(path.join(clineDir, "data"))
	})
})
