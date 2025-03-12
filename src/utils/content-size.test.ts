import { expect } from "chai"
import { estimateContentSize, estimateFileSize, estimateTokens, wouldExceedSizeLimit } from "./content-size"
import fs from "fs/promises"
import path from "path"
import os from "os"

const CONTEXT_LIMIT = 1000 // Context limit of 1000 tokens means max allowed size is 500 tokens

describe("content-size", () => {
	describe("estimateTokens", () => {
		it("estimates tokens based on byte count", () => {
			expect(estimateTokens(100)).to.equal(50) // 100 bytes / 2 chars per token = 50 tokens
			expect(estimateTokens(7)).to.equal(4) // Should round up for partial tokens
		})
	})

	describe("wouldExceedSizeLimit", () => {
		it("checks if byte count would exceed max allowed size", () => {
			// For deepseek (64k - 27k = 37k tokens)
			expect(wouldExceedSizeLimit(100, 37_000)).to.equal(false) // 50 tokens < 37k tokens
			expect(wouldExceedSizeLimit(148000, 37_000)).to.equal(true) // 74k tokens > 37k tokens
			// For standard models (128k - 30k = 98k tokens)
			expect(wouldExceedSizeLimit(392000, 98_000)).to.equal(true) // 196k tokens > 98k tokens
		})
	})

	describe("estimateContentSize", () => {
		it("estimates size for string content", () => {
			const content = "Hello world" // 11 bytes
			const result = estimateContentSize(content, CONTEXT_LIMIT)

			expect(result.bytes).to.equal(11)
			expect(result.estimatedTokens).to.equal(6)
			expect(result.wouldExceedLimit).to.equal(false)
		})

		it("estimates size for buffer content", () => {
			const content = Buffer.from("Hello world") // 11 bytes
			const result = estimateContentSize(content, CONTEXT_LIMIT)

			expect(result.bytes).to.equal(11)
			expect(result.estimatedTokens).to.equal(6)
			expect(result.wouldExceedLimit).to.equal(false)
		})

		it("detects when content would exceed max allowed size", () => {
			// Create content that would exceed max allowed size for deepseek (64k - 27k tokens)
			const largeContent = "x".repeat(148000) // 74k tokens > (64k - 27k) tokens
			const result = estimateContentSize(largeContent, 64_000)

			expect(result.wouldExceedLimit).to.equal(true)
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
			const result = await estimateFileSize(tempFilePath, CONTEXT_LIMIT)

			expect(result.bytes).to.equal(11)
			expect(result.estimatedTokens).to.equal(6)
			expect(result.wouldExceedLimit).to.equal(false)
		})

		/**
		 * Verifies that estimateFileSize properly throws an error when given a
		 * non-existent file path, which is important for error handling in the application.
		 * The test expects fs.stat() inside estimateFileSize to fail and throw.
		 */
		it("throws error for non-existent file", async () => {
			const nonExistentPath = path.join(os.tmpdir(), "non-existent.txt")
			try {
				await estimateFileSize(nonExistentPath, CONTEXT_LIMIT)
				throw new Error("Should have thrown error")
			} catch (error) {
				expect(error).to.be.instanceOf(Error)
			}
		})
	})
})
