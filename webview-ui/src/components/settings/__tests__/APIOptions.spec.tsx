import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import ApiOptions from "../ApiOptions"
import { ExtensionStateContextProvider, useExtensionState } from "@/context/ExtensionStateContext"
import { ApiConfiguration } from "@shared/api"

// Define proper typing for the global vscode object
declare global {
	interface Window {
		vscode: {
			postMessage: (message: any) => void
		}
	}
}

const mockExtensionState = (apiConfiguration: Partial<ApiConfiguration>) => {
	vi.mocked(useExtensionState).mockReturnValue({
		apiConfiguration,
		setApiConfiguration: vi.fn(),
		uriScheme: "vscode",
		requestyModels: {},
	} as any)
}

// First mock setup for "requesty" provider
vi.mock("../../../context/ExtensionStateContext", async () => {
	const actual = (await vi.importActual("../../../context/ExtensionStateContext")) as any
	return {
		...(actual || {}),
		useExtensionState: vi.fn(() => ({
			apiConfiguration: {
				apiProvider: "requesty",
				requestyApiKey: "",
				requestyModelId: "",
			},
			setApiConfiguration: vi.fn(),
			uriScheme: "vscode",
			requestyModels: {},
		})),
	}
})

describe("ApiOptions Component - Requesty", () => {
	const mockPostMessage = vi.fn()

	beforeEach(() => {
		//@ts-expect-error - vscode is not defined in the global namespace in test environment
		global.vscode = { postMessage: mockPostMessage }
		mockExtensionState({
			apiProvider: "requesty",
		})
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
		const modelIdInput = screen.getByPlaceholderText("Search and select a model...")
		expect(modelIdInput).toBeInTheDocument()
	})
})

// Reset the mock before creating a new one
vi.resetModules()

// Second mock setup for "together" provider
vi.mock("../../../context/ExtensionStateContext", async () => {
	const actual = (await vi.importActual("../../../context/ExtensionStateContext")) as any
	return {
		...(actual || {}),
		useExtensionState: vi.fn(() => ({
			apiConfiguration: {
				apiProvider: "together",
				requestyApiKey: "",
				requestyModelId: "",
			},
			setApiConfiguration: vi.fn(),
			uriScheme: "vscode",
		})),
	}
})

describe("ApiOptions Component - Together", () => {
	const mockPostMessage = vi.fn()

	beforeEach(() => {
		//@ts-expect-error - vscode is not defined in the global namespace in test environment
		global.vscode = { postMessage: mockPostMessage }
		mockExtensionState({
			apiProvider: "together",
		})
	})

	it("renders Together API Key input", () => {
		render(
			<ExtensionStateContextProvider>
				<ApiOptions showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)
		const apiKeyInput = screen.getByPlaceholderText("Enter API Key...")
		expect(apiKeyInput).toBeInTheDocument()
	})

	it("renders Together Model ID input", () => {
		render(
			<ExtensionStateContextProvider>
				<ApiOptions showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)
		const modelIdInput = screen.getByPlaceholderText("Enter Model ID...")
		expect(modelIdInput).toBeInTheDocument()
	})
})

// Reset the mock before creating a new one
vi.resetModules()

// Third mock setup for "openai" provider
vi.mock("../../../context/ExtensionStateContext", async () => {
	const actual = (await vi.importActual("../../../context/ExtensionStateContext")) as any
	return {
		...(actual || {}),
		useExtensionState: vi.fn(() => ({
			apiConfiguration: {
				apiProvider: "openai",
				requestyApiKey: "",
				requestyModelId: "",
			},
			setApiConfiguration: vi.fn(),
			uriScheme: "vscode",
		})),
	}
})

describe("OpenApiInfoOptions", () => {
	const mockPostMessage = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
		//@ts-expect-error - vscode is not defined in the global namespace in test environment
		global.vscode = { postMessage: mockPostMessage }
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

describe("ApiOptions Component", () => {
	vi.clearAllMocks()
	const mockPostMessage = vi.fn()

	beforeEach(() => {
		//@ts-expect-error - vscode is not defined in the global namespace in test environment
		global.vscode = { postMessage: mockPostMessage }

		mockExtensionState({
			apiProvider: "nebius",
			nebiusApiKey: "",
		})
	})

	it("renders Nebius API Key input", () => {
		render(
			<ExtensionStateContextProvider>
				<ApiOptions showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)
		const apiKeyInput = screen.getByPlaceholderText("Enter API Key...")
		expect(apiKeyInput).toBeInTheDocument()
	})

	it("renders Nebius Model ID select with a default model", () => {
		render(
			<ExtensionStateContextProvider>
				<ApiOptions showModelOptions={true} />
			</ExtensionStateContextProvider>,
		)
		const modelIdSelect = screen.getByLabelText("Model")
		expect(modelIdSelect).toBeInTheDocument()
		expect(modelIdSelect).toHaveValue("Qwen/Qwen2.5-32B-Instruct-fast")
	})
})
