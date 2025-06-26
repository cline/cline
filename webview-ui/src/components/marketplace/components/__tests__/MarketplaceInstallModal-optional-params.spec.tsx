import { render, screen, fireEvent, waitFor } from "@/utils/test-utils"

import { MarketplaceItem } from "@roo-code/types"

import { MarketplaceInstallModal } from "../MarketplaceInstallModal"

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

import { vscode } from "@/utils/vscode"
const mockPostMessage = vscode.postMessage as any

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, params?: any) => {
			// Simple mock translation
			if (key === "marketplace:install.configuration") return "Configuration"
			if (key === "marketplace:install.button") return "Install"
			if (key === "common:answers.cancel") return "Cancel"
			if (key === "marketplace:install.validationRequired") {
				return `Please provide a value for ${params?.paramName || "parameter"}`
			}
			return key
		},
	}),
}))

describe("MarketplaceInstallModal - Optional Parameters", () => {
	const mockOnClose = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
	})

	const createMcpItemWithParams = (parameters: any[]): MarketplaceItem => ({
		id: "test-mcp",
		name: "Test MCP",
		description: "Test MCP with parameters",
		type: "mcp",
		url: "https://example.com/test-mcp",
		content: '{"test-server": {"command": "test", "args": ["--key", "{{api_key}}", "--endpoint", "{{endpoint}}"]}}',
		parameters,
	})

	it("should show (optional) label for optional parameters", () => {
		const item = createMcpItemWithParams([
			{
				name: "API Key",
				key: "api_key",
				placeholder: "Enter API key",
				optional: false,
			},
			{
				name: "Custom Endpoint",
				key: "endpoint",
				placeholder: "Leave empty for default",
				optional: true,
			},
		])

		render(<MarketplaceInstallModal item={item} isOpen={true} onClose={mockOnClose} hasWorkspace={true} />)

		expect(screen.getByText("API Key")).toBeInTheDocument()
		expect(screen.getByText("Custom Endpoint (optional)")).toBeInTheDocument()
	})

	it("should render input fields correctly for optional parameters", () => {
		const item = createMcpItemWithParams([
			{
				name: "API Key",
				key: "api_key",
				placeholder: "Enter API key",
				optional: false,
			},
			{
				name: "Custom Endpoint",
				key: "endpoint",
				placeholder: "Leave empty for default",
				optional: true,
			},
		])

		render(<MarketplaceInstallModal item={item} isOpen={true} onClose={mockOnClose} hasWorkspace={true} />)

		// Check that input fields are rendered
		const apiKeyInput = screen.getByPlaceholderText("Enter API key")
		const endpointInput = screen.getByPlaceholderText("Leave empty for default")

		expect(apiKeyInput).toBeInTheDocument()
		expect(endpointInput).toBeInTheDocument()
		expect(endpointInput).toHaveValue("")
	})

	it("should require non-optional parameters", async () => {
		const item = createMcpItemWithParams([
			{
				name: "API Key",
				key: "api_key",
				placeholder: "Enter API key",
				optional: false,
			},
			{
				name: "Custom Endpoint",
				key: "endpoint",
				placeholder: "Leave empty for default",
				optional: true,
			},
		])

		render(<MarketplaceInstallModal item={item} isOpen={true} onClose={mockOnClose} hasWorkspace={true} />)

		// Leave required parameter empty, fill optional one
		const endpointInput = screen.getByPlaceholderText("Leave empty for default")
		fireEvent.change(endpointInput, { target: { value: "https://custom.endpoint.com" } })

		// Click install without filling required parameter
		const installButton = screen.getByText("Install")
		fireEvent.click(installButton)

		// Should show validation error
		await waitFor(() => {
			expect(screen.getByText("Please provide a value for API Key")).toBeInTheDocument()
		})

		// Should not call postMessage
		expect(mockPostMessage).not.toHaveBeenCalled()
	})

	it("should handle parameters without optional field (defaults to required)", async () => {
		const item = createMcpItemWithParams([
			{
				name: "API Key",
				key: "api_key",
				placeholder: "Enter API key",
				// No optional field - should default to required
			},
		])

		render(<MarketplaceInstallModal item={item} isOpen={true} onClose={mockOnClose} hasWorkspace={true} />)

		// Should not show (optional) label
		expect(screen.getByText("API Key")).toBeInTheDocument()
		expect(screen.queryByText("API Key (optional)")).not.toBeInTheDocument()

		// Click install without filling parameter
		const installButton = screen.getByText("Install")
		fireEvent.click(installButton)

		// Should show validation error
		await waitFor(() => {
			expect(screen.getByText("Please provide a value for API Key")).toBeInTheDocument()
		})
	})
})
