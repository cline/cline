import { expect } from "chai"
import {
	estimateContentSize,
	estimateFileSize,
	estimateTokens,
	calculateMaxAllowedSize,
	wouldExceedSizeLimit,
} from "./content-size"
import fs from "fs/promises"
import path from "path"
import os from "os"

const CONTEXT_LIMIT = 1000

describe("content-size", () => {
	describe("calculateMaxAllowedSize", () => {
		it("calculates half of the context limit", () => {
			expect(calculateMaxAllowedSize(1000)).to.equal(500)
			expect(calculateMaxAllowedSize(128000)).to.equal(64000)
		})
	})

	describe("estimateTokens", () => {
		it("estimates tokens based on byte count", () => {
			expect(estimateTokens(100)).to.equal(25) // 100 bytes / 4 chars per token = 25 tokens
			expect(estimateTokens(7)).to.equal(2) // Should round up for partial tokens
		})
	})

	describe("wouldExceedSizeLimit", () => {
		it("checks if byte count would exceed half of context limit", () => {
			expect(wouldExceedSizeLimit(100, 1000)).to.equal(false) // 25 tokens < 500 tokens
			expect(wouldExceedSizeLimit(2000, 1000)).to.equal(true) // 500 tokens = 500 tokens (equal is considered exceeding)
			expect(wouldExceedSizeLimit(2004, 1000)).to.equal(true) // 501 tokens > 500 tokens
		})
	})

	describe("estimateContentSize", () => {
		it("estimates size for string content", () => {
			const content = "Hello world" // 11 bytes
			const result = estimateContentSize(content, CONTEXT_LIMIT)

			expect(result.bytes).to.equal(11)
			expect(result.estimatedTokens).to.equal(3)
			expect(result.wouldExceedLimit).to.equal(false)
		})

		it("estimates size for buffer content", () => {
			const content = Buffer.from("Hello world") // 11 bytes
			const result = estimateContentSize(content, CONTEXT_LIMIT)

			expect(result.bytes).to.equal(11)
			expect(result.estimatedTokens).to.equal(3)
			expect(result.wouldExceedLimit).to.equal(false)
		})

		it("detects when content would exceed half of context limit", () => {
			const halfContextLimit = calculateMaxAllowedSize(CONTEXT_LIMIT) // 500 tokens
			const largeContent = "x".repeat(halfContextLimit * 4 + 4) // Just over half context limit in tokens
			const result = estimateContentSize(largeContent, CONTEXT_LIMIT)

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
			expect(result.estimatedTokens).to.equal(3)
			expect(result.wouldExceedLimit).to.equal(false)
		})

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
