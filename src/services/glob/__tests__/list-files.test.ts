import * as fs from "fs/promises"
import { after, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import "should"
import { listFiles } from "../list-files"

function normalizeForComparison(value: string): string {
	return path.normalize(value)
}

describe("listFiles", () => {
	const tmpDir = path.join(os.tmpdir(), `cline-list-files-test-${Math.random().toString(36).slice(2)}`)

	after(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
	})

	it("returns empty result when cwd points to a file", async () => {
		await fs.mkdir(tmpDir, { recursive: true })
		const filePath = path.join(tmpDir, "single-file.ts")
		await fs.writeFile(filePath, "export const x = 1\n")

		const [files, didHitLimit] = await listFiles(filePath, false, 200)

		files.should.deepEqual([])
		didHitLimit.should.equal(false)
	})

	it("still lists files when cwd points to a directory", async () => {
		await fs.mkdir(tmpDir, { recursive: true })
		const nestedFile = path.join(tmpDir, "index.ts")
		await fs.writeFile(nestedFile, "export const ok = true\n")

		const [files] = await listFiles(tmpDir, false, 200)

		files.map(normalizeForComparison).should.containEql(normalizeForComparison(nestedFile))
	})
})
