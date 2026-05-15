import { ApiFormat } from "@shared/proto/cline/models"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModels } from "@/hooks/useProviderModels"
import { GeminiProvider } from "./GeminiProvider"

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
	useApiConfigurationHandlers: vi.fn(() => ({
		handleFieldChange: vi.fn(),
	})),
}))

describe("GeminiProvider", () => {
	it("uses provider catalog models and commits selected model as a full selection envelope", async () => {
		const commitSelection = vi.fn(async () => undefined)
		vi.mocked(useExtensionState).mockReturnValue({ apiConfiguration: {} } as ReturnType<typeof useExtensionState>)
		vi.mocked(useProviderModels).mockReturnValue({
			models: {
				"gemini-3.1-pro-preview": {
					name: "Gemini 3.1 Pro Preview",
					supportsPromptCache: true,
					contextWindow: 1_000_000,
				},
				"gemini-3.1-flash-preview": {
					name: "Gemini 3.1 Flash Preview",
					supportsPromptCache: true,
					contextWindow: 1_000_000,
					supportsReasoning: true,
				},
			},
			defaultModelId: "gemini-3.1-pro-preview",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})
		vi.mocked(useProviderConfig).mockReturnValue({
			config: {
				providerId: "gemini",
				headers: {},
				apiKeyLength: 0,
				hasAccessToken: false,
				hasRefreshToken: false,
				actSelection: {
					providerId: "gemini",
					modelId: "gemini-3.1-pro-preview",
					modelInfo: {
						name: "Gemini 3.1 Pro Preview",
						supportsPromptCache: true,
						contextWindow: 1_000_000,
						tiers: [],
					},
				},
			},
			write: vi.fn(),
			commitSelection,
		})

		render(<GeminiProvider currentMode="act" showModelOptions={true} />)
		fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gemini-3.1-flash-preview" } })

		await waitFor(() => expect(commitSelection).toHaveBeenCalledTimes(1))
		expect(commitSelection).toHaveBeenCalledWith("act", {
			providerId: "gemini",
			modelId: "gemini-3.1-flash-preview",
			modelInfo: {
				name: "Gemini 3.1 Flash Preview",
				supportsPromptCache: true,
				contextWindow: 1_000_000,
				supportsReasoning: true,
			},
		})
		expect(useProviderModels).toHaveBeenCalledWith("gemini")
		expect(useProviderConfig).toHaveBeenCalledWith("gemini")
	})

	it("falls back to catalog default model when no committed selection exists", () => {
		vi.mocked(useExtensionState).mockReturnValue({ apiConfiguration: {} } as ReturnType<typeof useExtensionState>)
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

		render(<GeminiProvider currentMode="act" showModelOptions={true} />)

		expect(screen.getByLabelText("Model")).toHaveValue("gemini-3.1-pro-preview")
	})
})
