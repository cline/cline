import type { ProviderConfigResponse } from "@shared/proto/cline/models"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ChangeEventHandler, FormEventHandler, ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { useProviderModels } from "@/hooks/useProviderModels"
import { VertexProvider } from "./VertexProvider"

const commitSelection = vi.fn(async () => undefined)

vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: vi.fn() }))
vi.mock("@/hooks/useProviderConfig", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/hooks/useProviderConfig")>()),
	useProviderConfig: vi.fn(),
}))
vi.mock("@/hooks/useProviderModelSelection", () => ({ useProviderModelSelection: vi.fn() }))
vi.mock("@/hooks/useProviderModels", () => ({ useProviderModels: vi.fn() }))
vi.mock("@/hooks/useProviderUsageCostDisplay", () => ({ useProviderUsageCostDisplay: () => "show" }))
vi.mock("../ReasoningEffortSelector", () => ({ default: () => null }))
vi.mock("../ThinkingBudgetSlider", () => ({ default: () => <div>Thinking Budget</div> }))
vi.mock("../common/ModelInfoView", () => ({ ModelInfoView: () => null }))
vi.mock("../common/RemotelyConfiguredInputWrapper", () => ({
	LockIcon: () => null,
	RemotelyConfiguredInputWrapper: ({ children }: { children?: ReactNode }) => children,
}))
vi.mock("../common/DebouncedTextField", () => ({
	DebouncedTextField: ({
		children,
		initialValue,
		onChange,
	}: {
		children?: ReactNode
		initialValue: string
		onChange: (value: string) => void
	}) => (
		<label>
			{children}
			<input defaultValue={initialValue} onChange={(event) => onChange(event.target.value)} />
		</label>
	),
}))
vi.mock("./ModelPickerWithManualEntry", () => ({
	ModelPickerWithManualEntry: ({
		allowsCustomIds,
		models,
		onSelect,
	}: {
		allowsCustomIds: boolean
		models: Record<string, unknown>
		onSelect: (selection: { providerId: "vertex"; modelId: string }) => void
	}) => (
		<>
			{allowsCustomIds && (
				<button onClick={() => onSelect({ providerId: "vertex", modelId: "my-private-vertex-model" })} type="button">
					Use test custom model
				</button>
			)}
			<button onClick={() => onSelect({ providerId: "vertex", modelId: "gemini-3.5-flash" })} type="button">
				Use test catalog model
			</button>
			<div>Visible catalog models: {Object.keys(models).length}</div>
		</>
	),
}))
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeDropdown: ({
		children,
		onChange,
		value,
	}: {
		children?: ReactNode
		onChange?: ChangeEventHandler<HTMLSelectElement>
		value?: string
	}) => (
		<select onChange={onChange} value={value}>
			{children}
		</select>
	),
	VSCodeOption: ({ children, value }: { children?: ReactNode; value?: string }) => <option value={value}>{children}</option>,
	VSCodeLink: ({ children }: { children?: ReactNode }) => <a href="https://example.com">{children}</a>,
	VSCodeCheckbox: ({
		children,
		checked,
		onChange,
	}: {
		children?: ReactNode
		checked?: boolean
		onChange?: FormEventHandler<HTMLInputElement>
	}) => (
		<label>
			<input checked={checked} onChange={onChange} type="checkbox" />
			{children}
		</label>
	),
}))

const knownModelInfo = { name: "Gemini", supportsPromptCache: true, contextWindow: 1_000_000 }
const customModelInfo = {
	name: "my-private-vertex-model",
	supportsPromptCache: true,
	supportsImages: true,
	supportsReasoning: true,
	contextWindow: 200_000,
	maxTokens: 64_000,
}

function providerConfig(config: Partial<ProviderConfigResponse> = {}): ProviderConfigResponse {
	return config as ProviderConfigResponse
}

function setSelection(custom: boolean): void {
	const modelId = custom ? "my-private-vertex-model" : "gemini-3.5-flash"
	const modelInfo = custom ? customModelInfo : knownModelInfo
	vi.mocked(useProviderModelSelection).mockReturnValue({
		committedSelection: undefined,
		fallbackModelId: "gemini-3.5-flash",
		selectedModel: { providerId: "vertex", modelId, modelInfo },
		selectedModelId: modelId,
		selectedModelInfo: modelInfo,
		commitModelSelection: vi.fn(),
	})
}

describe("VertexProvider custom models", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(useExtensionState).mockReturnValue({ apiConfiguration: {}, remoteConfigSettings: undefined } as ReturnType<
			typeof useExtensionState
		>)
		vi.mocked(useProviderModels).mockReturnValue({
			models: { "gemini-3.5-flash": knownModelInfo },
			defaultModelId: "gemini-3.5-flash",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})
		vi.mocked(useProviderConfig).mockReturnValue({
			config: providerConfig(),
			write: vi.fn(async () => providerConfig()),
			commitSelection,
		})
	})

	it("commits a manual ID without overrides so stored tuning is preserved", async () => {
		setSelection(false)
		render(<VertexProvider currentMode="act" showModelOptions={true} />)

		fireEvent.click(screen.getByText("Use test custom model"))

		// No `overrides` field: the tri-state contract treats an omitted value
		// as "preserve stored per-model overrides", so re-selecting a tuned
		// custom model (or selecting it from the other mode) never clobbers it.
		await waitFor(() =>
			expect(commitSelection).toHaveBeenCalledWith("act", {
				providerId: "vertex",
				modelId: "my-private-vertex-model",
			}),
		)
	})

	it("seeds durable defaults once for a committed custom model with no stored overrides", async () => {
		setSelection(true)
		vi.mocked(useProviderConfig).mockReturnValue({
			config: providerConfig({
				actSelection: {
					providerId: "vertex",
					modelId: "my-private-vertex-model",
					modelInfo: { supportsPromptCache: true, tiers: [] },
				},
			}),
			write: vi.fn(async () => providerConfig()),
			commitSelection,
		})

		render(<VertexProvider currentMode="act" showModelOptions={true} />)

		await waitFor(() =>
			expect(commitSelection).toHaveBeenCalledWith("act", {
				providerId: "vertex",
				modelId: "my-private-vertex-model",
				overrides: {
					contextWindow: 200_000,
					maxInputTokens: 200_000,
					maxTokens: 64_000,
					supportsVision: true,
					supportsReasoning: true,
					capabilities: ["prompt-cache"],
				},
			}),
		)
		expect(commitSelection).toHaveBeenCalledTimes(1)
	})

	it("does not reseed defaults when the committed custom model already has stored overrides", async () => {
		setSelection(true)
		vi.mocked(useProviderConfig).mockReturnValue({
			config: providerConfig({
				actSelection: {
					providerId: "vertex",
					modelId: "my-private-vertex-model",
					modelInfo: { supportsPromptCache: true, tiers: [] },
					overrides: {
						contextWindow: 300_000,
						maxInputTokens: 300_000,
						maxTokens: 32_000,
						supportsVision: false,
						supportsReasoning: true,
						capabilities: ["prompt-cache"],
					},
				},
			}),
			write: vi.fn(async () => providerConfig()),
			commitSelection,
		})

		render(<VertexProvider currentMode="act" showModelOptions={true} />)

		// The stored tuning is displayed and no commit fires on mount.
		await waitFor(() => expect(screen.getByLabelText("Context Window Size")).toHaveValue("300000"))
		expect(commitSelection).not.toHaveBeenCalled()
	})

	it("lets users override the custom context window and image support", async () => {
		setSelection(true)
		vi.mocked(useProviderConfig).mockReturnValue({
			config: providerConfig({
				actSelection: {
					providerId: "vertex",
					modelId: "my-private-vertex-model",
					modelInfo: { supportsPromptCache: true, tiers: [] },
					overrides: {
						contextWindow: 200_000,
						maxInputTokens: 200_000,
						maxTokens: 64_000,
						supportsVision: true,
						supportsReasoning: true,
						capabilities: ["prompt-cache"],
					},
				},
			}),
			write: vi.fn(async () => providerConfig()),
			commitSelection,
		})
		render(<VertexProvider currentMode="act" showModelOptions={true} />)
		expect(screen.getByText("Thinking Budget")).toBeInTheDocument()

		fireEvent.change(screen.getByLabelText("Context Window Size"), { target: { value: "300000" } })
		fireEvent.click(screen.getByLabelText("Supports Images"))

		await waitFor(() =>
			expect(commitSelection).toHaveBeenLastCalledWith("act", {
				providerId: "vertex",
				modelId: "my-private-vertex-model",
				overrides: expect.objectContaining({
					contextWindow: 300_000,
					maxInputTokens: 300_000,
					supportsVision: false,
				}),
			}),
		)
	})

	it("clears custom overrides when selecting a catalog model", async () => {
		setSelection(true)
		render(<VertexProvider currentMode="act" showModelOptions={true} />)

		fireEvent.click(screen.getByText("Use test catalog model"))

		await waitFor(() =>
			expect(commitSelection).toHaveBeenCalledWith("act", {
				providerId: "vertex",
				modelId: "gemini-3.5-flash",
				overrides: {},
			}),
		)
	})

	it("keeps manual entry available when the global region filters the catalog", () => {
		setSelection(false)
		vi.mocked(useProviderConfig).mockReturnValue({
			config: providerConfig({ gcp: { region: "global" } }),
			write: vi.fn(async () => providerConfig()),
			commitSelection,
		})

		render(<VertexProvider currentMode="act" showModelOptions={true} />)

		expect(screen.getByText("Visible catalog models: 0")).toBeInTheDocument()
		expect(screen.getByText("Use test custom model")).toBeInTheDocument()
	})
})
