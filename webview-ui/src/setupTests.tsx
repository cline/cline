import "@testing-library/jest-dom"
import { setupI18nForTests } from "./i18n/test-utils"

// Set up i18n for all tests
setupI18nForTests()

// Mock crypto.getRandomValues
Object.defineProperty(window, "crypto", {
	value: {
		getRandomValues: function (buffer: Uint8Array) {
			for (let i = 0; i < buffer.length; i++) {
				buffer[i] = Math.floor(Math.random() * 256)
			}
			return buffer
		},
	},
})

// Mock matchMedia
Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: jest.fn().mockImplementation((query) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: jest.fn(), // deprecated
		removeListener: jest.fn(), // deprecated
		addEventListener: jest.fn(),
		removeEventListener: jest.fn(),
		dispatchEvent: jest.fn(),
	})),
})

// Mock lucide-react icons globally using Proxy for dynamic icon handling
jest.mock("lucide-react", () => {
	return new Proxy(
		{},
		{
			get: function (_obj, prop) {
				// Return a component factory for any icon that's requested
				if (prop === "__esModule") {
					return true
				}
				return (props: any) => (
					<div {...props} data-testid={`${String(prop)}-icon`}>
						{String(prop)}
					</div>
				)
			},
		},
	)
})
