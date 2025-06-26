// npx vitest run src/components/common/__tests__/CodeBlock.spec.tsx

import { render, screen, fireEvent, act } from "@/utils/test-utils"

import CodeBlock from "../CodeBlock"

// Mock the translation context
vi.mock("../../../i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => {
			// Return fixed English strings for tests
			const translations: { [key: string]: string } = {
				"chat:codeblock.tooltips.copy_code": "Copy code",
				"chat:codeblock.tooltips.expand": "Expand code block",
				"chat:codeblock.tooltips.collapse": "Collapse code block",
				"chat:codeblock.tooltips.enable_wrap": "Enable word wrap",
				"chat:codeblock.tooltips.disable_wrap": "Disable word wrap",
			}
			return translations[key] || key
		},
	}),
}))

// Mock shiki module
vi.mock("shiki", () => ({
	bundledLanguages: {
		typescript: {},
		javascript: {},
		txt: {},
	},
}))

// Mock the highlighter utility
vi.mock("../../../utils/highlighter", () => {
	const mockHighlighter = {
		codeToHtml: vi.fn().mockImplementation((code, options) => {
			const theme = options.theme === "github-light" ? "light" : "dark"
			return `<pre><code class="hljs language-${options.lang}">${code} [${theme}-theme]</code></pre>`
		}),
	}

	return {
		normalizeLanguage: vi.fn((lang) => lang || "txt"),
		isLanguageLoaded: vi.fn().mockReturnValue(true),
		getHighlighter: vi.fn().mockResolvedValue(mockHighlighter),
	}
})

// Mock clipboard utility
vi.mock("../../../utils/clipboard", () => ({
	useCopyToClipboard: () => ({
		showCopyFeedback: false,
		copyWithFeedback: vi.fn(),
	}),
}))

describe("CodeBlock", () => {
	const mockIntersectionObserver = vi.fn()
	const originalGetComputedStyle = window.getComputedStyle

	beforeEach(() => {
		// Mock scroll container
		const scrollContainer = document.createElement("div")
		scrollContainer.setAttribute("data-virtuoso-scroller", "true")
		document.body.appendChild(scrollContainer)

		// Mock IntersectionObserver
		window.IntersectionObserver = mockIntersectionObserver

		// Mock getComputedStyle
		window.getComputedStyle = vi.fn().mockImplementation((element) => ({
			...originalGetComputedStyle(element),
			getPropertyValue: () => "12px",
		}))
	})

	afterEach(() => {
		vi.clearAllMocks()
		const scrollContainer = document.querySelector('[data-virtuoso-scroller="true"]')
		if (scrollContainer) {
			document.body.removeChild(scrollContainer)
		}
		window.getComputedStyle = originalGetComputedStyle
	})

	it("renders basic syntax highlighting", async () => {
		const code = "const x = 1;\nconsole.log(x);"

		await act(async () => {
			render(<CodeBlock source={code} language="typescript" />)
		})

		expect(screen.getByText(/const x = 1/)).toBeInTheDocument()
	})

	it("handles theme switching", async () => {
		const code = "const x = 1;"

		await act(async () => {
			const { rerender } = render(<CodeBlock source={code} language="typescript" />)

			// Simulate light theme
			document.body.className = "light"
			rerender(<CodeBlock source={code} language="typescript" />)
		})

		expect(screen.getByText(/\[light-theme\]/)).toBeInTheDocument()

		await act(async () => {
			document.body.className = "dark"
			render(<CodeBlock source={code} language="typescript" />)
		})

		expect(screen.getByText(/\[dark-theme\]/)).toBeInTheDocument()
	})

	it("handles invalid language gracefully", async () => {
		const code = "some code"

		await act(async () => {
			render(<CodeBlock source={code} language="invalid-lang" />)
		})

		expect(screen.getByText(/some code/)).toBeInTheDocument()
	})

	it("handles WASM loading errors", async () => {
		const mockError = new Error("WASM load failed")
		const highlighterUtil = await import("../../../utils/highlighter")
		vi.mocked(highlighterUtil.getHighlighter).mockRejectedValueOnce(mockError)

		const code = "const x = 1;"
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		await act(async () => {
			render(<CodeBlock source={code} language="typescript" />)
		})

		expect(consoleSpy).toHaveBeenCalledWith(
			"[CodeBlock] Syntax highlighting error:",
			mockError,
			"\nStack trace:",
			mockError.stack,
		)
		expect(screen.getByText(/const x = 1;/)).toBeInTheDocument()

		consoleSpy.mockRestore()
	})

	it("verifies highlighter utility is used correctly", async () => {
		const code = "const x = 1;"
		const highlighterUtil = await import("../../../utils/highlighter")

		await act(async () => {
			render(<CodeBlock source={code} language="typescript" />)
		})

		// Verify getHighlighter was called with the right language
		expect(highlighterUtil.getHighlighter).toHaveBeenCalledWith("typescript")
		expect(highlighterUtil.normalizeLanguage).toHaveBeenCalledWith("typescript")
	})

	it("handles copy functionality", async () => {
		const code = "const x = 1;"
		const { container } = render(<CodeBlock source={code} language="typescript" />)

		// Simulate code block visibility
		const codeBlock = container.querySelector("[data-partially-visible]")
		if (codeBlock) {
			codeBlock.setAttribute("data-partially-visible", "true")
		}

		// Find the copy button by looking for the button containing the Copy icon
		const buttons = screen.getAllByRole("button")
		const copyButton = buttons.find((btn) => btn.querySelector("svg.lucide-copy"))

		expect(copyButton).toBeTruthy()
		if (copyButton) {
			await act(async () => {
				fireEvent.click(copyButton)
			})
		}
	})
})
