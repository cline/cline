import { ClineIgnoreController } from "./ClineIgnoreController"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { after, beforeEach, describe, it } from "mocha"
import "should"

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

	after(async () => {
		// Clean up temp directory
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	describe("Default Patterns", () => {
		it("should block access to common ignored files", async () => {
			const results = [
				controller.validateAccess(".env"),
				controller.validateAccess(".git/config"),
				controller.validateAccess("private/secret.txt"),
				controller.validateAccess("config.secret"),
			]
			results.forEach((result) => result.should.be.false())
		})

		it("should allow access to regular files", async () => {
			const results = [
				controller.validateAccess("src/index.ts"),
				controller.validateAccess("README.md"),
				controller.validateAccess("package.json"),
			]
			results.forEach((result) => result.should.be.true())
		})

		it("should block access to .clineignore file", async () => {
			const result = controller.validateAccess(".clineignore")
			result.should.be.false()
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
			results.forEach((result) => result.should.be.false())
		})

		it("should allow access to non-ignored files", async () => {
			const results = [
				controller.validateAccess("public/data.txt"),
				controller.validateAccess("config.json"),
				controller.validateAccess("src/temp/file.ts"),
				controller.validateAccess("nested/deep/file.txt"),
				controller.validateAccess("not-private/data.txt"),
			]
			results.forEach((result) => result.should.be.true())
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

			results[0].should.be.false() // data-123.json
			results[1].should.be.true() // data.json
			results[2].should.be.false() // script.tmp
		})

		it("should handle negation patterns", async () => {
			await fs.writeFile(
				path.join(tempDir, ".clineignore"),
				[
					"temp/*", // Ignore everything in temp
					"!temp/allowed/*", // But allow files in temp/allowed
					"docs/**/*.md", // Ignore all markdown files in docs
					"!docs/README.md", // Except README.md
					"!docs/CONTRIBUTING.md", // And CONTRIBUTING.md
					"assets/", // Ignore all assets
					"!assets/public/", // Except public assets
					"!assets/public/*.png", // Specifically allow PNGs in public assets
				].join("\n"),
			)

			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			const results = [
				// Basic negation
				controller.validateAccess("temp/file.txt"), // Should be false (in temp/)
				controller.validateAccess("temp/allowed/file.txt"), // Should be true (negated)
				controller.validateAccess("temp/allowed/nested/file.txt"), // Should be true (negated with nested)

				// Multiple negations in same path
				controller.validateAccess("docs/guide.md"), // Should be false (matches docs/**/*.md)
				controller.validateAccess("docs/README.md"), // Should be true (negated)
				controller.validateAccess("docs/CONTRIBUTING.md"), // Should be true (negated)
				controller.validateAccess("docs/api/guide.md"), // Should be false (nested markdown)

				// Nested negations
				controller.validateAccess("assets/logo.png"), // Should be false (in assets/)
				controller.validateAccess("assets/public/logo.png"), // Should be true (negated and matches *.png)
				controller.validateAccess("assets/public/data.json"), // Should be true (in negated public/)
			]

			results[0].should.be.false() // temp/file.txt
			results[1].should.be.true() // temp/allowed/file.txt
			results[2].should.be.true() // temp/allowed/nested/file.txt
			results[3].should.be.false() // docs/guide.md
			results[4].should.be.true() // docs/README.md
			results[5].should.be.true() // docs/CONTRIBUTING.md
			results[6].should.be.false() // docs/api/guide.md
			results[7].should.be.false() // assets/logo.png
			results[8].should.be.true() // assets/public/logo.png
			results[9].should.be.true() // assets/public/data.json
		})

		it("should handle comments in .clineignore", async () => {
			// Create a new .clineignore with comments
			await fs.writeFile(
				path.join(tempDir, ".clineignore"),
				["# Comment line", "*.secret", "private/", "temp.*"].join("\n"),
			)

			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			const result = controller.validateAccess("test.secret")
			result.should.be.false()
		})
	})

	describe("GitIgnore Integration", () => {
		it("should respect .gitignore patterns when no .clineignore exists", async () => {
			// Remove .clineignore and create .gitignore
			await fs.rm(path.join(tempDir, ".clineignore"))
			await fs.writeFile(path.join(tempDir, ".gitignore"), ["node_modules/", "*.log", "dist/"].join("\n"))

			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			const results = [
				controller.validateAccess("node_modules/package.json"), // Should be false
				controller.validateAccess("app.log"), // Should be false
				controller.validateAccess("dist/bundle.js"), // Should be false
				controller.validateAccess("src/index.js"), // Should be true
			]

			results[0].should.be.false()
			results[1].should.be.false()
			results[2].should.be.false()
			results[3].should.be.true()
		})

		it("should prioritize .clineignore over .gitignore", async () => {
			// Create both .gitignore and .clineignore with conflicting patterns
			await fs.writeFile(path.join(tempDir, ".gitignore"), ["*.log", "node_modules/", "!important.log"].join("\n"))

			await fs.writeFile(path.join(tempDir, ".clineignore"), ["important.log", "!node_modules/src/"].join("\n"))

			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			const results = [
				controller.validateAccess("debug.log"), // Should be false (from .gitignore)
				controller.validateAccess("important.log"), // Should be false (from .clineignore, overriding .gitignore)
				controller.validateAccess("node_modules/package.json"), // Should be false (from .gitignore)
				controller.validateAccess("node_modules/src/index.js"), // Should be true (from .clineignore negation)
			]

			results[0].should.be.false()
			results[1].should.be.false()
			results[2].should.be.false()
			results[3].should.be.true()
		})
	})

	describe("Path Normalization", () => {
		it("should handle different path formats consistently", async () => {
			// Create .clineignore with patterns
			await fs.writeFile(path.join(tempDir, ".clineignore"), ["private/", "*.secret"].join("\n"))

			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			// Test with different path formats
			const relativePath = "private/config.json"
			const absolutePath = path.join(tempDir, "private/config.json")
			const mixedSlashPath = "private\\config.json"

			controller.validateAccess(relativePath).should.be.false()
			controller.validateAccess(absolutePath).should.be.false()
			controller.validateAccess(mixedSlashPath).should.be.false()
		})

		it("should block access to paths outside the workspace", async () => {
			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			// Path outside the workspace
			const outsidePath = path.join(os.tmpdir(), "outside-workspace.txt")
			const parentPath = path.join(tempDir, "..", "parent-file.txt")

			controller.validateAccess(outsidePath).should.be.false()
			controller.validateAccess(parentPath).should.be.false()
		})

		it("should handle null and invalid paths safely", async () => {
			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			// @ts-ignore - Testing null handling
			controller.validateAccess(null).should.be.true()
			// @ts-ignore - Testing undefined handling
			controller.validateAccess(undefined).should.be.true()
			controller.validateAccess("").should.be.true()
		})
	})

	describe("Error Handling", () => {
		it("should handle invalid paths", async () => {
			// Test with an invalid path containing null byte
			const result = controller.validateAccess("\0invalid")
			result.should.be.false() // Changed to false for security
		})

		it("should handle missing .clineignore gracefully", async () => {
			// Create a new controller in a directory without .clineignore
			const emptyDir = path.join(os.tmpdir(), `llm-test-empty-${Date.now()}`)
			await fs.mkdir(emptyDir)

			try {
				const controller = new ClineIgnoreController(emptyDir)
				await controller.initialize()
				const result = controller.validateAccess("file.txt")
				result.should.be.true()
			} finally {
				await fs.rm(emptyDir, { recursive: true, force: true })
			}
		})

		it("should handle empty .clineignore", async () => {
			await fs.writeFile(path.join(tempDir, ".clineignore"), "")

			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			const result = controller.validateAccess("regular-file.txt")
			result.should.be.true()
		})

		it("should handle initialization race conditions", async () => {
			const newDir = path.join(os.tmpdir(), `llm-test-race-${Date.now()}`)
			await fs.mkdir(newDir)

			try {
				// Create controller but don't await initialization
				const controller = new ClineIgnoreController(newDir)

				// Call validateAccess before initialization completes
				const result1 = controller.validateAccess("file.txt")
				result1.should.be.true() // Should default to true when not initialized

				// Now initialize and test again
				await controller.initialize()
				const result2 = controller.validateAccess("file.txt")
				result2.should.be.true() // Should still be true after initialization
			} finally {
				await fs.rm(newDir, { recursive: true, force: true })
			}
		})
	})

	describe("Command Validation", () => {
		it("should validate terminal commands correctly", async () => {
			await fs.writeFile(path.join(tempDir, ".clineignore"), ["private/", "*.secret", "*.log"].join("\n"))

			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			// Commands that should be allowed
			const allowedCommands = [
				"cat README.md",
				"grep pattern src/index.js",
				"ls -la",
				"echo hello",
				"get-content package.json",
			]

			// Commands that should be blocked
			const blockedCommands = [
				"cat private/config.json",
				"less credentials.secret",
				"grep pattern app.log",
				"get-content private/settings.json",
				"type credentials.secret",
			]

			allowedCommands.forEach((cmd) => {
				const result = controller.validateCommand(cmd)
				should.not.exist(result)
			})

			blockedCommands.forEach((cmd) => {
				const result = controller.validateCommand(cmd)
				should.exist(result)
			})
		})

		it("should handle empty and invalid commands", async () => {
			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			const emptyCommands = ["", "   ", null, undefined]

			emptyCommands.forEach((cmd) => {
				// @ts-ignore - Testing null/undefined handling
				const result = controller.validateCommand(cmd)
				should.not.exist(result)
			})
		})
	})

	describe("Path Filtering", () => {
		it("should filter arrays of paths correctly", async () => {
			await fs.writeFile(path.join(tempDir, ".clineignore"), ["private/", "*.secret", "*.log"].join("\n"))

			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			const paths = ["src/index.js", "private/config.json", "README.md", "credentials.secret", "app.log"]

			const filtered = controller.filterPaths(paths)
			filtered.should.have.length(2)
			filtered.should.containEql("src/index.js")
			filtered.should.containEql("README.md")
		})

		it("should handle invalid inputs to filterPaths", async () => {
			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			// @ts-ignore - Testing null handling
			controller.filterPaths(null).should.have.length(0)
			// @ts-ignore - Testing undefined handling
			controller.filterPaths(undefined).should.have.length(0)
			controller.filterPaths([]).should.have.length(0)
			// @ts-ignore - Testing non-array handling
			controller.filterPaths("not-an-array").should.have.length(0)
		})
	})

	describe("Ignore Content Access", () => {
		it("should provide access to ignore content through getIgnoreContent()", async () => {
			// Create both .gitignore and .clineignore with different content
			await fs.writeFile(path.join(tempDir, ".clineignore"), ["*.secret", "private/", "# Cline comment"].join("\n"))

			await fs.writeFile(path.join(tempDir, ".gitignore"), ["node_modules/", "*.log", "# Git comment"].join("\n"))

			controller = new ClineIgnoreController(tempDir)
			await controller.initialize()

			const { clineIgnore, gitIgnore } = controller.getIgnoreContent()

			// Verify content is accessible
			should.exist(clineIgnore)
			should.exist(gitIgnore)

			if (clineIgnore) {
				clineIgnore.should.containEql("*.secret")
				clineIgnore.should.containEql("private/")
				clineIgnore.should.containEql("# Cline comment")
			}

			if (gitIgnore) {
				gitIgnore.should.containEql("node_modules/")
				gitIgnore.should.containEql("*.log")
				gitIgnore.should.containEql("# Git comment")
			}
		})

		it("should handle missing ignore files in getIgnoreContent()", async () => {
			// Create a directory with no ignore files
			const emptyDir = path.join(os.tmpdir(), `llm-test-empty-${Date.now()}`)
			await fs.mkdir(emptyDir)

			try {
				const controller = new ClineIgnoreController(emptyDir)
				await controller.initialize()

				const { clineIgnore, gitIgnore } = controller.getIgnoreContent()

				// Both should be undefined
				should.not.exist(clineIgnore)
				should.not.exist(gitIgnore)
			} finally {
				await fs.rm(emptyDir, { recursive: true, force: true })
			}
		})
	})
})
