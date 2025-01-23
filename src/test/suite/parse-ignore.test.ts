import { promises as fs } from "fs"
import * as path from "path"
import { ignoreParser } from "../../services/glob/parse-ignore"
import { listFiles } from "../../services/glob/list-files"
import os from "os"
import { describe, it, beforeEach, afterEach } from "mocha"
import "should"

describe("IgnoreParser", function () {
	// Increase timeout for async operations
	this.timeout(10000)
	const tmpDir = path.join(os.tmpdir(), "cline-test-" + Math.random().toString(36).slice(2))

	beforeEach(async function () {
		await fs.mkdir(tmpDir, { recursive: true })
		ignoreParser.clear()
	})

	afterEach(async function () {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it("should parse basic ignore patterns", async function () {
		const ignoreContent = `
			# Comment
			node_modules/
			*.log
			/dist
			!important.log
		`
		await fs.writeFile(path.join(tmpDir, ".clineignore"), ignoreContent)
		await ignoreParser.loadIgnoreFile(tmpDir)

		const patterns = ignoreParser.getIgnorePatterns()
		patterns.should.containEql("**/node_modules/**")
		patterns.should.containEql("**/*.log")
		patterns.should.containEql("**/dist/**")
		patterns.should.containEql("!**/important.log")
	})

	it("should handle empty or non-existent ignore file", async function () {
		await ignoreParser.loadIgnoreFile(tmpDir)
		ignoreParser.getIgnorePatterns().should.have.length(0)

		await fs.writeFile(path.join(tmpDir, ".clineignore"), "")
		await ignoreParser.loadIgnoreFile(tmpDir)
		ignoreParser.getIgnorePatterns().should.have.length(0)
	})

	it("should integrate with listFiles", async function () {
		this.timeout(15000) // Increase timeout for dynamic import

		try {
			// Create test files
			await fs.writeFile(path.join(tmpDir, "test.txt"), "test")
			await fs.writeFile(path.join(tmpDir, "test.log"), "log")
			await fs.mkdir(path.join(tmpDir, "node_modules"), { recursive: true })
			await fs.writeFile(path.join(tmpDir, "node_modules/package.json"), "{}")
			await fs.writeFile(path.join(tmpDir, "important.log"), "important")

			// Create .clineignore
			const ignoreContent = `
				*.log
				node_modules/
				!important.log
			`
			await fs.writeFile(path.join(tmpDir, ".clineignore"), ignoreContent)

			const [files] = await listFiles(tmpDir, true, 100)
			const relativePaths = files.map((filePath: string) => path.relative(tmpDir, filePath))

			// Should include
			relativePaths.should.containEql("test.txt")
			relativePaths.should.containEql("important.log")

			// Should exclude
			relativePaths.should.not.containEql("test.log")
			relativePaths.should.not.containEql("node_modules/package.json")
		} catch (error) {
			if (error instanceof Error && error.message.includes("ERR_REQUIRE_ESM")) {
				this.skip() // Skip this test if we hit ESM issues
			} else {
				throw error
			}
		}
	})

	it("should handle complex patterns", async function () {
		const ignoreContent = `
			# Ignore all .txt files
			**/*.txt
			
			# But not in docs
			!docs/**/*.txt
			
			# Ignore build directories
			**/build/
			
			# Ignore temp files but not temp directory
			*.tmp
			!temp/
		`
		await fs.writeFile(path.join(tmpDir, ".clineignore"), ignoreContent)
		await ignoreParser.loadIgnoreFile(tmpDir)

		const patterns = ignoreParser.getIgnorePatterns()
		patterns.should.containEql("**/*.txt")
		patterns.should.containEql("!**/docs/**/*.txt")
		patterns.should.containEql("**/build/**")
		patterns.should.containEql("**/*.tmp")
		patterns.should.containEql("!**/temp/**")
	})
})
