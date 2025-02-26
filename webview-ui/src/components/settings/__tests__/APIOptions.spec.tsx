import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import ApiOptions from "../ApiOptions"
import { ExtensionStateContextProvider } from "../../../context/ExtensionStateContext"
import React from "react"

vi.mock("../src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

const renderComponent = (props = {}) => {
	return render(
		<ExtensionStateContextProvider>
			<ApiOptions showModelOptions={true} {...props} />
		</ExtensionStateContextProvider>,
	)
}

describe("ApiOptions", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		Element.prototype.scrollIntoView = vi.fn()
	})

	it("renders API Provider dropdown", () => {
		renderComponent()
		expect(screen.getByLabelText(/API Provider/i)).toBeInTheDocument()
	})

	it("renders OpenAI API Key input when OpenAI provider is selected", async () => {
		renderComponent()
		const dropdown = screen.getAllByRole("combobox")[0]
		await userEvent.click(dropdown)
		const option = screen.getByRole("option", { name: "OpenAI" })
		await userEvent.click(option)
		expect(screen.getByPlaceholderText(/Enter API Key/i)).toBeInTheDocument()
	})

	it("renders error message when apiErrorMessage is provided", () => {
		renderComponent({ apiErrorMessage: "API Error" })
		expect(screen.getByText(/API Error/i)).toBeInTheDocument()
	})

	it("renders model dropdown for selected provider", async () => {
		renderComponent()
		const dropdown = screen.getAllByRole("combobox")[0]
		await userEvent.click(dropdown)
		const option = screen.getByRole("option", { name: "Anthropic" })
		await userEvent.click(option)
		expect(screen.getByPlaceholderText(/Enter API Key/i)).toBeInTheDocument()
	})

	it("renders OpenRouter API Key input when OpenRouter provider is selected", async () => {
		renderComponent()
		const dropdown = screen.getAllByRole("combobox")[0]
		await userEvent.click(dropdown)
		const option = screen.getByRole("option", { name: "OpenRouter" })
		await userEvent.click(option)
		expect(screen.getByPlaceholderText(/Enter API Key/i)).toBeInTheDocument()
	})

	it("renders AWS credentials inputs when AWS Bedrock provider is selected", async () => {
		renderComponent()
		const dropdown = screen.getAllByRole("combobox")[0]
		await userEvent.click(dropdown)
		const option = screen.getByRole("option", { name: "AWS Bedrock" })
		await userEvent.click(option)
		expect(screen.getByPlaceholderText(/Enter Access Key/i)).toBeInTheDocument()
		expect(screen.getByPlaceholderText(/Enter Secret Key/i)).toBeInTheDocument()
		expect(screen.getByPlaceholderText(/Enter Session Token/i)).toBeInTheDocument()
		const toggle = screen.getByText("AWS Profile")
		await userEvent.click(toggle)
		expect(screen.getByPlaceholderText(/Enter profile name/i)).toBeInTheDocument()
	})

	it("renders Google Cloud Project ID input when Vertex provider is selected", async () => {
		renderComponent()
		const dropdown = screen.getAllByRole("combobox")[0]
		await userEvent.click(dropdown)
		const option = screen.getByRole("option", { name: "GCP Vertex AI" })
		await userEvent.click(option)
		expect(screen.getByPlaceholderText(/Enter Project ID/i)).toBeInTheDocument()
	})

	it("renders OpenAI Supports Images input", () => {
		render(
			<ExtensionStateContextProvider>
				<ApiOptions showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)
		fireEvent.click(screen.getByText("Model Configuration"))
		const apiKeyInput = screen.getByText("Supports Images")
		expect(apiKeyInput).toBeInTheDocument()
	})

	it("renders OpenAI Context Window Size input", () => {
		render(
			<ExtensionStateContextProvider>
				<ApiOptions showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)
		fireEvent.click(screen.getByText("Model Configuration"))
		const orgIdInput = screen.getByText("Context Window Size")
		expect(orgIdInput).toBeInTheDocument()
	})

	it("renders OpenAI Max Output Tokens input", () => {
		render(
			<ExtensionStateContextProvider>
				<ApiOptions showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)
		fireEvent.click(screen.getByText("Model Configuration"))
		const modelInput = screen.getByText("Max Output Tokens")
		expect(modelInput).toBeInTheDocument()
	})
})
