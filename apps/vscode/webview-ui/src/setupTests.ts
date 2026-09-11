import "@testing-library/jest-dom"
import { setI18n } from "react-i18next"
import { vi } from "vitest"
import { i18n } from "./i18n"

// Make the app's i18next instance the react-i18next default so components
// render English strings in tests without needing an explicit I18nextProvider.
setI18n(i18n)

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
