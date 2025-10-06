import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect } from "chai"
import sinon from "sinon"
import { secretStorage } from "@/core/storage/secrets"
import { __test_migrateFileSecretsToOS as migrate } from "@/standalone/vscode-context"

describe("Standalone secrets migration (unit)", () => {
	const platform = os.platform()
	if (platform !== "darwin") {
		it("skipped on non-macOS", () => {
			expect(true).to.equal(true)
		})
		return
	}

	let tmpDir: string
	let secretsPath: string
	let storeStub: sinon.SinonStub
	let deleteStub: sinon.SinonStub

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-mig-unit-"))
		secretsPath = path.join(tmpDir, "secrets.json")
		fs.writeFileSync(secretsPath, JSON.stringify({ a: "1", b: "2" }, null, 2))

		sinon.stub(secretStorage as any, "get").resolves(undefined)
		storeStub = sinon.stub(secretStorage as any, "store").resolves()
		deleteStub = sinon.stub(secretStorage as any, "delete").resolves()
	})

	afterEach(() => {
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true })
		} catch {}
		sinon.restore()
	})

	it("migrates all entries and removes file", async () => {
		await migrate(secretsPath)
		expect(fs.existsSync(secretsPath)).to.equal(false)
		expect(storeStub.callCount).to.equal(2)
		expect(deleteStub.called).to.equal(false)
	})

	it("rolls back on failure and keeps file", async () => {
		// Fail on second store
		let count = 0
		storeStub.callsFake(async () => {
			count++
			if (count === 2) {
				throw new Error("simulated failure")
			}
		})
		await migrate(secretsPath)
		// rollback called for first key
		expect(deleteStub.callCount).to.equal(1)
		// legacy file preserved
		expect(fs.existsSync(secretsPath)).to.equal(true)
	})
})
