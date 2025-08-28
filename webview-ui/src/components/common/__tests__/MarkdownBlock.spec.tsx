import { render, screen } from "@/utils/test-utils"

import MarkdownBlock from "../MarkdownBlock"

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		theme: "dark",
	}),
}))

describe("MarkdownBlock", () => {
	it("should correctly handle URLs with trailing punctuation", async () => {
		const markdown = "Check out this link: https://example.com."
		const { container } = render(<MarkdownBlock markdown={markdown} />)

		// Wait for the content to be processed
		await screen.findByText(/Check out this link/, { exact: false })

		// Check for nested links - this should not happen
		const nestedLinks = container.querySelectorAll("a a")
		expect(nestedLinks.length).toBe(0)

		// Should have exactly one link
		const linkElement = screen.getByRole("link")
		expect(linkElement).toHaveAttribute("href", "https://example.com")
		expect(linkElement.textContent).toBe("https://example.com")

		// Check that the period is outside the link
		const paragraph = container.querySelector("p")
		expect(paragraph?.textContent).toBe("Check out this link: https://example.com.")
	})

	it("should render unordered lists with proper styling", async () => {
		const markdown = `Here are some items:
- First item
- Second item
  - Nested item
  - Another nested item`

		const { container } = render(<MarkdownBlock markdown={markdown} />)

		// Wait for the content to be processed
		await screen.findByText(/Here are some items/, { exact: false })

		// Check that ul elements exist
		const ulElements = container.querySelectorAll("ul")
		expect(ulElements.length).toBeGreaterThan(0)

		// Check that list items exist
		const liElements = container.querySelectorAll("li")
		expect(liElements.length).toBe(4)

		// Verify the text content
		expect(screen.getByText("First item")).toBeInTheDocument()
		expect(screen.getByText("Second item")).toBeInTheDocument()
		expect(screen.getByText("Nested item")).toBeInTheDocument()
		expect(screen.getByText("Another nested item")).toBeInTheDocument()
	})

	it("should render ordered lists with proper styling", async () => {
		const markdown = `And a numbered list:
1. Step one
2. Step two
3. Step three`

		const { container } = render(<MarkdownBlock markdown={markdown} />)

		// Wait for the content to be processed
		await screen.findByText(/And a numbered list/, { exact: false })

		// Check that ol elements exist
		const olElements = container.querySelectorAll("ol")
		expect(olElements.length).toBe(1)

		// Check that list items exist
		const liElements = container.querySelectorAll("li")
		expect(liElements.length).toBe(3)

		// Verify the text content
		expect(screen.getByText("Step one")).toBeInTheDocument()
		expect(screen.getByText("Step two")).toBeInTheDocument()
		expect(screen.getByText("Step three")).toBeInTheDocument()
	})

	it("should render nested lists with proper hierarchy", async () => {
		const markdown = `Complex list:
1. First level ordered
   - Second level unordered
   - Another second level
     1. Third level ordered
     2. Another third level
2. Back to first level`

		const { container } = render(<MarkdownBlock markdown={markdown} />)

		// Wait for the content to be processed
		await screen.findByText(/Complex list/, { exact: false })

		// Check nested structure
		const olElements = container.querySelectorAll("ol")
		const ulElements = container.querySelectorAll("ul")

		expect(olElements.length).toBeGreaterThan(0)
		expect(ulElements.length).toBeGreaterThan(0)

		// Verify all text is rendered
		expect(screen.getByText("First level ordered")).toBeInTheDocument()
		expect(screen.getByText("Second level unordered")).toBeInTheDocument()
		expect(screen.getByText("Third level ordered")).toBeInTheDocument()
		expect(screen.getByText("Back to first level")).toBeInTheDocument()
	})
})
