import { ApiFormat } from "@shared/proto/cline/models"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModels } from "@/hooks/useProviderModels"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { GenericProviderSettings } from "./GenericProviderSettings"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

vi.mock("@/hooks/useProviderModels", () => ({
	useProviderModels: vi.fn(),
}))

vi.mock("@/hooks/useProviderConfig", () => ({
	useProviderConfig: vi.fn(),
}))

vi.mock("../utils/useApiConfigurationHandlers", () => ({
	useApiConfigurationHandlers: vi.fn(),
}))

describe("GenericProviderSettings", () => {
	it("renders catalog-backed provider settings and commits full model selections", async () => {
		const commitSelection = vi.fn(async () => undefined)
		vi.mocked(useExtensionState).mockReturnValue({
			apiConfiguration: { deepSeekApiKey: "existing-key" },
		} as ReturnType<typeof useExtensionState>)
		vi.mocked(useApiConfigurationHandlers).mockReturnValue({
			handleFieldChange: vi.fn(),
			handleFieldsChange: vi.fn(),
			handleModeFieldChange: vi.fn(),
			handleModeFieldsChange: vi.fn(),
		})
		vi.mocked(useProviderModels).mockReturnValue({
			models: {
				"deepseek-chat": { name: "DeepSeek Chat", supportsPromptCache: true, contextWindow: 128_000 },
				"deepseek-reasoner": {
					name: "DeepSeek Reasoner",
					supportsPromptCache: true,
					contextWindow: 128_000,
					supportsReasoning: true,
				},
			},
			defaultModelId: "deepseek-chat",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})
		vi.mocked(useProviderConfig).mockReturnValue({
			config: undefined,
			write: vi.fn(),
			commitSelection,
		})

		render(
			<GenericProviderSettings
				allowsCustomIds={false}
				apiKeyField="deepSeekApiKey"
				currentMode="act"
				providerId="deepseek"
				providerName="DeepSeek"
				showModelOptions={true}
			/>,
		)

		expect(screen.getByLabelText("Model")).toHaveValue("deepseek-chat")
		fireEvent.change(screen.getByLabelText("Model"), { target: { value: "deepseek-reasoner" } })

		await waitFor(() => expect(commitSelection).toHaveBeenCalledTimes(1))
		expect(commitSelection).toHaveBeenCalledWith("act", {
			providerId: "deepseek",
			modelId: "deepseek-reasoner",
			modelInfo: { name: "DeepSeek Reasoner", supportsPromptCache: true, contextWindow: 128_000, supportsReasoning: true },
		})
		expect(useProviderModels).toHaveBeenCalledWith("deepseek")
		expect(useProviderConfig).toHaveBeenCalledWith("deepseek")
	})

	it("can render and update an optional base URL field", async () => {
		const handleFieldChange = vi.fn()
		vi.mocked(useExtensionState).mockReturnValue({
			apiConfiguration: { geminiApiKey: "", geminiBaseUrl: "https://custom.example" },
		} as ReturnType<typeof useExtensionState>)
		vi.mocked(useApiConfigurationHandlers).mockReturnValue({
			handleFieldChange,
			handleFieldsChange: vi.fn(),
			handleModeFieldChange: vi.fn(),
			handleModeFieldsChange: vi.fn(),
		})
		vi.mocked(useProviderModels).mockReturnValue({
			models: {
				"gemini-3.1-pro-preview": {
					name: "Gemini 3.1 Pro Preview",
					supportsPromptCache: true,
					contextWindow: 1_000_000,
					apiFormat: ApiFormat.GEMINI_CHAT,
				},
			},
			defaultModelId: "gemini-3.1-pro-preview",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})
		vi.mocked(useProviderConfig).mockReturnValue({ config: undefined, write: vi.fn(), commitSelection: vi.fn() })

		render(
			<GenericProviderSettings
				allowsCustomIds={false}
				apiKeyField="geminiApiKey"
				baseUrlField={{
					field: "geminiBaseUrl",
					label: "Use custom base URL",
					placeholder: "Default: https://generativelanguage.googleapis.com",
				}}
				currentMode="act"
				providerId="gemini"
				providerName="Gemini"
				showModelOptions={false}
			/>,
		)

		const baseUrlInput = screen.getByPlaceholderText("Default: https://generativelanguage.googleapis.com")
		fireEvent.input(baseUrlInput, { target: { value: "https://new.example" } })

		await waitFor(() => expect(handleFieldChange).toHaveBeenCalledWith("geminiBaseUrl", "https://new.example"))
	})
})
