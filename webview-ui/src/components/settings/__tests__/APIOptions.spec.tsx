import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import ApiOptions from "../ApiOptions"
import { ExtensionStateContextProvider } from "../../../context/ExtensionStateContext"

vi.mock("../../../context/ExtensionStateContext", async (importOriginal) => {
	const actual = await importOriginal()
	return {
		...actual,
		// your mocked methods
		useExtensionState: vi.fn(() => ({
			apiConfiguration: {
				apiProvider: "requesty",
				requestyApiKey: "",
				requestyModelId: "",
			},
			setApiConfiguration: vi.fn(),
			uriScheme: "vscode",
		})),
	}
})

describe("ApiOptions Component", () => {
	vi.clearAllMocks()
	const mockPostMessage = vi.fn()
	const mockSetApiConfiguration = vi.fn()

	beforeEach(() => {
		global.vscode = { postMessage: mockPostMessage } as any
	})

	it("renders Requesty API Key input", () => {
		render(
			<ExtensionStateContextProvider>
				<ApiOptions showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)
		const apiKeyInput = screen.getByPlaceholderText("Enter API Key...")
		expect(apiKeyInput).toBeInTheDocument()
	})

	it("renders Requesty Model ID input", () => {
		render(
			<ExtensionStateContextProvider>
				<ApiOptions showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)
		const modelIdInput = screen.getByPlaceholderText("Enter Model ID...")
		expect(modelIdInput).toBeInTheDocument()
	})
})
