import { promises as fs } from "fs"
import path from "path"
import { readLines } from "../read-lines"

describe("nthline", () => {
	const testFile = path.join(__dirname, "test.txt")

	beforeAll(async () => {
		// Create a test file with numbered lines
		const content = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`).join("\n")
		await fs.writeFile(testFile, content)
	})

	afterAll(async () => {
		await fs.unlink(testFile)
	})

	describe("readLines function", () => {
		it("should read lines from start when from_line is not provided", async () => {
			const lines = await readLines(testFile, 2)
			expect(lines).toEqual(["Line 1", "Line 2", "Line 3"].join("\n"))
		})

		it("should read a range of lines from a file", async () => {
			const lines = await readLines(testFile, 3, 1)
			expect(lines).toEqual(["Line 2", "Line 3", "Line 4"].join("\n"))
		})

		it("should read lines when to_line equals from_line", async () => {
			const lines = await readLines(testFile, 2, 2)
			expect(lines).toEqual("Line 3")
		})

		it("should throw error for negative to_line", async () => {
			await expect(readLines(testFile, -3)).rejects.toThrow(
				"Invalid endLine: -3. Line numbers must be non-negative integers.",
			)
		})

		it("should throw error for negative from_line", async () => {
			await expect(readLines(testFile, 3, -1)).rejects.toThrow(
				"Invalid startLine: -1. Line numbers must be non-negative integers.",
			)
		})

		it("should throw error for non-integer line numbers", async () => {
			await expect(readLines(testFile, 3, 1.5)).rejects.toThrow(
				"Invalid startLine: 1.5. Line numbers must be non-negative integers.",
			)
			await expect(readLines(testFile, 3.5)).rejects.toThrow(
				"Invalid endLine: 3.5. Line numbers must be non-negative integers.",
			)
		})

		it("should throw error when from_line > to_line", async () => {
			await expect(readLines(testFile, 1, 3)).rejects.toThrow(
				"startLine (3) must be less than or equal to endLine (1)",
			)
		})

		it("should return partial range if file ends before to_line", async () => {
			const lines = await readLines(testFile, 15, 8)
			expect(lines).toEqual(["Line 9", "Line 10"].join("\n"))
		})

		it("should throw error if from_line is beyond file length", async () => {
			await expect(readLines(testFile, 20, 15)).rejects.toThrow("does not exist")
		})
	})
})
