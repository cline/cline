import { expect } from "chai"
import { estimateContentSize, estimateFileSize, estimateTokens } from "./content-size"
import fs from "fs/promises"
import path from "path"
import os from "os"

const CONTEXT_LIMIT = 1000
const USED_CONTEXT = 200

describe("content-size", () => {
	describe("estimateTokens", () => {
		it("estimates tokens based on byte count", () => {
			expect(estimateTokens(100)).to.equal(25) // 100 bytes / 4 chars per token = 25 tokens
			expect(estimateTokens(7)).to.equal(2) // Should round up for partial tokens
		})
	})

	describe("estimateContentSize", () => {
		it("estimates size for string content", () => {
			const content = "Hello world" // 11 bytes
			const result = estimateContentSize(content, CONTEXT_LIMIT, USED_CONTEXT)

			expect(result.bytes).to.equal(11)
			expect(result.estimatedTokens).to.equal(3)
			expect(result.remainingContextSize).to.equal(800)
			expect(result.wouldExceedLimit).to.equal(false)
		})

		it("estimates size for buffer content", () => {
			const content = Buffer.from("Hello world") // 11 bytes
			const result = estimateContentSize(content, CONTEXT_LIMIT, USED_CONTEXT)

			expect(result.bytes).to.equal(11)
			expect(result.estimatedTokens).to.equal(3)
			expect(result.remainingContextSize).to.equal(800)
			expect(result.wouldExceedLimit).to.equal(false)
		})

		it("detects when content would exceed limit", () => {
			const largeContent = "x".repeat(3000) // 3000 bytes = ~750 tokens
			const result = estimateContentSize(largeContent, CONTEXT_LIMIT, USED_CONTEXT)

			expect(result.wouldExceedLimit).to.equal(true)
			expect(result.remainingContextSize).to.equal(800)
		})
	})

	describe("estimateFileSize", () => {
		let tempFilePath: string

		beforeEach(async () => {
			tempFilePath = path.join(os.tmpdir(), "test-file.txt")
			await fs.writeFile(tempFilePath, "Hello world") // 11 bytes
		})

		afterEach(async () => {
			await fs.unlink(tempFilePath).catch(() => {})
		})

		it("estimates size for existing file", async () => {
			const result = await estimateFileSize(tempFilePath, CONTEXT_LIMIT, USED_CONTEXT)

			expect(result.bytes).to.equal(11)
			expect(result.estimatedTokens).to.equal(3)
			expect(result.remainingContextSize).to.equal(800)
			expect(result.wouldExceedLimit).to.equal(false)
		})

		it("throws error for non-existent file", async () => {
			const nonExistentPath = path.join(os.tmpdir(), "non-existent.txt")
			try {
				await estimateFileSize(nonExistentPath, CONTEXT_LIMIT, USED_CONTEXT)
				throw new Error("Should have thrown error")
			} catch (error) {
				expect(error).to.be.instanceOf(Error)
			}
		})
	})
})
