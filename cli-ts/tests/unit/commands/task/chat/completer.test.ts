/**
 * Tests for @ file/folder completion and Tab mode toggle
 */

import { expect } from "chai"
import fs from "fs"
import os from "os"
import path from "path"
import sinon from "sinon"
import { createCompleter, findAtMentionToComplete, getPathCompletions } from "../../../../../src/commands/task/chat/completer.js"

describe("completer", () => {
	describe("findAtMentionToComplete", () => {
		it("should return null when no @ present", () => {
			const result = findAtMentionToComplete("hello world")
			expect(result).to.be.null
		})

		it("should find @ at the start of line", () => {
			const result = findAtMentionToComplete("@src/file")
			expect(result).to.not.be.null
			expect(result!.prefix).to.equal("")
			expect(result!.partial).to.equal("src/file")
			expect(result!.atIndex).to.equal(0)
		})

		it("should find @ after whitespace", () => {
			const result = findAtMentionToComplete("look at @src/file")
			expect(result).to.not.be.null
			expect(result!.prefix).to.equal("look at ")
			expect(result!.partial).to.equal("src/file")
			expect(result!.atIndex).to.equal(8)
		})

		it("should return null when @ is in middle of word", () => {
			const result = findAtMentionToComplete("email@example.com")
			expect(result).to.be.null
		})

		it("should return null when @ mention is complete (followed by space)", () => {
			const result = findAtMentionToComplete("@file.ts and more text")
			expect(result).to.be.null
		})

		it("should find last incomplete @ mention when multiple present", () => {
			const result = findAtMentionToComplete("@file1.ts @src/")
			expect(result).to.not.be.null
			expect(result!.prefix).to.equal("@file1.ts ")
			expect(result!.partial).to.equal("src/")
		})

		it("should handle empty partial after @", () => {
			const result = findAtMentionToComplete("check @")
			expect(result).to.not.be.null
			expect(result!.prefix).to.equal("check ")
			expect(result!.partial).to.equal("")
		})

		it("should handle @ at start with empty partial", () => {
			const result = findAtMentionToComplete("@")
			expect(result).to.not.be.null
			expect(result!.prefix).to.equal("")
			expect(result!.partial).to.equal("")
		})
	})

	describe("getPathCompletions", () => {
		let tempDir: string

		beforeEach(() => {
			// Create temp directory with test files
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "completer-test-"))
			fs.writeFileSync(path.join(tempDir, "file1.ts"), "")
			fs.writeFileSync(path.join(tempDir, "file2.ts"), "")
			fs.writeFileSync(path.join(tempDir, "readme.md"), "")
			fs.mkdirSync(path.join(tempDir, "src"))
			fs.writeFileSync(path.join(tempDir, "src", "index.ts"), "")
			fs.mkdirSync(path.join(tempDir, "tests"))
			fs.writeFileSync(path.join(tempDir, ".hidden"), "")
		})

		afterEach(() => {
			// Clean up temp directory
			fs.rmSync(tempDir, { recursive: true, force: true })
		})

		it("should list directory contents when partial is empty", () => {
			const completions = getPathCompletions("", tempDir)
			expect(completions).to.include("src/")
			expect(completions).to.include("tests/")
			expect(completions).to.include("file1.ts")
			expect(completions).to.include("file2.ts")
			expect(completions).to.include("readme.md")
		})

		it("should not include hidden files by default", () => {
			const completions = getPathCompletions("", tempDir)
			expect(completions).to.not.include(".hidden")
		})

		it("should include hidden files when prefix starts with dot", () => {
			const completions = getPathCompletions(".", tempDir)
			expect(completions).to.include(".hidden")
		})

		it("should filter by prefix", () => {
			const completions = getPathCompletions("file", tempDir)
			expect(completions).to.include("file1.ts")
			expect(completions).to.include("file2.ts")
			expect(completions).to.not.include("readme.md")
		})

		it("should list subdirectory contents", () => {
			const completions = getPathCompletions("src/", tempDir)
			expect(completions).to.include("src/index.ts")
		})

		it("should complete partial paths in subdirectory", () => {
			const completions = getPathCompletions("src/ind", tempDir)
			expect(completions).to.include("src/index.ts")
		})

		it("should return empty array for non-existent path", () => {
			const completions = getPathCompletions("nonexistent/", tempDir)
			expect(completions).to.be.empty
		})

		it("should sort directories before files", () => {
			const completions = getPathCompletions("", tempDir)
			const srcIndex = completions.indexOf("src/")
			const file1Index = completions.indexOf("file1.ts")
			expect(srcIndex).to.be.lessThan(file1Index)
		})

		it("should be case-insensitive when filtering", () => {
			const completions = getPathCompletions("FILE", tempDir)
			expect(completions).to.include("file1.ts")
			expect(completions).to.include("file2.ts")
		})
	})

	describe("createCompleter", () => {
		let tempDir: string

		beforeEach(() => {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "completer-test-"))
			fs.writeFileSync(path.join(tempDir, "file.ts"), "")
			fs.mkdirSync(path.join(tempDir, "src"))
		})

		afterEach(() => {
			fs.rmSync(tempDir, { recursive: true, force: true })
		})

		it("should return no completions when no @ present", () => {
			const completer = createCompleter({ cwd: tempDir })
			const [completions] = completer("hello world")
			expect(completions).to.be.empty
		})

		it("should return completions with full line prefix", () => {
			const completer = createCompleter({ cwd: tempDir })
			const [completions] = completer("look at @fi")
			expect(completions).to.include("look at @file.ts")
		})

		it("should handle empty @ mention", () => {
			const completer = createCompleter({ cwd: tempDir })
			const [completions] = completer("@")
			expect(completions.length).to.be.greaterThan(0)
			expect(completions.some((c) => c.startsWith("@"))).to.be.true
		})

		it("should preserve prefix for multiple @ mentions", () => {
			const completer = createCompleter({ cwd: tempDir })
			const [completions] = completer("@file.ts @sr")
			expect(completions).to.include("@file.ts @src/")
		})
	})

	describe("onEmptyTab callback", () => {
		let tempDir: string

		beforeEach(() => {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "completer-test-"))
			fs.writeFileSync(path.join(tempDir, "file.ts"), "")
		})

		afterEach(() => {
			fs.rmSync(tempDir, { recursive: true, force: true })
		})

		it("should call onEmptyTab when line is empty", () => {
			const onEmptyTab = sinon.stub()
			const completer = createCompleter({ cwd: tempDir, onEmptyTab })
			const [completions] = completer("")
			expect(onEmptyTab.calledOnce).to.be.true
			expect(completions).to.be.empty
		})

		it("should NOT call onEmptyTab when line has whitespace", () => {
			const onEmptyTab = sinon.stub()
			const completer = createCompleter({ cwd: tempDir, onEmptyTab })
			const [completions] = completer("   ")
			expect(onEmptyTab.called).to.be.false
			expect(completions).to.be.empty
		})

		it("should NOT call onEmptyTab when line has content", () => {
			const onEmptyTab = sinon.stub()
			const completer = createCompleter({ cwd: tempDir, onEmptyTab })
			completer("hello")
			expect(onEmptyTab.called).to.be.false
		})

		it("should NOT call onEmptyTab when line is just @", () => {
			const onEmptyTab = sinon.stub()
			const completer = createCompleter({ cwd: tempDir, onEmptyTab })
			const [completions] = completer("@")
			expect(onEmptyTab.called).to.be.false
			// Should still do file completion
			expect(completions.length).to.be.greaterThan(0)
		})

		it("should work without onEmptyTab callback", () => {
			const completer = createCompleter({ cwd: tempDir })
			const [completions] = completer("")
			// Should just return empty completions, no error
			expect(completions).to.be.empty
		})
	})
})
