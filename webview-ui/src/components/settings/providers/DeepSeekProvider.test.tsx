import { ApiFormat } from "@shared/proto/cline/models"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModels } from "@/hooks/useProviderModels"
import { DeepSeekProvider } from "./DeepSeekProvider"

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

describe("DeepSeekProvider", () => {
	it("uses provider catalog models and commits selected model as a full selection envelope", async () => {
		const commitSelection = vi.fn(async () => undefined)
		vi.mocked(useExtensionState).mockReturnValue({ apiConfiguration: {} } as ReturnType<typeof useExtensionState>)
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
			config: {
				providerId: "deepseek",
				headers: {},
				apiKeyLength: 0,
				hasAccessToken: false,
				hasRefreshToken: false,
				actSelection: {
					providerId: "deepseek",
					modelId: "deepseek-chat",
					modelInfo: { name: "DeepSeek Chat", supportsPromptCache: true, contextWindow: 128_000, tiers: [] },
				},
			},
			write: vi.fn(),
			commitSelection,
		})

		render(<DeepSeekProvider currentMode="act" showModelOptions={true} />)
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

	it("falls back to catalog default model when no committed selection exists", () => {
		vi.mocked(useExtensionState).mockReturnValue({ apiConfiguration: {} } as ReturnType<typeof useExtensionState>)
		vi.mocked(useProviderModels).mockReturnValue({
			models: {
				"deepseek-chat": {
					name: "DeepSeek Chat",
					supportsPromptCache: true,
					contextWindow: 128_000,
					apiFormat: ApiFormat.OPENAI_CHAT,
				},
			},
			defaultModelId: "deepseek-chat",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})
		vi.mocked(useProviderConfig).mockReturnValue({ config: undefined, write: vi.fn(), commitSelection: vi.fn() })

		render(<DeepSeekProvider currentMode="act" showModelOptions={true} />)

		expect(screen.getByLabelText("Model")).toHaveValue("deepseek-chat")
	})
})
