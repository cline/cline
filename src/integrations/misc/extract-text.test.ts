import { expect } from "chai"
import { extractTextFromFile } from "./extract-text"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { ContentTooLargeError } from "../../shared/errors"

const CONTEXT_LIMIT = 1000 // Context limit of 1000 tokens means max allowed size is 500 tokens

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

	it("throws ContentTooLargeError when file would exceed max allowed size", async () => {
		// Create content that would exceed max allowed size (37k tokens)
		const largeContent = "x".repeat(148000) // 37k tokens
		await fs.writeFile(tempFilePath, largeContent)

		try {
			await extractTextFromFile(tempFilePath, 37_000) // Pass pre-processed maxAllowedSize
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
