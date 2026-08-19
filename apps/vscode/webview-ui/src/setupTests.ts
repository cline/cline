import "@testing-library/jest-dom"
import { vi } from "vitest"

// "Official" jest workaround for mocking window.matchMedia()
// https://jestjs.io/docs/manual-mocks#mocking-methods-which-are-not-implemented-in-jsdom

Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: vi.fn().mockImplementation((query) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(), // Deprecated
		removeListener: vi.fn(), // Deprecated
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})),
})

// Mock VSCode API for webview tests
vi.stubGlobal("acquireVsCodeApi", () => ({
	postMessage: vi.fn(),
	getState: vi.fn(),
	setState: vi.fn(),
}))
