import "@testing-library/jest-dom"
import "@testing-library/jest-dom/vitest"

class MockResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

global.ResizeObserver = MockResizeObserver

// Fix for Microsoft FAST Foundation compatibility with JSDOM
// FAST Foundation tries to set HTMLElement.focus property, but it's read-only in JSDOM
// The issue is that FAST Foundation's handleUnsupportedDelegatesFocus tries to set element.focus = originalFocus
// but JSDOM's HTMLElement.focus is a getter-only property
Object.defineProperty(HTMLElement.prototype, "focus", {
	get: function () {
		return (
			this._focus ||
			function () {
				// Mock focus behavior for tests
			}
		)
	},
	set: function (value) {
		this._focus = value
	},
	configurable: true,
})

Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: vi.fn().mockImplementation((query) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})),
})

// Mock scrollIntoView which is not available in jsdom
Element.prototype.scrollIntoView = vi.fn()

// Suppress console.log during tests to reduce noise.
// Keep console.error for actual errors.
const originalConsoleLog = console.log
const originalConsoleWarn = console.warn
const originalConsoleInfo = console.info

console.log = () => {}
console.warn = () => {}
console.info = () => {}

afterAll(() => {
	console.log = originalConsoleLog
	console.warn = originalConsoleWarn
	console.info = originalConsoleInfo
})
