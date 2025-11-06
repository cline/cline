import { expect } from "chai"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { listFilesWithGlobFilter } from "../list-files"

describe("listFilesWithGlobFilter", () => {
	let testDir: string

	beforeEach(() => {
		// Create a temporary test directory
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-test-"))
	})

	afterEach(() => {
		// Clean up test directory
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true, force: true })
		}
	})

	const createTestFiles = (files: string[]) => {
		files.forEach((file) => {
			const filePath = path.join(testDir, file)
			const dir = path.dirname(filePath)
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true })
			}
			fs.writeFileSync(filePath, "test content")
		})
	}

	it("should return all files when no patterns specified", async () => {
		createTestFiles(["file1.ts", "file2.js", "file3.txt"])

		const [files, didHitLimit] = await listFilesWithGlobFilter(testDir, [], [], 100)

		expect(files).to.have.lengthOf(3)
		expect(didHitLimit).to.equal(false)
		expect(files.some((f) => f.endsWith("file1.ts"))).to.equal(true)
		expect(files.some((f) => f.endsWith("file2.js"))).to.equal(true)
		expect(files.some((f) => f.endsWith("file3.txt"))).to.equal(true)
	})

	it("should filter files by include patterns", async () => {
		createTestFiles(["file1.ts", "file2.js", "file3.txt", "src/index.ts", "src/utils.ts"])

		const [files, didHitLimit] = await listFilesWithGlobFilter(testDir, ["**/*.ts"], [], 100)

		expect(files).to.have.lengthOf(3)
		expect(didHitLimit).to.equal(false)
		expect(files.every((f) => f.endsWith(".ts"))).to.equal(true)
	})

	it("should exclude files by exclude patterns", async () => {
		createTestFiles(["file1.ts", "file2.test.ts", "file3.ts", "src/index.test.ts"])

		const [files, didHitLimit] = await listFilesWithGlobFilter(testDir, ["**/*.ts"], ["**/*.test.ts"], 100)

		expect(files).to.have.lengthOf(2)
		expect(didHitLimit).to.equal(false)
		expect(files.every((f) => !f.includes(".test."))).to.equal(true)
	})

	it("should respect maxCount limit", async () => {
		createTestFiles(["file1.ts", "file2.ts", "file3.ts", "file4.ts", "file5.ts"])

		const [files, didHitLimit] = await listFilesWithGlobFilter(testDir, [], [], 3)

		expect(files).to.have.lengthOf(3)
		expect(didHitLimit).to.equal(true)
	})

	it("should exclude default ignore directories", async () => {
		createTestFiles([
			"src/index.ts",
			"node_modules/package/index.js",
			"dist/bundle.js",
			"__pycache__/module.pyc",
		])

		const [files, didHitLimit] = await listFilesWithGlobFilter(testDir, [], [], 100)

		expect(files).to.have.lengthOf(1)
		expect(didHitLimit).to.equal(false)
		expect(files[0].endsWith("src/index.ts")).to.equal(true)
	})

	it("should combine user excludes with default excludes", async () => {
		createTestFiles(["src/index.ts", "src/test.ts", "node_modules/lib.js", "build/output.js"])

		const [files, didHitLimit] = await listFilesWithGlobFilter(testDir, [], ["**/test.ts", "**/build/**"], 100)

		expect(files).to.have.lengthOf(1)
		expect(didHitLimit).to.equal(false)
		expect(files[0].endsWith("src/index.ts")).to.equal(true)
	})

	it("should return absolute paths", async () => {
		createTestFiles(["file1.ts"])

		const [files, didHitLimit] = await listFilesWithGlobFilter(testDir, [], [], 100)

		expect(files).to.have.lengthOf(1)
		expect(didHitLimit).to.equal(false)
		expect(path.isAbsolute(files[0])).to.equal(true)
	})

	it("should handle nested directory structures", async () => {
		createTestFiles(["src/components/Button.tsx", "src/utils/helpers.ts", "tests/unit/button.test.ts"])

		const [files, didHitLimit] = await listFilesWithGlobFilter(testDir, ["src/**/*.ts", "src/**/*.tsx"], [], 100)

		expect(files).to.have.lengthOf(2)
		expect(didHitLimit).to.equal(false)
		expect(files.some((f) => f.includes("Button.tsx"))).to.equal(true)
		expect(files.some((f) => f.includes("helpers.ts"))).to.equal(true)
	})

	it("should respect .gitignore files", async () => {
		createTestFiles(["src/index.ts", "ignored.ts"])
		fs.writeFileSync(path.join(testDir, ".gitignore"), "ignored.ts")

		const [files, didHitLimit] = await listFilesWithGlobFilter(testDir, [], [], 100)

		// Note: .gitignore file itself is also returned by globby
		expect(files.length).to.be.at.least(1)
		expect(didHitLimit).to.equal(false)
		expect(files.some((f) => f.endsWith("src/index.ts"))).to.equal(true)
		expect(files.some((f) => f.endsWith("ignored.ts"))).to.equal(false)
	})

	it("should return empty array for restricted paths", async () => {
		const [files, didHitLimit] = await listFilesWithGlobFilter("/", [], [], 100)

		expect(files).to.have.lengthOf(0)
		expect(didHitLimit).to.equal(false)
	})

	it("should handle empty directory", async () => {
		const [files, didHitLimit] = await listFilesWithGlobFilter(testDir, [], [], 100)

		expect(files).to.have.lengthOf(0)
		expect(didHitLimit).to.equal(false)
	})

	it("should only return files, not directories", async () => {
		createTestFiles(["src/index.ts", "lib/utils.ts"])
		// Directories are created as part of createTestFiles, but should not be in results

		const [files, didHitLimit] = await listFilesWithGlobFilter(testDir, [], [], 100)

		expect(files).to.have.lengthOf(2)
		expect(didHitLimit).to.equal(false)
		// All results should be files, not directories
		files.forEach((file) => {
			expect(fs.statSync(file).isFile()).to.equal(true)
		})
	})
})
