import { toProtobufModelInfo } from "@shared/proto-conversions/models/typeConversion"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useDynamicProviderSelection } from "@/hooks/useDynamicProviderSelection"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModels } from "@/hooks/useProviderModels"
import ClineModelPicker from "./ClineModelPicker"

const mocks = vi.hoisted(() => ({
	commitSelection: vi.fn(async () => undefined),
	writeProviderConfig: vi.fn(async () => undefined),
	updateApiConfigurationProto: vi.fn(async () => undefined),
	makeUnaryRequest: vi.fn(async () => ({
		recommended: [
			{
				id: "cline-next",
				description: "Next Cline model",
				tags: ["recommended"],
			},
		],
		free: [],
	})),
	toggleFavoriteModel: vi.fn(async () => undefined),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

vi.mock("@/hooks/useDynamicProviderSelection", () => ({
	useDynamicProviderSelection: vi.fn(),
}))

vi.mock("@/hooks/useProviderModels", () => ({
	useProviderModels: vi.fn(),
}))

vi.mock("@/hooks/useProviderConfig", () => ({
	useProviderConfig: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: {
		makeUnaryRequest: mocks.makeUnaryRequest,
		updateApiConfigurationProto: mocks.updateApiConfigurationProto,
	},
	StateServiceClient: {
		toggleFavoriteModel: mocks.toggleFavoriteModel,
	},
}))

describe("ClineModelPicker", () => {
	beforeEach(() => {
		vi.clearAllMocks()

		vi.mocked(useExtensionState).mockReturnValue({
			apiConfiguration: {
				actModeClineModelId: "cline-default",
				actModeClineModelInfo: {
					name: "Cline Default",
					supportsPromptCache: true,
				},
			},
			favoritedModelIds: [],
			planActSeparateModelsSetting: true,
		} as ReturnType<typeof useExtensionState>)

		vi.mocked(useProviderModels).mockReturnValue({
			models: {
				"cline-default": { name: "Cline Default", supportsPromptCache: true },
				"cline-next": {
					name: "Cline Next",
					supportsPromptCache: true,
					contextWindow: 128_000,
				},
			},
			defaultModelId: "cline-default",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})

		vi.mocked(useProviderConfig).mockReturnValue({
			config: undefined,
			write: mocks.writeProviderConfig,
			commitSelection: mocks.commitSelection,
		})

		vi.mocked(useDynamicProviderSelection).mockReturnValue({
			selectedModelId: "cline-default",
			selectedModelInfo: { name: "Cline Default", supportsPromptCache: true },
			hideUsageCost: false,
		})
	})

	it("commits Cline model selections through provider config so providers.json is updated", async () => {
		render(<ClineModelPicker currentMode="act" />)

		// Featured cards render the catalog display name, but selection still
		// commits the underlying model id.
		fireEvent.click(await screen.findByText("Cline Next"))

		await waitFor(() => expect(mocks.commitSelection).toHaveBeenCalledTimes(1))
		expect(mocks.commitSelection).toHaveBeenCalledWith("act", {
			providerId: "cline",
			modelId: "cline-next",
		})
	})

	it("resolves featured model display names from the provider catalog", async () => {
		mocks.makeUnaryRequest.mockResolvedValueOnce({
			recommended: [{ id: "anthropic/claude-opus-5", description: "Frontier model", tags: ["NEW"] }],
			free: [
				{ id: "deepseek/deepseek-v4-flash", description: "Fast and efficient", tags: [] },
				{ id: "poolside/laguna-s-2.1:free", description: "Latest coding agent model", tags: [] },
				{ id: "unknown/named-model", name: "named-model", description: "Not in the catalog", tags: [] },
				{ id: "unknown/mystery-model", description: "No catalog or endpoint name", tags: [] },
			],
		})
		vi.mocked(useProviderModels).mockReturnValue({
			models: {
				"anthropic/claude-opus-5": { name: "Claude Opus 5", supportsPromptCache: true },
				"deepseek/deepseek-v4-flash": { name: "DeepSeek V4 Flash", supportsPromptCache: true },
				"poolside/laguna-s-2.1:free": { name: "Laguna S 2.1 (free)", supportsPromptCache: false },
			},
			defaultModelId: "anthropic/claude-opus-5",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})

		render(<ClineModelPicker currentMode="act" />)

		expect(await screen.findByText("Claude Opus 5")).toBeInTheDocument()

		fireEvent.click(screen.getByText("Free"))

		expect(await screen.findByText("DeepSeek V4 Flash")).toBeInTheDocument()
		// The FREE chip already says it, so the "(free)" marker is stripped
		expect(screen.getByText("Laguna S 2.1")).toBeInTheDocument()
		// Models missing from the catalog fall back to the endpoint-provided name
		expect(screen.getByText("named-model")).toBeInTheDocument()
		// ...and to the raw id only when there is no endpoint name either
		expect(screen.getByText("unknown/mystery-model")).toBeInTheDocument()
	})

	it("hydrates the selected Cline model from provider config when legacy settings are empty", () => {
		vi.mocked(useExtensionState).mockReturnValue({
			apiConfiguration: {},
			favoritedModelIds: [],
			planActSeparateModelsSetting: true,
		} as ReturnType<typeof useExtensionState>)
		vi.mocked(useProviderConfig).mockReturnValue({
			config: {
				providerId: "cline",
				actSelection: {
					providerId: "cline",
					modelId: "cline-next",
					modelInfo: toProtobufModelInfo({
						name: "Cline Next",
						supportsPromptCache: true,
						contextWindow: 128_000,
					}),
				},
			},
			write: mocks.writeProviderConfig,
			commitSelection: mocks.commitSelection,
		})

		render(<ClineModelPicker currentMode="act" />)

		expect(screen.getByRole("combobox")).toHaveValue("cline-next")
	})

	it("uses live catalog reasoning support when the saved Cline model snapshot is stale", () => {
		vi.mocked(useExtensionState).mockReturnValue({
			apiConfiguration: {
				actModeClineModelId: "glm-5.2",
				actModeClineModelInfo: {
					name: "GLM 5.2",
					supportsPromptCache: true,
				},
			},
			favoritedModelIds: [],
			planActSeparateModelsSetting: true,
		} as ReturnType<typeof useExtensionState>)
		vi.mocked(useProviderModels).mockReturnValue({
			models: {
				"glm-5.2": {
					name: "GLM 5.2",
					supportsPromptCache: true,
					contextWindow: 1_048_576,
					supportsReasoning: true,
				},
			},
			defaultModelId: "glm-5.2",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})
		vi.mocked(useProviderConfig).mockReturnValue({
			config: {
				providerId: "cline",
				actSelection: {
					providerId: "cline",
					modelId: "glm-5.2",
					modelInfo: toProtobufModelInfo({
						name: "GLM 5.2",
						supportsPromptCache: true,
					}),
				},
			},
			write: mocks.writeProviderConfig,
			commitSelection: mocks.commitSelection,
		})
		vi.mocked(useDynamicProviderSelection).mockReturnValue({
			selectedModelId: "glm-5.2",
			selectedModelInfo: { name: "GLM 5.2", supportsPromptCache: true },
			hideUsageCost: false,
		})

		render(<ClineModelPicker currentMode="act" />)

		expect(screen.getByText("Reasoning Effort")).toBeInTheDocument()
	})
})
