import { LLMFileAccessController } from "./LLMFileAccessController"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { after, beforeEach, describe, it } from "mocha"
import "should"

describe("LLMFileAccessController", () => {
	let tempDir: string
	let controller: LLMFileAccessController

	beforeEach(async () => {
		// Create a temp directory for testing
		tempDir = path.join(os.tmpdir(), `llm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(tempDir)

		// Create default .clineignore file
		await fs.writeFile(
			path.join(tempDir, ".clineignore"),
			["*.secret", "private/", "# This is a comment", "", "temp.*", "file-with-space-at-end.* "].join("\n"),
		)

		controller = new LLMFileAccessController(tempDir)
		await controller.initialize()
	})

	after(async () => {
		// Clean up temp directory
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	describe("Default Patterns", () => {
		it("should block access to .env files", async () => {
			const result = await controller.validateAccess(".env")
			result.should.be.false()
		})

		it("should block access to .git directory", async () => {
			const result = await controller.validateAccess(".git/config")
			result.should.be.false()
		})

		it("should allow access to regular files", async () => {
			const result = await controller.validateAccess("src/index.ts")
			result.should.be.true()
		})
	})

	describe("Custom Patterns", () => {
		it("should block access to custom ignored patterns", async () => {
			const results = await Promise.all([
				controller.validateAccess("config.secret"),
				controller.validateAccess("private/data.txt"),
				controller.validateAccess("temp.json"),
			])
			results.forEach((result) => result.should.be.false())
		})

		it("should allow access to non-ignored files", async () => {
			const results = await Promise.all([
				controller.validateAccess("public/data.txt"),
				controller.validateAccess("config.json"),
				controller.validateAccess("src/temp/file.ts"),
			])
			results.forEach((result) => result.should.be.true())
		})
	})

	describe("Path Handling", () => {
		it("should handle absolute paths and match ignore patterns", async () => {
			// Test absolute path that should be allowed
			const allowedPath = path.join(tempDir, "src/file.ts")
			const allowedResult = await controller.validateAccess(allowedPath)
			allowedResult.should.be.true()

			// Test absolute path that matches an ignore pattern (*.secret)
			const ignoredPath = path.join(tempDir, "config.secret")
			const ignoredResult = await controller.validateAccess(ignoredPath)
			ignoredResult.should.be.false()

			// Test absolute path in ignored directory (private/)
			const ignoredDirPath = path.join(tempDir, "private/data.txt")
			const ignoredDirResult = await controller.validateAccess(ignoredDirPath)
			ignoredDirResult.should.be.false()
		})

		it("should handle relative paths and match ignore patterns", async () => {
			// Test relative path that should be allowed
			const allowedResult = await controller.validateAccess("./src/file.ts")
			allowedResult.should.be.true()

			// Test relative path that matches an ignore pattern (*.secret)
			const ignoredResult = await controller.validateAccess("./config.secret")
			ignoredResult.should.be.false()

			// Test relative path in ignored directory (private/)
			const ignoredDirResult = await controller.validateAccess("./private/data.txt")
			ignoredDirResult.should.be.false()
		})

		it("should normalize paths with backslashes", async () => {
			const result = await controller.validateAccess("src\\file.ts")
			result.should.be.true()
		})
	})

	describe("Batch Filtering", () => {
		it("should filter an array of paths", async () => {
			const paths = ["src/index.ts", ".env", "lib/utils.ts", ".git/config", "dist/bundle.js"]

			const filtered = await controller.filterPaths(paths)
			filtered.should.deepEqual(["src/index.ts", "lib/utils.ts"])
		})
	})

	describe("Error Handling", () => {
		it("should handle invalid paths", async () => {
			// Test with an invalid path containing null byte
			const result = await controller.validateAccess("\0invalid")
			result.should.be.true()
		})

		it("should handle missing .clineignore gracefully", async () => {
			// Create a new controller in a directory without .clineignore
			const emptyDir = path.join(os.tmpdir(), `llm-test-empty-${Date.now()}`)
			await fs.mkdir(emptyDir)

			try {
				const controller = new LLMFileAccessController(emptyDir)
				await controller.initialize()
				const result = await controller.validateAccess("file.txt")
				result.should.be.true()
			} finally {
				await fs.rm(emptyDir, { recursive: true, force: true })
			}
		})
	})
})

/**
 * Manual Testing Guide:
 *
 * 1. Create a test directory:
 *    mkdir llm-test
 *    cd llm-test
 *
 * 2. Create some test files:
 *    touch regular.txt
 *    touch .env
 *    touch config.secret
 *    mkdir private
 *    touch private/data.txt
 *    mkdir src
 *    touch src/index.ts
 *
 * 3. Create a .clineignore:
 *    echo "*.secret\nprivate/" > .clineignore
 *
 * 4. Use the controller in a test script:
 *    ```typescript
 *    const controller = new LLMFileAccessController(process.cwd())
 *
 *    async function test() {
 *        console.log(await controller.validateAccess("regular.txt"))     // true
 *        console.log(await controller.validateAccess(".env"))            // false (default pattern)
 *        console.log(await controller.validateAccess("config.secret"))   // false (custom pattern)
 *        console.log(await controller.validateAccess("private/data.txt")) // false (custom pattern)
 *        console.log(await controller.validateAccess("src/index.ts"))    // true
 *    }
 *
 *    test()
 *    ```
 */
