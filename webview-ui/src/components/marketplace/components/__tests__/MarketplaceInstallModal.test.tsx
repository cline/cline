import React from "react"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MarketplaceInstallModal } from "../MarketplaceInstallModal"
import { MarketplaceItem } from "@roo-code/types"

// Mock the vscode module before importing the component
jest.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: jest.fn(),
	},
}))

// Import the mocked vscode after setting up the mock
import { vscode } from "@/utils/vscode"
const mockedVscode = vscode as jest.Mocked<typeof vscode>

// Mock the translation hook
jest.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, params?: any) => {
			// Simple mock translation that returns the key with params
			if (key === "marketplace:install.validationRequired") {
				return `Please provide a value for ${params?.paramName || "parameter"}`
			}
			if (params) {
				return `${key}:${JSON.stringify(params)}`
			}
			return key
		},
	}),
}))

describe("MarketplaceInstallModal - Nested Parameters", () => {
	const mockOnClose = jest.fn()

	beforeEach(() => {
		jest.clearAllMocks()
		// Reset the mock function
		mockedVscode.postMessage.mockClear()
	})

	const createMockItem = (hasNestedParams = false): MarketplaceItem => ({
		id: "test-item",
		name: "Test MCP Server",
		description: "A test MCP server",
		type: "mcp",
		url: "https://example.com/test-mcp",
		author: "Test Author",
		tags: ["test"],
		// Global parameters
		parameters: [
			{
				name: "Global API Key",
				key: "apiKey",
				placeholder: "Enter your API key",
				optional: false,
			},
			{
				name: "Global Optional Setting",
				key: "globalOptional",
				placeholder: "Optional setting",
				optional: true,
			},
		],
		content: hasNestedParams
			? [
					{
						name: "NPM Installation",
						content: "npm install {{packageName}}",
						parameters: [
							{
								name: "Package Name",
								key: "packageName",
								placeholder: "Enter package name",
								optional: false,
							},
							// Override global parameter
							{
								name: "NPM API Key",
								key: "apiKey",
								placeholder: "Enter NPM API key",
								optional: false,
							},
						],
					},
					{
						name: "Docker Installation",
						content: "docker run {{imageName}}",
						parameters: [
							{
								name: "Docker Image",
								key: "imageName",
								placeholder: "Enter image name",
								optional: false,
							},
						],
					},
				]
			: "npm install test-package",
	})

	it("should display global parameters when no nested parameters exist", () => {
		const item = createMockItem(false)
		render(<MarketplaceInstallModal item={item} isOpen={true} onClose={mockOnClose} hasWorkspace={true} />)

		// Should show global parameters
		expect(screen.getByPlaceholderText("Enter your API key")).toBeInTheDocument()
		expect(screen.getByPlaceholderText("Optional setting")).toBeInTheDocument()
	})

	it("should display effective parameters for selected installation method", () => {
		const item = createMockItem(true)
		render(<MarketplaceInstallModal item={item} isOpen={true} onClose={mockOnClose} hasWorkspace={true} />)

		// Should show method dropdown for multiple methods
		expect(screen.getByRole("combobox")).toBeInTheDocument()

		// Should show effective parameters (global + method-specific for NPM method)
		expect(screen.getByPlaceholderText("Enter package name")).toBeInTheDocument() // Method-specific
		expect(screen.getByPlaceholderText("Enter NPM API key")).toBeInTheDocument() // Overridden global
		expect(screen.getByPlaceholderText("Optional setting")).toBeInTheDocument() // Global optional
	})

	it("should update parameters when switching installation methods", async () => {
		const item = createMockItem(true)
		render(<MarketplaceInstallModal item={item} isOpen={true} onClose={mockOnClose} hasWorkspace={true} />)

		// Initially should show NPM method parameters
		expect(screen.getByPlaceholderText("Enter package name")).toBeInTheDocument()
		expect(screen.getByPlaceholderText("Enter NPM API key")).toBeInTheDocument()

		// Switch to Docker method
		const methodSelect = screen.getByRole("combobox")
		fireEvent.click(methodSelect)

		// Find and click Docker option
		await waitFor(() => {
			const dockerOption = screen.getByText("Docker Installation")
			fireEvent.click(dockerOption)
		})

		// Should now show Docker method parameters
		await waitFor(() => {
			expect(screen.getByPlaceholderText("Enter image name")).toBeInTheDocument()
			// Should still show global API key (not overridden in Docker method)
			expect(screen.getByPlaceholderText("Enter your API key")).toBeInTheDocument()
			expect(screen.getByPlaceholderText("Optional setting")).toBeInTheDocument()
		})

		// Package name parameter should no longer be visible
		expect(screen.queryByPlaceholderText("Enter package name")).not.toBeInTheDocument()
		expect(screen.queryByPlaceholderText("Enter NPM API key")).not.toBeInTheDocument()
	})

	it("should validate required parameters from effective parameters", async () => {
		const item = createMockItem(true)
		render(<MarketplaceInstallModal item={item} isOpen={true} onClose={mockOnClose} hasWorkspace={true} />)

		// Try to install without filling required parameters
		const installButton = screen.getByText("marketplace:install.button")
		fireEvent.click(installButton)

		// Should show validation error for missing required parameter
		await waitFor(() => {
			expect(screen.getByText(/Please provide a value for/)).toBeInTheDocument()
		})

		// Fill in the required parameters
		const packageNameInput = screen.getByPlaceholderText("Enter package name")
		const apiKeyInput = screen.getByPlaceholderText("Enter NPM API key")

		fireEvent.change(packageNameInput, { target: { value: "test-package" } })
		fireEvent.change(apiKeyInput, { target: { value: "test-api-key" } })

		// Now install should work
		fireEvent.click(installButton)

		await waitFor(() => {
			expect(mockedVscode.postMessage).toHaveBeenCalledWith({
				type: "installMarketplaceItem",
				mpItem: item,
				mpInstallOptions: {
					target: "project",
					parameters: {
						packageName: "test-package",
						apiKey: "test-api-key", // Overridden value
						globalOptional: "", // Optional parameter with empty string
						_selectedIndex: 0,
					},
				},
			})
		})
	})

	it("should preserve parameter values when switching methods if keys match", async () => {
		const item = createMockItem(true)
		render(<MarketplaceInstallModal item={item} isOpen={true} onClose={mockOnClose} hasWorkspace={true} />)

		// Fill in global optional parameter
		const globalOptionalInput = screen.getByPlaceholderText("Optional setting")
		fireEvent.change(globalOptionalInput, { target: { value: "test-value" } })

		// Switch to Docker method
		const methodSelect = screen.getByRole("combobox")
		fireEvent.click(methodSelect)

		await waitFor(() => {
			const dockerOption = screen.getByText("Docker Installation")
			fireEvent.click(dockerOption)
		})

		// Global optional parameter value should be preserved
		await waitFor(() => {
			const preservedInput = screen.getByPlaceholderText("Optional setting")
			expect(preservedInput).toHaveValue("test-value")
		})
	})
})
