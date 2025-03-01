import { expect } from "chai"
import { extractTextFromFile } from "./extract-text"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { ContentTooLargeError } from "../../shared/errors"
import { calculateMaxAllowedSize } from "../../utils/content-size"

const CONTEXT_LIMIT = 1000

describe("extract-text", () => {
	let tempFilePath: string

	beforeEach(async () => {
		tempFilePath = path.join(os.tmpdir(), "test-file.txt")
	})

	afterEach(async () => {
		await fs.unlink(tempFilePath).catch(() => {})
	})

	it("throws error for non-existent file", async () => {
		const nonExistentPath = path.join(os.tmpdir(), "non-existent.txt")
		try {
			await extractTextFromFile(nonExistentPath, CONTEXT_LIMIT)
			throw new Error("Should have thrown error")
		} catch (error) {
			expect(error.message).to.include("File not found")
		}
	})

	it("throws ContentTooLargeError when file would exceed half of context limit", async () => {
		const halfContextLimit = calculateMaxAllowedSize(CONTEXT_LIMIT) // 500 tokens
		const largeContent = "x".repeat(halfContextLimit * 4 + 4) // Just over half context limit in tokens
		await fs.writeFile(tempFilePath, largeContent)

		try {
			await extractTextFromFile(tempFilePath, CONTEXT_LIMIT)
			throw new Error("Should have thrown error")
		} catch (error) {
			expect(error).to.be.instanceOf(ContentTooLargeError)
			expect(error.details.type).to.equal("file")
			expect(error.details.path).to.equal(tempFilePath)
			expect(error.details.size.wouldExceedLimit).to.equal(true)
		}
	})

	it("reads text file content when within size limit", async () => {
		const content = "Hello world"
		await fs.writeFile(tempFilePath, content)

		const result = await extractTextFromFile(tempFilePath, CONTEXT_LIMIT)
		expect(result).to.equal(content)
	})

	it("throws error for binary files", async () => {
		// Create a simple binary file
		const buffer = new Uint8Array([0x89, 0x50, 0x4e, 0x47]) // PNG file header
		await fs.writeFile(tempFilePath, buffer, { encoding: "binary" })

		try {
			await extractTextFromFile(tempFilePath, CONTEXT_LIMIT)
			throw new Error("Should have thrown error")
		} catch (error) {
			expect(error.message).to.include("Cannot read text for file type")
		}
	})
})
