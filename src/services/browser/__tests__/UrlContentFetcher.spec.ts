// npx vitest services/browser/__tests__/UrlContentFetcher.spec.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { UrlContentFetcher } from "../UrlContentFetcher"
import { fileExistsAtPath } from "../../../utils/fs"
import * as path from "path"

// Mock dependencies
vi.mock("vscode", () => ({
	ExtensionContext: vi.fn(),
	Uri: {
		file: vi.fn((path) => ({ fsPath: path })),
	},
}))

// Mock fs/promises
vi.mock("fs/promises", () => ({
	default: {
		mkdir: vi.fn().mockResolvedValue(undefined),
	},
	mkdir: vi.fn().mockResolvedValue(undefined),
}))

// Mock utils/fs
vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockResolvedValue(true),
}))

// Mock cheerio
vi.mock("cheerio", () => ({
	load: vi.fn(() => {
		const $ = vi.fn((selector) => ({
			remove: vi.fn().mockReturnThis(),
		})) as any
		$.html = vi.fn().mockReturnValue("<html><body>Test content</body></html>")
		return $
	}),
}))

// Mock turndown
vi.mock("turndown", () => {
	return {
		default: class MockTurndownService {
			turndown = vi.fn().mockReturnValue("# Test content")
		},
	}
})

// Mock puppeteer-chromium-resolver
vi.mock("puppeteer-chromium-resolver", () => ({
	default: vi.fn().mockResolvedValue({
		puppeteer: {
			launch: vi.fn().mockResolvedValue({
				newPage: vi.fn().mockResolvedValue({
					goto: vi.fn(),
					content: vi.fn().mockResolvedValue("<html><body>Test content</body></html>"),
					setViewport: vi.fn().mockResolvedValue(undefined),
					setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
				}),
				close: vi.fn().mockResolvedValue(undefined),
			}),
		},
		executablePath: "/path/to/chromium",
	}),
}))

// Mock serialize-error
vi.mock("serialize-error", () => ({
	serializeError: vi.fn((error) => {
		if (error instanceof Error) {
			return { message: error.message, name: error.name }
		} else if (typeof error === "string") {
			return { message: error }
		} else if (error && typeof error === "object" && "message" in error) {
			return { message: String(error.message), name: "name" in error ? String(error.name) : undefined }
		} else {
			return { message: String(error) }
		}
	}),
}))

describe("UrlContentFetcher", () => {
	let urlContentFetcher: UrlContentFetcher
	let mockContext: any
	let mockPage: any
	let mockBrowser: any
	let PCR: any

	beforeEach(async () => {
		vi.clearAllMocks()

		mockContext = {
			globalStorageUri: {
				fsPath: "/test/storage",
			},
		}

		mockPage = {
			goto: vi.fn(),
			content: vi.fn().mockResolvedValue("<html><body>Test content</body></html>"),
			setViewport: vi.fn().mockResolvedValue(undefined),
			setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
		}

		mockBrowser = {
			newPage: vi.fn().mockResolvedValue(mockPage),
			close: vi.fn().mockResolvedValue(undefined),
		}

		// Reset PCR mock
		// @ts-ignore
		PCR = (await import("puppeteer-chromium-resolver")).default
		vi.mocked(PCR).mockResolvedValue({
			puppeteer: {
				launch: vi.fn().mockResolvedValue(mockBrowser),
			},
			executablePath: "/path/to/chromium",
		})

		urlContentFetcher = new UrlContentFetcher(mockContext)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("launchBrowser", () => {
		it("should launch browser with correct arguments", async () => {
			await urlContentFetcher.launchBrowser()

			expect(vi.mocked(PCR)).toHaveBeenCalledWith({
				downloadPath: path.join("/test/storage", "puppeteer"),
			})

			const stats = await vi.mocked(PCR).mock.results[0].value
			expect(stats.puppeteer.launch).toHaveBeenCalledWith({
				args: [
					"--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
					"--disable-dev-shm-usage",
					"--disable-accelerated-2d-canvas",
					"--no-first-run",
					"--disable-gpu",
					"--disable-features=VizDisplayCompositor",
				],
				executablePath: "/path/to/chromium",
			})
		})

		it("should set viewport and headers after launching", async () => {
			await urlContentFetcher.launchBrowser()

			expect(mockPage.setViewport).toHaveBeenCalledWith({ width: 1280, height: 720 })
			expect(mockPage.setExtraHTTPHeaders).toHaveBeenCalledWith({
				"Accept-Language": "en-US,en;q=0.9",
			})
		})

		it("should not launch browser if already launched", async () => {
			await urlContentFetcher.launchBrowser()
			const initialCallCount = vi.mocked(PCR).mock.calls.length

			await urlContentFetcher.launchBrowser()
			expect(vi.mocked(PCR)).toHaveBeenCalledTimes(initialCallCount)
		})
	})

	describe("urlToMarkdown", () => {
		beforeEach(async () => {
			await urlContentFetcher.launchBrowser()
		})

		it("should successfully fetch and convert URL to markdown", async () => {
			mockPage.goto.mockResolvedValueOnce(undefined)

			const result = await urlContentFetcher.urlToMarkdown("https://example.com")

			expect(mockPage.goto).toHaveBeenCalledWith("https://example.com", {
				timeout: 30000,
				waitUntil: ["domcontentloaded", "networkidle2"],
			})
			expect(result).toBe("# Test content")
		})

		it("should retry with domcontentloaded only when networkidle2 fails", async () => {
			const timeoutError = new Error("Navigation timeout of 30000 ms exceeded")
			mockPage.goto.mockRejectedValueOnce(timeoutError).mockResolvedValueOnce(undefined)

			const result = await urlContentFetcher.urlToMarkdown("https://example.com")

			expect(mockPage.goto).toHaveBeenCalledTimes(2)
			expect(mockPage.goto).toHaveBeenNthCalledWith(1, "https://example.com", {
				timeout: 30000,
				waitUntil: ["domcontentloaded", "networkidle2"],
			})
			expect(mockPage.goto).toHaveBeenNthCalledWith(2, "https://example.com", {
				timeout: 20000,
				waitUntil: ["domcontentloaded"],
			})
			expect(result).toBe("# Test content")
		})

		it("should retry for network errors", async () => {
			const networkError = new Error("net::ERR_CONNECTION_REFUSED")
			mockPage.goto.mockRejectedValueOnce(networkError).mockResolvedValueOnce(undefined)

			const result = await urlContentFetcher.urlToMarkdown("https://example.com")

			expect(mockPage.goto).toHaveBeenCalledTimes(2)
			expect(result).toBe("# Test content")
		})

		it("should retry for TimeoutError", async () => {
			const timeoutError = new Error("TimeoutError: Navigation timeout")
			timeoutError.name = "TimeoutError"
			mockPage.goto.mockRejectedValueOnce(timeoutError).mockResolvedValueOnce(undefined)

			const result = await urlContentFetcher.urlToMarkdown("https://example.com")

			expect(mockPage.goto).toHaveBeenCalledTimes(2)
			expect(result).toBe("# Test content")
		})

		it("should not retry for non-network/timeout errors", async () => {
			const otherError = new Error("Some other error")
			mockPage.goto.mockRejectedValueOnce(otherError)

			await expect(urlContentFetcher.urlToMarkdown("https://example.com")).rejects.toThrow("Some other error")
			expect(mockPage.goto).toHaveBeenCalledTimes(1)
		})

		it("should throw error if browser not initialized", async () => {
			const newFetcher = new UrlContentFetcher(mockContext)

			await expect(newFetcher.urlToMarkdown("https://example.com")).rejects.toThrow("Browser not initialized")
		})

		it("should handle errors without message property", async () => {
			const errorWithoutMessage = { code: "UNKNOWN_ERROR" }
			mockPage.goto.mockRejectedValueOnce(errorWithoutMessage)

			// serialize-error will convert this to a proper error with the object stringified
			await expect(urlContentFetcher.urlToMarkdown("https://example.com")).rejects.toThrow()

			// Should not retry for non-network errors
			expect(mockPage.goto).toHaveBeenCalledTimes(1)
		})

		it("should handle error objects with message property", async () => {
			const errorWithMessage = { message: "Custom error", code: "CUSTOM_ERROR" }
			mockPage.goto.mockRejectedValueOnce(errorWithMessage)

			await expect(urlContentFetcher.urlToMarkdown("https://example.com")).rejects.toThrow("Custom error")

			// Should not retry for error objects with message property (they're treated as known errors)
			expect(mockPage.goto).toHaveBeenCalledTimes(1)
		})

		it("should retry for error objects with network-related messages", async () => {
			const errorWithNetworkMessage = { message: "net::ERR_CONNECTION_REFUSED", code: "NETWORK_ERROR" }
			mockPage.goto.mockRejectedValueOnce(errorWithNetworkMessage).mockResolvedValueOnce(undefined)

			const result = await urlContentFetcher.urlToMarkdown("https://example.com")

			// Should retry for network-related errors even in non-Error objects
			expect(mockPage.goto).toHaveBeenCalledTimes(2)
			expect(result).toBe("# Test content")
		})

		it("should handle string errors", async () => {
			const stringError = "Simple string error"
			mockPage.goto.mockRejectedValueOnce(stringError)

			await expect(urlContentFetcher.urlToMarkdown("https://example.com")).rejects.toThrow("Simple string error")
			expect(mockPage.goto).toHaveBeenCalledTimes(1)
		})
	})

	describe("closeBrowser", () => {
		it("should close browser and reset state", async () => {
			await urlContentFetcher.launchBrowser()
			await urlContentFetcher.closeBrowser()

			expect(mockBrowser.close).toHaveBeenCalled()
		})

		it("should handle closing when browser not initialized", async () => {
			await expect(urlContentFetcher.closeBrowser()).resolves.not.toThrow()
		})
	})
})
