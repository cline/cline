// npx vitest services/browser/__tests__/BrowserSession.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest"
import { BrowserSession } from "../BrowserSession"
import { discoverChromeHostUrl, tryChromeHostUrl } from "../browserDiscovery"
import { fileExistsAtPath } from "../../../utils/fs"

// Mock dependencies
vi.mock("vscode", () => ({
	ExtensionContext: vi.fn(),
	Uri: {
		file: vi.fn((path) => ({ fsPath: path })),
	},
}))

// Mock puppeteer-core
vi.mock("puppeteer-core", () => {
	const mockBrowser = {
		newPage: vi.fn().mockResolvedValue({
			goto: vi.fn().mockResolvedValue(undefined),
			on: vi.fn(),
			off: vi.fn(),
			screenshot: vi.fn().mockResolvedValue("mockScreenshotBase64"),
			url: vi.fn().mockReturnValue("https://example.com"),
		}),
		pages: vi.fn().mockResolvedValue([]),
		close: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn().mockResolvedValue(undefined),
	}

	return {
		Browser: vi.fn(),
		Page: vi.fn(),
		TimeoutError: class TimeoutError extends Error {},
		launch: vi.fn().mockResolvedValue(mockBrowser),
		connect: vi.fn().mockResolvedValue(mockBrowser),
	}
})

// Mock PCR
vi.mock("puppeteer-chromium-resolver", () => {
	return {
		default: vi.fn().mockResolvedValue({
			puppeteer: {
				launch: vi.fn().mockImplementation(async () => {
					const { launch } = await import("puppeteer-core")
					return launch()
				}),
			},
			executablePath: "/mock/path/to/chromium",
		}),
	}
})

// Mock fs
vi.mock("fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn(),
	writeFile: vi.fn(),
	access: vi.fn(),
}))

// Mock fileExistsAtPath
vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockResolvedValue(false),
}))

// Mock browser discovery functions
vi.mock("../browserDiscovery", () => ({
	discoverChromeHostUrl: vi.fn().mockResolvedValue(null),
	tryChromeHostUrl: vi.fn().mockResolvedValue(false),
}))

// Mock delay
vi.mock("delay", () => ({
	default: vi.fn().mockResolvedValue(undefined),
}))

// Mock p-wait-for
vi.mock("p-wait-for", () => ({
	default: vi.fn().mockResolvedValue(undefined),
}))

describe("BrowserSession", () => {
	let browserSession: BrowserSession
	let mockContext: any

	beforeEach(() => {
		vi.clearAllMocks()

		// Set up mock context
		mockContext = {
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
			},
			globalStorageUri: {
				fsPath: "/mock/global/storage/path",
			},
			extensionUri: {
				fsPath: "/mock/extension/path",
			},
		}

		// Create browser session
		browserSession = new BrowserSession(mockContext)
	})

	describe("Remote browser disabled", () => {
		it("should launch a local browser when remote browser is disabled", async () => {
			// Mock context to indicate remote browser is disabled
			mockContext.globalState.get.mockImplementation((key: string) => {
				if (key === "remoteBrowserEnabled") return false
				return undefined
			})

			await browserSession.launchBrowser()

			const puppeteerCore = await import("puppeteer-core")

			// Verify that a local browser was launched
			expect(puppeteerCore.launch).toHaveBeenCalled()

			// Verify that remote browser connection was not attempted
			expect(discoverChromeHostUrl).not.toHaveBeenCalled()
			expect(tryChromeHostUrl).not.toHaveBeenCalled()

			expect((browserSession as any).isUsingRemoteBrowser).toBe(false)
		})
	})

	describe("Remote browser successfully connects", () => {
		it("should connect to a remote browser when enabled and connection succeeds", async () => {
			// Mock context to indicate remote browser is enabled
			mockContext.globalState.get.mockImplementation((key: string) => {
				if (key === "remoteBrowserEnabled") return true
				if (key === "remoteBrowserHost") return "http://remote-browser:9222"
				return undefined
			})

			// Mock successful remote browser connection
			vi.mocked(tryChromeHostUrl).mockResolvedValue(true)

			await browserSession.launchBrowser()

			const puppeteerCore = await import("puppeteer-core")

			// Verify that connect was called
			expect(puppeteerCore.connect).toHaveBeenCalled()

			// Verify that local browser was not launched
			expect(puppeteerCore.launch).not.toHaveBeenCalled()

			expect((browserSession as any).isUsingRemoteBrowser).toBe(true)
		})
	})

	describe("Remote browser enabled but falls back to local", () => {
		it("should fall back to local browser when remote connection fails", async () => {
			// Mock context to indicate remote browser is enabled
			mockContext.globalState.get.mockImplementation((key: string) => {
				if (key === "remoteBrowserEnabled") return true
				if (key === "remoteBrowserHost") return "http://remote-browser:9222"
				return undefined
			})

			// Mock failed remote browser connection
			vi.mocked(tryChromeHostUrl).mockResolvedValue(false)
			vi.mocked(discoverChromeHostUrl).mockResolvedValue(null)

			await browserSession.launchBrowser()

			// Import puppeteer-core to check if launch was called
			const puppeteerCore = await import("puppeteer-core")

			// Verify that local browser was launched as fallback
			expect(puppeteerCore.launch).toHaveBeenCalled()

			// Verify that isUsingRemoteBrowser is false
			expect((browserSession as any).isUsingRemoteBrowser).toBe(false)
		})
	})

	describe("closeBrowser", () => {
		it("should close a local browser properly", async () => {
			const puppeteerCore = await import("puppeteer-core")

			// Create a mock browser directly
			const mockBrowser = {
				newPage: vi.fn().mockResolvedValue({}),
				pages: vi.fn().mockResolvedValue([]),
				close: vi.fn().mockResolvedValue(undefined),
				disconnect: vi.fn().mockResolvedValue(undefined),
			}

			// Set browser and page on the session
			;(browserSession as any).browser = mockBrowser
			;(browserSession as any).page = {}
			;(browserSession as any).isUsingRemoteBrowser = false

			await browserSession.closeBrowser()

			// Verify that browser.close was called
			expect(mockBrowser.close).toHaveBeenCalled()
			expect(mockBrowser.disconnect).not.toHaveBeenCalled()

			// Verify that browser state was reset
			expect((browserSession as any).browser).toBeUndefined()
			expect((browserSession as any).page).toBeUndefined()
			expect((browserSession as any).isUsingRemoteBrowser).toBe(false)
		})

		it("should disconnect from a remote browser properly", async () => {
			// Create a mock browser directly
			const mockBrowser = {
				newPage: vi.fn().mockResolvedValue({}),
				pages: vi.fn().mockResolvedValue([]),
				close: vi.fn().mockResolvedValue(undefined),
				disconnect: vi.fn().mockResolvedValue(undefined),
			}

			// Set browser and page on the session
			;(browserSession as any).browser = mockBrowser
			;(browserSession as any).page = {}
			;(browserSession as any).isUsingRemoteBrowser = true

			await browserSession.closeBrowser()

			// Verify that browser.disconnect was called
			expect(mockBrowser.disconnect).toHaveBeenCalled()
			expect(mockBrowser.close).not.toHaveBeenCalled()
		})
	})
})
