import { ClineIgnoreController } from "../ClineIgnoreController"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { describe, it, beforeEach, afterAll, expect } from "vitest"

describe("ClineIgnoreController", () => {
	let tempDir: string
	let controller: ClineIgnoreController

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

		controller = new ClineIgnoreController(tempDir)
		await controller.initialize()
	})

	afterAll(async () => {
		// Clean up temp directory
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	describe("Default Patterns", () => {
		// it("should block access to common ignored files", async () => {
		// 	const results = [
		// 		controller.validateAccess(".env"),
		// 		controller.validateAccess(".git/config"),
		// 		controller.validateAccess("node_modules/package.json"),
		// 	]
		// 	results.forEach((result) => expect(result).toBe(false))
		// })

		it("should allow access to regular files", async () => {
			const results = [
				controller.validateAccess("src/index.ts"),
				controller.validateAccess("README.md"),
				controller.validateAccess("package.json"),
			]
			results.forEach((result) => expect(result).toBe(true))
		})

		it("should block access to .clineignore file", async () => {
			const result = controller.validateAccess(".clineignore")
			expect(result).toBe(false)
		})
	})

	describe("Custom Patterns", () => {
		it("should block access to custom ignored patterns", async () => {
			const results = [
				controller.validateAccess("config.secret"),
				controller.validateAccess("private/data.txt"),
				controller.validateAccess("temp.json"),
				controller.validateAccess("nested/deep/file.secret"),
				controller.validateAccess("private/nested/deep/file.txt"),
			]
			results.forEach((result) => expect(result).toBe(false))
		})

		it("should allow access to non-ignored files", async () => {
			const results = [
				controller.validateAccess("public/data.txt"),
				controller.validateAccess("config.json"),
				controller.validateAccess("src/temp/file.ts"),
				controller.validateAccess("nested/deep/file.txt"),
				controller.validateAccess("not-private/data.txt"),
			]
			results.forEach((result) => expect(result).toBe(true))
		})

		it("should handle pattern edge cases", async () => {
			await fs.writeFile(
				path.join(tempDir, ".clineignore"),
				["*.secret", "private/", "*.tmp", "data-*.json", "temp/*"].join("\n"),
			)

			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			const results = [
				controller.validateAccess("data-123.json"), // Should be false (wildcard)
				controller.validateAccess("data.json"), // Should be true (doesn't match pattern)
				controller.validateAccess("script.tmp"), // Should be false (extension match)
			]

			expect(results[0]).toBe(false) // data-123.json
			expect(results[1]).toBe(true) // data.json
			expect(results[2]).toBe(false) // script.tmp
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

		// 	controller = new ClineIgnoreController(tempDir)

		// 	const results = [
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
		// 	]

		// 	expect(results[0]).toBe(false) // temp/file.txt
		// 	expect(results[1]).toBe(true) // temp/allowed/file.txt
		// 	expect(results[2]).toBe(true) // temp/allowed/nested/file.txt
		// 	expect(results[3]).toBe(false) // docs/guide.md
		// 	expect(results[4]).toBe(true) // docs/README.md
		// 	expect(results[5]).toBe(true) // docs/CONTRIBUTING.md
		// 	expect(results[6]).toBe(false) // docs/api/guide.md
		// 	expect(results[7]).toBe(false) // assets/logo.png
		// 	expect(results[8]).toBe(true) // assets/public/logo.png
		// 	expect(results[9]).toBe(true) // assets/public/data.json
		// })

		it("should handle comments in .clineignore", async () => {
			// Create a new .clineignore with comments
			await fs.writeFile(
				path.join(tempDir, ".clineignore"),
				["# Comment line", "*.secret", "private/", "temp.*"].join("\n"),
			)

			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			const result = controller.validateAccess("test.secret")
			expect(result).toBe(false)
		})
	})

	describe("Path Handling", () => {
		it("should handle absolute paths and match ignore patterns", async () => {
			// Test absolute path that should be allowed
			const allowedPath = path.join(tempDir, "src/file.ts")
			const allowedResult = controller.validateAccess(allowedPath)
			expect(allowedResult).toBe(true)

			// Test absolute path that matches an ignore pattern (*.secret)
			const ignoredPath = path.join(tempDir, "config.secret")
			const ignoredResult = controller.validateAccess(ignoredPath)
			expect(ignoredResult).toBe(false)

			// Test absolute path in ignored directory (private/)
			const ignoredDirPath = path.join(tempDir, "private/data.txt")
			const ignoredDirResult = controller.validateAccess(ignoredDirPath)
			expect(ignoredDirResult).toBe(false)
		})

		it("should handle relative paths and match ignore patterns", async () => {
			// Test relative path that should be allowed
			const allowedResult = controller.validateAccess("./src/file.ts")
			expect(allowedResult).toBe(true)

			// Test relative path that matches an ignore pattern (*.secret)
			const ignoredResult = controller.validateAccess("./config.secret")
			expect(ignoredResult).toBe(false)

			// Test relative path in ignored directory (private/)
			const ignoredDirResult = controller.validateAccess("./private/data.txt")
			expect(ignoredDirResult).toBe(false)
		})

		it("should normalize paths with backslashes", async () => {
			const result = controller.validateAccess("src\\file.ts")
			expect(result).toBe(true)
		})
	})

	describe("Batch Filtering", () => {
		it("should filter an array of paths", async () => {
			const paths = ["src/index.ts", ".env", "lib/utils.ts", ".git/config", "dist/bundle.js"]

			const filtered = controller.filterPaths(paths)
			expect(filtered).toEqual(["src/index.ts", "lib/utils.ts", "dist/bundle.js"])
		})
	})

	describe("Error Handling", () => {
		it("should handle invalid paths", async () => {
			// Test with an invalid path containing null byte
			const result = controller.validateAccess("\0invalid")
			expect(result).toBe(true)
		})

		it("should handle missing .clineignore gracefully", async () => {
			// Create a new controller in a directory without .clineignore
			const emptyDir = path.join(os.tmpdir(), `llm-test-empty-${Date.now()}`)
			await fs.mkdir(emptyDir)

			try {
				const controller = new ClineIgnoreController(emptyDir)
				await controller.initialize()
				const result = controller.validateAccess("file.txt")
				expect(result).toBe(true)
			} finally {
				await fs.rm(emptyDir, { recursive: true, force: true })
			}
		})

		it("should handle empty .clineignore", async () => {
			await fs.writeFile(path.join(tempDir, ".clineignore"), "")

			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			const result = controller.validateAccess("regular-file.txt")
			expect(result).toBe(true)
		})
	})
})
