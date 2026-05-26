import * as fs from "fs/promises"
import { after, describe, it } from "mocha"
import * as os from "os"
import * as path from "path"
import "should"
import { copyWorktreeIncludeFiles, hasWorktreeInclude } from "./worktree-include"

describe("Worktree Include Utilities", () => {
	const tmpDir = path.join(os.tmpdir(), "cline-worktree-test-" + Math.random().toString(36).slice(2))
	const sourceDir = path.join(tmpDir, "source")
	const targetDir = path.join(tmpDir, "target")

	// Clean up after tests
	after(async () => {
		try {
			await fs.rm(tmpDir, { recursive: true, force: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	describe("hasWorktreeInclude", () => {
		it("should return true when .worktreeinclude exists", async () => {
			const testDir = path.join(tmpDir, "has-include")
			await fs.mkdir(testDir, { recursive: true })
			await fs.writeFile(path.join(testDir, ".worktreeinclude"), "node_modules/")

			const result = await hasWorktreeInclude(testDir)
			result.should.be.true()
		})

		it("should return false when .worktreeinclude does not exist", async () => {
			const testDir = path.join(tmpDir, "no-include")
			await fs.mkdir(testDir, { recursive: true })

			const result = await hasWorktreeInclude(testDir)
			result.should.be.false()
		})
	})

	describe("copyWorktreeIncludeFiles", () => {
		it("should return empty result when no .worktreeinclude file exists", async () => {
			const src = path.join(tmpDir, "no-worktreeinclude-src")
			const tgt = path.join(tmpDir, "no-worktreeinclude-tgt")
			await fs.mkdir(src, { recursive: true })
			await fs.mkdir(tgt, { recursive: true })

			const result = await copyWorktreeIncludeFiles(src, tgt)
			result.copiedCount.should.equal(0)
			result.errors.should.be.empty()
		})

		it("should return empty result when no .gitignore file exists", async () => {
			const src = path.join(tmpDir, "no-gitignore-src")
			const tgt = path.join(tmpDir, "no-gitignore-tgt")
			await fs.mkdir(src, { recursive: true })
			await fs.mkdir(tgt, { recursive: true })
			await fs.writeFile(path.join(src, ".worktreeinclude"), "node_modules/")

			const result = await copyWorktreeIncludeFiles(src, tgt)
			result.copiedCount.should.equal(0)
			result.errors.should.be.empty()
		})

		it("should copy individual files matching both patterns", async () => {
			const src = path.join(tmpDir, "file-copy-src")
			const tgt = path.join(tmpDir, "file-copy-tgt")

			// Setup source with files
			await fs.mkdir(src, { recursive: true })
			await fs.mkdir(tgt, { recursive: true })
			await fs.writeFile(path.join(src, ".worktreeinclude"), "*.log\nbuild/")
			await fs.writeFile(path.join(src, ".gitignore"), "*.log\nbuild/")
			await fs.writeFile(path.join(src, "test.log"), "log content")
			await fs.writeFile(path.join(src, "test.txt"), "txt content") // Should not be copied

			const result = await copyWorktreeIncludeFiles(src, tgt)

			result.copiedCount.should.equal(1)
			result.errors.should.be.empty()

			// Verify the log file was copied
			const logExists = await fs.access(path.join(tgt, "test.log")).then(
				() => true,
				() => false,
			)
			logExists.should.be.true()

			// Verify the txt file was NOT copied
			const txtExists = await fs.access(path.join(tgt, "test.txt")).then(
				() => true,
				() => false,
			)
			txtExists.should.be.false()
		})

		it("should copy entire directories using native cp", async () => {
			const src = path.join(tmpDir, "dir-copy-src")
			const tgt = path.join(tmpDir, "dir-copy-tgt")

			// Setup source with directory
			await fs.mkdir(path.join(src, "node_modules", "pkg"), { recursive: true })
			await fs.mkdir(tgt, { recursive: true })
			await fs.writeFile(path.join(src, ".worktreeinclude"), "node_modules/")
			await fs.writeFile(path.join(src, ".gitignore"), "node_modules/")
			await fs.writeFile(path.join(src, "node_modules", "pkg", "index.js"), "module code")
			await fs.writeFile(path.join(src, "node_modules", "file.txt"), "file in node_modules")

			const result = await copyWorktreeIncludeFiles(src, tgt)

			result.copiedCount.should.be.greaterThan(0)
			result.errors.should.be.empty()

			// Verify the directory was copied
			const pkgExists = await fs.access(path.join(tgt, "node_modules", "pkg", "index.js")).then(
				() => true,
				() => false,
			)
			pkgExists.should.be.true()
		})

		it("should only copy files that are in both .worktreeinclude AND .gitignore", async () => {
			const src = path.join(tmpDir, "intersection-src")
			const tgt = path.join(tmpDir, "intersection-tgt")

			await fs.mkdir(src, { recursive: true })
			await fs.mkdir(tgt, { recursive: true })
			await fs.writeFile(path.join(src, ".worktreeinclude"), "*.log")
			await fs.writeFile(path.join(src, ".gitignore"), "*.tmp") // Different pattern
			await fs.writeFile(path.join(src, "test.log"), "log")
			await fs.writeFile(path.join(src, "test.tmp"), "tmp")

			const result = await copyWorktreeIncludeFiles(src, tgt)

			// Neither file should be copied since there's no intersection
			result.copiedCount.should.equal(0)
		})
	})
})
