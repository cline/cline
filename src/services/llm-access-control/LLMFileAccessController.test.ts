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
			[".env", "*.secret", "private/", "# This is a comment", "", "temp.*", "file-with-space-at-end.* ", "**/.git/**"].join(
				"\n",
			),
		)

		controller = new LLMFileAccessController(tempDir)
		await controller.initialize()
	})

	after(async () => {
		// Clean up temp directory
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	describe("Default Patterns", () => {
		// it("should block access to common ignored files", async () => {
		// 	const results = await Promise.all([
		// 		controller.validateAccess(".env"),
		// 		controller.validateAccess(".git/config"),
		// 		controller.validateAccess("node_modules/package.json"),
		// 	])
		// 	results.forEach((result) => result.should.be.false())
		// })

		it("should allow access to regular files", async () => {
			const results = await Promise.all([
				controller.validateAccess("src/index.ts"),
				controller.validateAccess("README.md"),
				controller.validateAccess("package.json"),
			])
			results.forEach((result) => result.should.be.true())
		})
	})

	describe("Custom Patterns", () => {
		it("should block access to custom ignored patterns", async () => {
			const results = await Promise.all([
				controller.validateAccess("config.secret"),
				controller.validateAccess("private/data.txt"),
				controller.validateAccess("temp.json"),
				controller.validateAccess("nested/deep/file.secret"),
				controller.validateAccess("private/nested/deep/file.txt"),
			])
			results.forEach((result) => result.should.be.false())
		})

		it("should allow access to non-ignored files", async () => {
			const results = await Promise.all([
				controller.validateAccess("public/data.txt"),
				controller.validateAccess("config.json"),
				controller.validateAccess("src/temp/file.ts"),
				controller.validateAccess("nested/deep/file.txt"),
				controller.validateAccess("not-private/data.txt"),
			])
			results.forEach((result) => result.should.be.true())
		})

		it("should handle pattern edge cases", async () => {
			await fs.writeFile(
				path.join(tempDir, ".clineignore"),
				["*.secret", "private/", "*.tmp", "data-*.json", "temp/*"].join("\n"),
			)

			controller = new LLMFileAccessController(tempDir)
			await controller.initialize()

			const results = await Promise.all([
				controller.validateAccess("data-123.json"), // Should be false (wildcard)
				controller.validateAccess("data.json"), // Should be true (doesn't match pattern)
				controller.validateAccess("script.tmp"), // Should be false (extension match)
			])

			results[0].should.be.false() // data-123.json
			results[1].should.be.true() // data.json
			results[2].should.be.false() // script.tmp
		})

		// ToDo: handle negation patterns successfully

		// it("should handle negation patterns", async () => {
		// 	await fs.writeFile(
		// 		path.join(tempDir, ".clineignore"),
		// 		[
		// 			"temp/*", // Ignore everything in temp
		// 			"!temp/allowed/*", // But allow files in temp/allowed
		// 			"docs/**/*.md", // Ignore all markdown files in docs
		// 			"!docs/README.md", // Except README.md
		// 			"!docs/CONTRIBUTING.md", // And CONTRIBUTING.md
		// 			"assets/", // Ignore all assets
		// 			"!assets/public/", // Except public assets
		// 			"!assets/public/*.png", // Specifically allow PNGs in public assets
		// 		].join("\n"),
		// 	)

		// 	controller = new LLMFileAccessController(tempDir)
		// 	await controller.initialize()

		// 	const results = await Promise.all([
		// 		// Basic negation
		// 		controller.validateAccess("temp/file.txt"), // Should be false (in temp/)
		// 		controller.validateAccess("temp/allowed/file.txt"), // Should be true (negated)
		// 		controller.validateAccess("temp/allowed/nested/file.txt"), // Should be true (negated with nested)

		// 		// Multiple negations in same path
		// 		controller.validateAccess("docs/guide.md"), // Should be false (matches docs/**/*.md)
		// 		controller.validateAccess("docs/README.md"), // Should be true (negated)
		// 		controller.validateAccess("docs/CONTRIBUTING.md"), // Should be true (negated)
		// 		controller.validateAccess("docs/api/guide.md"), // Should be false (nested markdown)

		// 		// Nested negations
		// 		controller.validateAccess("assets/logo.png"), // Should be false (in assets/)
		// 		controller.validateAccess("assets/public/logo.png"), // Should be true (negated and matches *.png)
		// 		controller.validateAccess("assets/public/data.json"), // Should be true (in negated public/)
		// 	])

		// 	results[0].should.be.false() // temp/file.txt
		// 	results[1].should.be.true() // temp/allowed/file.txt
		// 	results[2].should.be.true() // temp/allowed/nested/file.txt
		// 	results[3].should.be.false() // docs/guide.md
		// 	results[4].should.be.true() // docs/README.md
		// 	results[5].should.be.true() // docs/CONTRIBUTING.md
		// 	results[6].should.be.false() // docs/api/guide.md
		// 	results[7].should.be.false() // assets/logo.png
		// 	results[8].should.be.true() // assets/public/logo.png
		// 	results[9].should.be.true() // assets/public/data.json
		// })

		it("should handle comments in .clineignore", async () => {
			// Create a new .clineignore with comments
			await fs.writeFile(
				path.join(tempDir, ".clineignore"),
				["# Comment line", "*.secret", "private/", "temp.*"].join("\n"),
			)

			controller = new LLMFileAccessController(tempDir)
			await controller.initialize()

			const result = await controller.validateAccess("test.secret")
			result.should.be.false()
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

		it("should handle paths outside cwd", async () => {
			// Create a path that points to parent directory of cwd
			const outsidePath = path.join(path.dirname(tempDir), "outside.txt")
			const result = await controller.validateAccess(outsidePath)

			// Should return false for security since path is outside cwd
			result.should.be.false()

			// Test with a deeply nested path outside cwd
			const deepOutsidePath = path.join(path.dirname(tempDir), "deep", "nested", "outside.secret")
			const deepResult = await controller.validateAccess(deepOutsidePath)
			deepResult.should.be.false()

			// Test with a path that tries to escape using ../
			const escapeAttemptPath = path.join(tempDir, "..", "escape-attempt.txt")
			const escapeResult = await controller.validateAccess(escapeAttemptPath)
			escapeResult.should.be.false()
		})
	})

	describe("Batch Filtering", () => {
		it("should filter an array of paths", async () => {
			const paths = ["src/index.ts", ".env", "lib/utils.ts", ".git/config", "dist/bundle.js"]

			const filtered = controller.filterPaths(paths)
			filtered.should.deepEqual(["src/index.ts", "lib/utils.ts", "dist/bundle.js"])
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

		it("should handle empty .clineignore", async () => {
			await fs.writeFile(path.join(tempDir, ".clineignore"), "")

			controller = new LLMFileAccessController(tempDir)
			await controller.initialize()

			const result = await controller.validateAccess("regular-file.txt")
			result.should.be.true()
		})
	})
})
