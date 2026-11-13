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
				name: "Cline Next",
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

		// Featured cards render the display name from the RPC, but selection
		// still commits the underlying model id.
		fireEvent.click(await screen.findByText("Cline Next"))

		await waitFor(() => expect(mocks.commitSelection).toHaveBeenCalledTimes(1))
		expect(mocks.commitSelection).toHaveBeenCalledWith("act", {
			providerId: "cline",
			modelId: "cline-next",
		})
	})

	it("edits the cloud selection without touching the Plan/Act model", async () => {
		const onChange = vi.fn()
		render(
			<ClineModelPicker
				cloudSelection={{ modelId: "cline-default", onChange, includeClinePass: true }}
				currentMode="act"
			/>,
		)

		fireEvent.click(await screen.findByText("Cline Next"))

		expect(onChange).toHaveBeenCalledWith("cline-next")
		expect(mocks.commitSelection).not.toHaveBeenCalled()
		expect(mocks.updateApiConfigurationProto).not.toHaveBeenCalled()
	})

	it("offers the cloud catalogs as Usage-Billing, ClinePass and ClineFree tabs", async () => {
		mocks.makeUnaryRequest.mockResolvedValueOnce({
			recommended: [{ id: "cline-next", name: "Cline Next", description: "", tags: [] }],
			free: [{ id: "local-free", name: "Local Free", description: "", tags: [] }],
			clinePass: [{ id: "cline-pass/glm-5.3", name: "GLM 5.3", description: "", tags: [] }],
			clineCloud: [{ id: "cline-cloud/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", description: "", tags: [] }],
		})
		const onChange = vi.fn()
		const { rerender } = render(
			<ClineModelPicker
				cloudSelection={{
					modelId: "cline-pass/glm-5.3",
					onChange,
					includeClinePass: true,
					clinePassNotice: <p>Subscribe to ClinePass</p>,
				}}
				currentMode="act"
			/>,
		)

		// Opens on the tab holding the selected model.
		expect(await screen.findByText("GLM 5.3")).toBeInTheDocument()
		expect(screen.getByText("Usage-Billing")).toBeInTheDocument()
		expect(screen.queryByText("Free")).not.toBeInTheDocument()
		expect(screen.getByText("Subscribe to ClinePass")).toBeInTheDocument()

		fireEvent.click(screen.getByText("ClineFree"))
		expect(screen.queryByText("Subscribe to ClinePass")).not.toBeInTheDocument()
		fireEvent.click(screen.getByText("DeepSeek V4.1 Flash"))
		expect(onChange).toHaveBeenCalledWith("cline-cloud/deepseek-v4.1-flash")

		// Organization accounts don't get ClinePass.
		rerender(
			<ClineModelPicker cloudSelection={{ modelId: "cline-next", onChange, includeClinePass: false }} currentMode="act" />,
		)
		expect(screen.queryByText("ClinePass")).not.toBeInTheDocument()
	})

	it("searches the ClinePass and ClineFree lists in cloud mode, which the local Cline catalog lacks", async () => {
		mocks.makeUnaryRequest.mockResolvedValueOnce({
			recommended: [{ id: "cline-next", name: "Cline Next", description: "", tags: [] }],
			free: [],
			clinePass: [{ id: "cline-pass/glm-5.3", name: "GLM 5.3", description: "", tags: [] }],
			clineCloud: [{ id: "cline-cloud/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", description: "", tags: [] }],
		})
		const onChange = vi.fn()
		render(
			<ClineModelPicker cloudSelection={{ modelId: "cline-next", onChange, includeClinePass: true }} currentMode="act" />,
		)
		await screen.findByText("Cline Next")

		// The search field is a toolkit web component with no value setter in jsdom;
		// give it a writable one before firing input.
		const search = screen.getByRole("combobox") as HTMLInputElement
		fireEvent.focus(search)
		let typed = ""
		Object.defineProperty(search, "value", {
			configurable: true,
			get: () => typed,
			set: (value: string) => {
				typed = value
			},
		})
		fireEvent.input(search, { target: { value: "deepseek" } })

		const option = await screen.findByRole("option")
		expect(option).toHaveTextContent("cline-cloud/deepseek-v4.1-flash")
		fireEvent.click(option)
		expect(onChange).toHaveBeenCalledWith("cline-cloud/deepseek-v4.1-flash")
	})

	it("renders RPC-provided display names on featured cards, falling back to ids", async () => {
		// Names arrive display-ready: the extension host resolves them against
		// the model catalog in fetchClineRecommendedModels.
		mocks.makeUnaryRequest.mockResolvedValueOnce({
			recommended: [{ id: "anthropic/claude-opus-5", name: "Claude Opus 5", description: "Frontier model", tags: ["NEW"] }],
			free: [
				{ id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", description: "Fast and efficient", tags: [] },
				{ id: "unknown/mystery-model", name: "", description: "No display name", tags: [] },
			],
		})

		render(<ClineModelPicker currentMode="act" />)

		expect(await screen.findByText("Claude Opus 5")).toBeInTheDocument()

		fireEvent.click(screen.getByText("Free"))

		expect(await screen.findByText("DeepSeek V4 Flash")).toBeInTheDocument()
		// A missing display name degrades to the raw id
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
