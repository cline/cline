import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"

import type { ProviderSettings } from "@roo-code/types"

import { GeminiCli } from "../GeminiCli"

// Mock the translation hook
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

// Mock VSCodeLink to render as a regular anchor tag
vi.mock("@vscode/webview-ui-toolkit/react", async () => {
	const actual = await vi.importActual("@vscode/webview-ui-toolkit/react")
	return {
		...actual,
		VSCodeLink: ({ children, href, ...props }: any) => (
			<a href={href} {...props}>
				{children}
			</a>
		),
	}
})

describe("GeminiCli", () => {
	const mockSetApiConfigurationField = vi.fn()
	const defaultProps = {
		apiConfiguration: {} as ProviderSettings,
		setApiConfigurationField: mockSetApiConfigurationField,
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders all required elements", () => {
		render(<GeminiCli {...defaultProps} />)

		// Check for OAuth path input
		expect(screen.getByText("settings:providers.geminiCli.oauthPath")).toBeInTheDocument()
		expect(screen.getByPlaceholderText("~/.gemini/oauth_creds.json")).toBeInTheDocument()

		// Check for description text
		expect(screen.getByText("settings:providers.geminiCli.description")).toBeInTheDocument()

		// Check for instructions - they're in the same div but broken up by the code element
		// Find all elements that contain the instruction parts
		const instructionsDivs = screen.getAllByText((_content, element) => {
			// Check if this element contains all the expected text parts
			const fullText = element?.textContent || ""
			return (
				fullText.includes("settings:providers.geminiCli.instructions") &&
				fullText.includes("gemini") &&
				fullText.includes("settings:providers.geminiCli.instructionsContinued")
			)
		})
		// Find the div with the correct classes
		const instructionsDiv = instructionsDivs.find(
			(div) =>
				div.classList.contains("text-sm") &&
				div.classList.contains("text-vscode-descriptionForeground") &&
				div.classList.contains("mt-2"),
		)
		expect(instructionsDiv).toBeDefined()
		expect(instructionsDiv).toBeInTheDocument()

		// Also verify the code element exists
		const codeElement = screen.getByText("gemini")
		expect(codeElement).toBeInTheDocument()
		expect(codeElement.tagName).toBe("CODE")

		// Check for setup link
		expect(screen.getByText("settings:providers.geminiCli.setupLink")).toBeInTheDocument()

		// Check for requirements
		expect(screen.getByText("settings:providers.geminiCli.requirementsTitle")).toBeInTheDocument()
		expect(screen.getByText("settings:providers.geminiCli.requirement1")).toBeInTheDocument()
		expect(screen.getByText("settings:providers.geminiCli.requirement2")).toBeInTheDocument()
		expect(screen.getByText("settings:providers.geminiCli.requirement3")).toBeInTheDocument()
		expect(screen.getByText("settings:providers.geminiCli.requirement4")).toBeInTheDocument()
		expect(screen.getByText("settings:providers.geminiCli.requirement5")).toBeInTheDocument()

		// Check for free access note
		expect(screen.getByText("settings:providers.geminiCli.freeAccess")).toBeInTheDocument()
	})

	it("displays OAuth path from configuration", () => {
		const apiConfiguration: ProviderSettings = {
			geminiCliOAuthPath: "/custom/path/oauth.json",
		}

		render(<GeminiCli {...defaultProps} apiConfiguration={apiConfiguration} />)

		const oauthInput = screen.getByDisplayValue("/custom/path/oauth.json")
		expect(oauthInput).toBeInTheDocument()
	})

	it("calls setApiConfigurationField when OAuth path is changed", () => {
		render(<GeminiCli {...defaultProps} />)

		const oauthInput = screen.getByPlaceholderText("~/.gemini/oauth_creds.json")

		// Simulate input event with VSCodeTextField
		fireEvent.input(oauthInput, { target: { value: "/new/path.json" } })

		// Check that setApiConfigurationField was called
		expect(mockSetApiConfigurationField).toHaveBeenCalledWith("geminiCliOAuthPath", "/new/path.json")
	})

	it("renders setup link with correct href", () => {
		render(<GeminiCli {...defaultProps} />)

		const setupLink = screen.getByText("settings:providers.geminiCli.setupLink")
		expect(setupLink).toHaveAttribute(
			"href",
			"https://github.com/google-gemini/gemini-cli?tab=readme-ov-file#quickstart",
		)
	})

	it("shows OAuth path description", () => {
		render(<GeminiCli {...defaultProps} />)

		expect(screen.getByText("settings:providers.geminiCli.oauthPathDescription")).toBeInTheDocument()
	})

	it("renders all requirements in a list", () => {
		render(<GeminiCli {...defaultProps} />)

		const listItems = screen.getAllByRole("listitem")
		expect(listItems).toHaveLength(5)
		expect(listItems[0]).toHaveTextContent("settings:providers.geminiCli.requirement1")
		expect(listItems[1]).toHaveTextContent("settings:providers.geminiCli.requirement2")
		expect(listItems[2]).toHaveTextContent("settings:providers.geminiCli.requirement3")
		expect(listItems[3]).toHaveTextContent("settings:providers.geminiCli.requirement4")
		expect(listItems[4]).toHaveTextContent("settings:providers.geminiCli.requirement5")
	})

	it("applies correct styling classes", () => {
		render(<GeminiCli {...defaultProps} />)

		// Check for styled warning box
		const warningBox = screen.getByText("settings:providers.geminiCli.requirementsTitle").closest("div.mt-3")
		expect(warningBox).toHaveClass("bg-vscode-editorWidget-background")
		expect(warningBox).toHaveClass("border-vscode-editorWidget-border")
		expect(warningBox).toHaveClass("rounded")
		expect(warningBox).toHaveClass("p-3")

		// Check for warning icon
		const warningIcon = screen.getByText("settings:providers.geminiCli.requirementsTitle").previousElementSibling
		expect(warningIcon).toHaveClass("codicon-warning")
		expect(warningIcon).toHaveClass("text-vscode-notificationsWarningIcon-foreground")

		// Check for check icon
		const checkIcon = screen.getByText("settings:providers.geminiCli.freeAccess").previousElementSibling
		expect(checkIcon).toHaveClass("codicon-check")
		expect(checkIcon).toHaveClass("text-vscode-notificationsInfoIcon-foreground")
	})

	it("renders instructions with code element", () => {
		render(<GeminiCli {...defaultProps} />)

		const codeElement = screen.getByText("gemini")
		expect(codeElement.tagName).toBe("CODE")
		expect(codeElement).toHaveClass("text-vscode-textPreformat-foreground")
	})
})
