// Mocks must come first, before imports

vi.mock("fs/promises", () => ({
	readFile: vi.fn().mockImplementation(() => Promise.resolve("")),
	stat: vi.fn().mockImplementation(() => Promise.resolve({ isDirectory: () => false })),
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockImplementation(() => Promise.resolve(true)),
}))

// Then imports
import * as fs from "fs/promises"
import type { Mock } from "vitest"

import { parseSourceCodeDefinitionsForFile } from "../index"

describe("Markdown Integration Tests", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should parse markdown files and extract headers", async () => {
		// Mock markdown content
		const markdownContent =
			"# Main Header\n\nThis is some content under the main header.\nIt spans multiple lines to meet the minimum section length.\n\n## Section 1\n\nThis is content for section 1.\nIt also spans multiple lines.\n\n### Subsection 1.1\n\nThis is a subsection with enough lines\nto meet the minimum section length requirement.\n\n## Section 2\n\nFinal section content.\nWith multiple lines.\n"

		// Mock fs.readFile to return our markdown content
		;(fs.readFile as Mock).mockImplementation(() => Promise.resolve(markdownContent))

		// Call the function with a markdown file path
		const result = await parseSourceCodeDefinitionsForFile("test.md")

		// Verify fs.readFile was called with the correct path
		expect(fs.readFile).toHaveBeenCalledWith("test.md", "utf8")

		// Check the result
		expect(result).toBeDefined()
		expect(result).toContain("# test.md")
		expect(result).toContain("1--5 | # Main Header")
		expect(result).toContain("6--10 | ## Section 1")
		expect(result).toContain("11--15 | ### Subsection 1.1")
		expect(result).toContain("16--20 | ## Section 2")
	})

	it("should handle markdown files with no headers", async () => {
		// Mock markdown content with no headers
		const markdownContent = "This is just some text.\nNo headers here.\nJust plain text."

		// Mock fs.readFile to return our markdown content
		;(fs.readFile as Mock).mockImplementation(() => Promise.resolve(markdownContent))

		// Call the function with a markdown file path
		const result = await parseSourceCodeDefinitionsForFile("no-headers.md")

		// Verify fs.readFile was called with the correct path
		expect(fs.readFile).toHaveBeenCalledWith("no-headers.md", "utf8")

		// Check the result
		expect(result).toBeUndefined()
	})

	it("should handle markdown files with headers that don't meet minimum section length", async () => {
		// Mock markdown content with headers but short sections
		const markdownContent = "# Header 1\nShort section\n\n# Header 2\nAnother short section"

		// Mock fs.readFile to return our markdown content
		;(fs.readFile as Mock).mockImplementation(() => Promise.resolve(markdownContent))

		// Call the function with a markdown file path
		const result = await parseSourceCodeDefinitionsForFile("short-sections.md")

		// Verify fs.readFile was called with the correct path
		expect(fs.readFile).toHaveBeenCalledWith("short-sections.md", "utf8")

		// Check the result - should be undefined since no sections meet the minimum length
		expect(result).toBeUndefined()
	})

	it("should handle markdown files with mixed header styles", async () => {
		// Mock markdown content with mixed header styles
		const markdownContent =
			"# ATX Header\nThis is content under an ATX header.\nIt spans multiple lines to meet the minimum section length.\n\nSetext Header\n============\nThis is content under a setext header.\nIt also spans multiple lines to meet the minimum section length.\n"

		// Mock fs.readFile to return our markdown content
		;(fs.readFile as Mock).mockImplementation(() => Promise.resolve(markdownContent))

		// Call the function with a markdown file path
		const result = await parseSourceCodeDefinitionsForFile("mixed-headers.md")

		// Verify fs.readFile was called with the correct path
		expect(fs.readFile).toHaveBeenCalledWith("mixed-headers.md", "utf8")

		// Check the result
		expect(result).toBeDefined()
		expect(result).toContain("# mixed-headers.md")
		expect(result).toContain("1--4 | # ATX Header")
		expect(result).toContain("5--9 | Setext Header")
	})
})
