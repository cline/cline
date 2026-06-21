import { toProtobufModelInfo } from "@shared/proto-conversions/models/typeConversion"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { FormEventHandler, KeyboardEventHandler, ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useDynamicProviderSelection } from "@/hooks/useDynamicProviderSelection"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModels } from "@/hooks/useProviderModels"
import ClineModelPicker from "./ClineModelPicker"

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({
		id,
		onBlur,
		onFocus,
		onInput,
		onKeyDown,
		placeholder,
		role,
		value,
	}: {
		id?: string
		onBlur?: FormEventHandler<HTMLInputElement>
		onFocus?: FormEventHandler<HTMLInputElement>
		onInput?: FormEventHandler<HTMLInputElement>
		onKeyDown?: KeyboardEventHandler<HTMLInputElement>
		placeholder?: string
		role?: string
		value?: string
		children?: ReactNode
	}) => (
		<input
			id={id}
			onBlur={onBlur}
			onFocus={onFocus}
			onInput={onInput}
			onKeyDown={onKeyDown}
			placeholder={placeholder}
			role={role}
			value={value}
		/>
	),
}))

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
			planActSeparateModelsSetting: false,
		} as ReturnType<typeof useExtensionState>)

		vi.mocked(useProviderModels).mockReturnValue({
			models: {
				"cline-default": { name: "Cline Default", supportsPromptCache: true, contextWindow: 128_000 },
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

		fireEvent.click(await screen.findByText("cline-next"))

		await waitFor(() => expect(mocks.commitSelection).toHaveBeenCalledTimes(1))
		expect(mocks.commitSelection).toHaveBeenCalledWith("act", {
			providerId: "cline",
			modelId: "cline-next",
			modelInfo: {
				name: "Cline Next",
				supportsPromptCache: true,
				contextWindow: 128_000,
			},
		})
	})

	it("hydrates the selected Cline model from provider config when legacy settings are empty", () => {
		vi.mocked(useExtensionState).mockReturnValue({
			apiConfiguration: {},
			favoritedModelIds: [],
			planActSeparateModelsSetting: false,
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

	it("falls back to the allowed Cline catalog model when remote config narrows the model list", () => {
		vi.mocked(useExtensionState).mockReturnValue({
			apiConfiguration: {
				actModeClineModelId: "blocked-model",
			},
			favoritedModelIds: [],
			planActSeparateModelsSetting: false,
			remoteConfigSettings: {
				remoteProviderModelSettings: {
					cline: {
						models: [{ id: "cline-default" }],
					},
				},
			},
		} as ReturnType<typeof useExtensionState>)
		vi.mocked(useProviderConfig).mockReturnValue({
			config: {
				providerId: "cline",
				actSelection: {
					providerId: "cline",
					modelId: "blocked-model",
					modelInfo: toProtobufModelInfo({
						name: "Blocked Model",
						supportsPromptCache: true,
						contextWindow: 1_000_000,
					}),
				},
			},
			write: mocks.writeProviderConfig,
			commitSelection: mocks.commitSelection,
		})

		render(<ClineModelPicker currentMode="act" />)

		expect(screen.getByRole("combobox")).toHaveValue("cline-default")
		expect(screen.queryByText("blocked-model")).not.toBeInTheDocument()
		expect(screen.getByText("Context:")).toBeInTheDocument()
		expect(screen.getByText("128K")).toBeInTheDocument()
		expect(screen.queryByText("1M")).not.toBeInTheDocument()
	})

	it("does not commit arbitrary typed Cline model ids when remote config narrows the model list", async () => {
		vi.mocked(useExtensionState).mockReturnValue({
			apiConfiguration: {
				actModeClineModelId: "cline-default",
			},
			favoritedModelIds: [],
			planActSeparateModelsSetting: false,
			remoteConfigSettings: {
				remoteProviderModelSettings: {
					cline: {
						models: [{ id: "cline-default" }],
					},
				},
			},
		} as ReturnType<typeof useExtensionState>)

		render(<ClineModelPicker currentMode="act" />)

		const input = screen.getByRole("combobox")
		fireEvent.focus(input)
		fireEvent.input(input, { target: { value: "not-allowed-model" } })
		fireEvent.keyDown(input, { key: "Enter" })

		await waitFor(() => expect(input).toHaveValue("cline-default"))
		expect(mocks.commitSelection).not.toHaveBeenCalled()
	})
})
