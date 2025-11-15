import { expect } from "chai"
import { formatResponse } from "../responses"

describe("formatResponse.formatFlatFileList", () => {
	it("should convert absolute paths to relative paths", () => {
		const workspaceRoot = "/Users/test/project"
		const files = ["/Users/test/project/src/index.ts", "/Users/test/project/lib/utils.ts"]

		const result = formatResponse.formatFlatFileList(workspaceRoot, files, false)

		expect(result).to.include("src/index.ts")
		expect(result).to.include("lib/utils.ts")
		expect(result).to.not.include("/Users/test/project")
	})

	it("should sort files alphabetically", () => {
		const workspaceRoot = "/Users/test/project"
		const files = ["/Users/test/project/zebra.ts", "/Users/test/project/apple.ts", "/Users/test/project/banana.ts"]

		const result = formatResponse.formatFlatFileList(workspaceRoot, files, false)

		const lines = result.split("\n")
		expect(lines[0]).to.equal("apple.ts")
		expect(lines[1]).to.equal("banana.ts")
		expect(lines[2]).to.equal("zebra.ts")
	})

	it("should handle numeric sorting correctly", () => {
		const workspaceRoot = "/Users/test/project"
		const files = ["/Users/test/project/file10.ts", "/Users/test/project/file2.ts", "/Users/test/project/file1.ts"]

		const result = formatResponse.formatFlatFileList(workspaceRoot, files, false)

		const lines = result.split("\n")
		expect(lines[0]).to.equal("file1.ts")
		expect(lines[1]).to.equal("file2.ts")
		expect(lines[2]).to.equal("file10.ts")
	})

	it("should handle empty file list", () => {
		const workspaceRoot = "/Users/test/project"
		const files: string[] = []

		const result = formatResponse.formatFlatFileList(workspaceRoot, files, false)

		expect(result).to.equal("No files found.")
	})

	it("should add truncation message when didHitLimit is true", () => {
		const workspaceRoot = "/Users/test/project"
		const files = ["/Users/test/project/file1.ts", "/Users/test/project/file2.ts"]

		const result = formatResponse.formatFlatFileList(workspaceRoot, files, true)

		expect(result).to.include("file1.ts")
		expect(result).to.include("file2.ts")
		expect(result).to.include(
			"(File list truncated. Use list_files on specific subdirectories if you need to explore further.)",
		)
	})

	it("should not add truncation message when didHitLimit is false", () => {
		const workspaceRoot = "/Users/test/project"
		const files = ["/Users/test/project/file1.ts"]

		const result = formatResponse.formatFlatFileList(workspaceRoot, files, false)

		expect(result).to.not.include("truncated")
	})

	it("should handle nested directory structures", () => {
		const workspaceRoot = "/Users/test/project"
		const files = [
			"/Users/test/project/src/components/Button.tsx",
			"/Users/test/project/src/utils/helpers.ts",
			"/Users/test/project/tests/unit/button.test.ts",
		]

		const result = formatResponse.formatFlatFileList(workspaceRoot, files, false)

		expect(result).to.include("src/components/Button.tsx")
		expect(result).to.include("src/utils/helpers.ts")
		expect(result).to.include("tests/unit/button.test.ts")
	})

	it("should use forward slashes for paths", () => {
		const workspaceRoot = "/Users/test/project"
		const files = ["/Users/test/project/src/index.ts"]

		const result = formatResponse.formatFlatFileList(workspaceRoot, files, false)

		expect(result).to.include("src/index.ts")
		expect(result).to.not.include("\\")
	})

	it("should handle files at workspace root", () => {
		const workspaceRoot = "/Users/test/project"
		const files = ["/Users/test/project/README.md", "/Users/test/project/package.json"]

		const result = formatResponse.formatFlatFileList(workspaceRoot, files, false)

		expect(result).to.include("README.md")
		expect(result).to.include("package.json")
	})

	it("should sort case-insensitively", () => {
		const workspaceRoot = "/Users/test/project"
		const files = ["/Users/test/project/Zebra.ts", "/Users/test/project/apple.ts", "/Users/test/project/Banana.ts"]

		const result = formatResponse.formatFlatFileList(workspaceRoot, files, false)

		const lines = result.split("\n")
		expect(lines[0]).to.equal("apple.ts")
		expect(lines[1]).to.equal("Banana.ts")
		expect(lines[2]).to.equal("Zebra.ts")
	})

	it("should handle single file", () => {
		const workspaceRoot = "/Users/test/project"
		const files = ["/Users/test/project/index.ts"]

		const result = formatResponse.formatFlatFileList(workspaceRoot, files, false)

		expect(result).to.equal("index.ts")
	})

	it("should separate files with newlines", () => {
		const workspaceRoot = "/Users/test/project"
		const files = ["/Users/test/project/file1.ts", "/Users/test/project/file2.ts", "/Users/test/project/file3.ts"]

		const result = formatResponse.formatFlatFileList(workspaceRoot, files, false)

		const lines = result.split("\n")
		expect(lines).to.have.lengthOf(3)
		expect(lines[0]).to.equal("file1.ts")
		expect(lines[1]).to.equal("file2.ts")
		expect(lines[2]).to.equal("file3.ts")
	})
})
