import { ApiFormat } from "@shared/proto/cline/models"
import { act, fireEvent, render, screen } from "@testing-library/react"
import type { ChangeEventHandler, ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { OpenAICompatibleProvider } from "./OpenAICompatible"

const mocks = vi.hoisted(() => ({
	commitSelection: vi.fn(),
	handleFieldChange: vi.fn(),
	handleModeFieldChange: vi.fn(),
	refreshOpenAiModels: vi.fn(),
	useDynamicProviderSelection: vi.fn(),
	useExtensionState: vi.fn(),
	useProviderConfig: vi.fn(),
	write: vi.fn(),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: mocks.useExtensionState,
}))

vi.mock("@/hooks/useDynamicProviderSelection", () => ({
	useDynamicProviderSelection: mocks.useDynamicProviderSelection,
}))

vi.mock("@/hooks/useProviderConfig", () => ({
	fromProtobufProviderModelOverrides: (overrides: Record<string, unknown> | undefined) =>
		overrides ? { ...overrides } : undefined,
	useProviderConfig: mocks.useProviderConfig,
}))

vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: {
		refreshOpenAiModels: mocks.refreshOpenAiModels,
	},
}))

vi.mock("../utils/useApiConfigurationHandlers", () => ({
	useApiConfigurationHandlers: () => ({
		handleFieldChange: mocks.handleFieldChange,
		handleModeFieldChange: mocks.handleModeFieldChange,
	}),
}))

vi.mock("@radix-ui/react-tooltip", () => ({
	TooltipContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
	TooltipTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))

vi.mock("@/components/ui/tooltip", () => ({
	Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ children, disabled, onClick }: { children?: ReactNode; disabled?: boolean; onClick?: () => void }) => (
		<button disabled={disabled} onClick={onClick} type="button">
			{children}
		</button>
	),
	VSCodeCheckbox: ({
		checked,
		children,
		onChange,
	}: {
		checked?: boolean
		children?: ReactNode
		onChange?: ChangeEventHandler<HTMLInputElement>
	}) => (
		<label>
			<input checked={checked} onChange={onChange} type="checkbox" />
			{children}
		</label>
	),
}))

vi.mock("../common/ApiKeyField", () => ({
	ApiKeyField: ({
		initialValue,
		onChange,
		providerName,
	}: {
		initialValue?: string
		onChange: (value: string) => void
		providerName: string
	}) => (
		<input aria-label={`${providerName} API key`} onChange={(event) => onChange(event.target.value)} value={initialValue} />
	),
}))

vi.mock("../common/BaseUrlField", () => ({
	BaseUrlField: ({
		disabled,
		initialValue,
		label,
		onChange,
	}: {
		disabled?: boolean
		initialValue?: string
		label: string
		onChange: (value: string) => void
	}) => (
		<label>
			{label}
			<input
				aria-label={label}
				disabled={disabled}
				onChange={(event) => onChange(event.target.value)}
				value={initialValue ?? ""}
			/>
		</label>
	),
}))

vi.mock("../common/DebouncedTextField", () => ({
	DebouncedTextField: ({
		children,
		disabled,
		initialValue,
		onChange,
		placeholder,
	}: {
		children?: ReactNode
		disabled?: boolean
		initialValue?: string
		onChange: (value: string) => void
		placeholder?: string
	}) => (
		<label>
			{children}
			<input
				disabled={disabled}
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				value={initialValue ?? ""}
			/>
		</label>
	),
}))

vi.mock("../common/ModelInfoView", () => ({ ModelInfoView: () => null }))
vi.mock("../ReasoningEffortSelector", () => ({ default: () => null }))

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise
	})
	return { promise, resolve }
}

function renderProvider() {
	return render(<OpenAICompatibleProvider currentMode="act" providerId="custom-openai" showModelOptions={false} />)
}

function setCommittedSelection(overrides: Record<string, unknown>, modelInfo: Record<string, unknown> = {}) {
	mocks.useProviderConfig.mockReturnValue({
		config: {
			actSelection: {
				providerId: "custom-openai",
				modelId: "custom-model",
				modelInfo: {
					contextWindow: 128_000,
					inputPrice: 0,
					maxTokens: -1,
					outputPrice: 0,
					temperature: 0,
					tiers: [],
					...modelInfo,
				},
				overrides,
			},
			apiKeyLength: 12,
			baseUrl: "http://localhost:1234/v1",
			headers: {},
			providerId: "custom-openai",
		},
		commitSelection: mocks.commitSelection,
		write: mocks.write,
	})
}

describe("OpenAICompatibleProvider", () => {
	beforeEach(() => {
		vi.useRealTimers()
		vi.clearAllMocks()
		mocks.commitSelection.mockResolvedValue(undefined)
		mocks.write.mockResolvedValue(undefined)
		mocks.refreshOpenAiModels.mockResolvedValue({ values: [] })
		mocks.useExtensionState.mockReturnValue({
			apiConfiguration: { azureApiVersion: "2025-04-01-preview", azureIdentity: false },
			remoteConfigSettings: undefined,
		})
		mocks.useDynamicProviderSelection.mockReturnValue({
			selectedModelId: "custom-model",
			selectedModelInfo: {
				contextWindow: 128_000,
				inputPrice: 0,
				maxTokens: -1,
				outputPrice: 0,
				temperature: 0,
			},
		})
		mocks.useProviderConfig.mockReturnValue({
			config: {
				apiKeyLength: 12,
				baseUrl: "http://localhost:1234/v1",
				headers: {},
				providerId: "custom-openai",
			},
			commitSelection: mocks.commitSelection,
			write: mocks.write,
		})
	})

	it("refreshes keyless endpoints and displays only the saved-key mask", async () => {
		renderProvider()

		await act(async () => {})

		expect(mocks.refreshOpenAiModels).toHaveBeenCalledWith(
			expect.objectContaining({ baseUrl: "http://localhost:1234/v1", apiKey: "" }),
		)
		expect(screen.getByLabelText("OpenAI Compatible API key")).toHaveValue("••••••••••••")
	})

	it("writes a newly entered API key without echoing a stored key into config", async () => {
		renderProvider()
		await act(async () => {})

		fireEvent.change(screen.getByLabelText("OpenAI Compatible API key"), { target: { value: "new-secret" } })

		expect(mocks.write).toHaveBeenCalledWith({ apiKey: "new-secret" })
	})

	it("commits ordinary model selections by ID only", async () => {
		mocks.refreshOpenAiModels.mockResolvedValue({ values: ["listed-model"] })
		renderProvider()
		await act(async () => {})

		fireEvent.change(screen.getByLabelText("Model ID"), { target: { value: "listed-model" } })

		expect(mocks.commitSelection).toHaveBeenCalledWith("act", {
			providerId: "custom-openai",
			modelId: "listed-model",
		})
	})

	it("persists only the edited vision field while preserving existing overrides", async () => {
		setCommittedSelection({
			apiFormat: ApiFormat.OPENAI_RESPONSES,
			cacheReadsPrice: 0.5,
			cacheWritesPrice: 0.75,
			capabilities: ["tools", "streaming"],
			outputPrice: 2,
		})
		renderProvider()
		await act(async () => {})
		fireEvent.click(screen.getByText("Model Configuration"))

		fireEvent.click(screen.getByRole("checkbox", { name: "Supports Images" }))

		expect(mocks.commitSelection).toHaveBeenCalledWith("act", {
			providerId: "custom-openai",
			modelId: "custom-model",
			overrides: {
				apiFormat: ApiFormat.OPENAI_RESPONSES,
				cacheReadsPrice: 0.5,
				cacheWritesPrice: 0.75,
				capabilities: ["tools", "streaming"],
				outputPrice: 2,
				supportsVision: true,
			},
		})
	})

	it("restores the R1 checkbox from authored override readback", async () => {
		setCommittedSelection({ isR1FormatRequired: true })
		renderProvider()
		await act(async () => {})
		fireEvent.click(screen.getByText("Model Configuration"))

		expect(screen.getByRole("checkbox", { name: "Enable R1 messages format" })).toBeChecked()
	})

	it("restores the R1 checkbox from canonical resolved apiFormat", async () => {
		setCommittedSelection({}, { apiFormat: ApiFormat.R1_CHAT })
		renderProvider()
		await act(async () => {})
		fireEvent.click(screen.getByText("Model Configuration"))

		expect(screen.getByRole("checkbox", { name: "Enable R1 messages format" })).toBeChecked()
	})

	it("persists the R1 checkbox as one explicit override", async () => {
		renderProvider()
		await act(async () => {})
		fireEvent.click(screen.getByText("Model Configuration"))

		fireEvent.click(screen.getByRole("checkbox", { name: "Enable R1 messages format" }))

		expect(mocks.commitSelection).toHaveBeenCalledWith("act", {
			providerId: "custom-openai",
			modelId: "custom-model",
			overrides: { isR1FormatRequired: true },
		})
	})

	it("persists a temperature edit without adding resolved defaults", async () => {
		renderProvider()
		await act(async () => {})
		fireEvent.click(screen.getByText("Model Configuration"))

		fireEvent.change(screen.getByLabelText("Temperature"), { target: { value: "0.25" } })

		expect(mocks.commitSelection).toHaveBeenCalledWith("act", {
			providerId: "custom-openai",
			modelId: "custom-model",
			overrides: { temperature: 0.25 },
		})
	})

	it.each([
		["Context Window Size", "contextWindow", "64000", 64_000],
		["Max Output Tokens", "maxTokens", "4096", 4_096],
		["Output Price / 1M tokens", "outputPrice", "2.5", 2.5],
	] as const)("maps %s only to the %s override", async (label, key, input, expected) => {
		renderProvider()
		await act(async () => {})
		fireEvent.click(screen.getByText("Model Configuration"))

		fireEvent.change(screen.getByLabelText(label), { target: { value: input } })

		expect(mocks.commitSelection).toHaveBeenCalledWith("act", {
			providerId: "custom-openai",
			modelId: "custom-model",
			overrides: { [key]: expected },
		})
	})

	it("clears one override while preserving unrelated fields", async () => {
		setCommittedSelection({
			apiFormat: ApiFormat.OPENAI_RESPONSES,
			capabilities: ["tools", "streaming"],
			temperature: 0.4,
		})
		renderProvider()
		await act(async () => {})
		fireEvent.click(screen.getByText("Model Configuration"))

		fireEvent.change(screen.getByLabelText("Temperature"), { target: { value: "" } })

		expect(mocks.commitSelection).toHaveBeenCalledWith("act", {
			providerId: "custom-openai",
			modelId: "custom-model",
			overrides: {
				apiFormat: ApiFormat.OPENAI_RESPONSES,
				capabilities: ["tools", "streaming"],
			},
		})
	})

	it("preserves apiFormat while editing pricing", async () => {
		setCommittedSelection({
			apiFormat: ApiFormat.OPENAI_RESPONSES,
			capabilities: ["tools"],
		})
		renderProvider()
		await act(async () => {})
		fireEvent.click(screen.getByText("Model Configuration"))

		fireEvent.change(screen.getByLabelText("Input Price / 1M tokens"), { target: { value: "1.25" } })

		expect(mocks.commitSelection).toHaveBeenCalledWith("act", {
			providerId: "custom-openai",
			modelId: "custom-model",
			overrides: {
				apiFormat: ApiFormat.OPENAI_RESPONSES,
				capabilities: ["tools"],
				inputPrice: 1.25,
			},
		})
	})

	it("sends an empty replacement when the final override is cleared", async () => {
		setCommittedSelection({ temperature: 0.4 })
		renderProvider()
		await act(async () => {})
		fireEvent.click(screen.getByText("Model Configuration"))

		fireEvent.change(screen.getByLabelText("Temperature"), { target: { value: "" } })

		expect(mocks.commitSelection).toHaveBeenCalledWith("act", {
			providerId: "custom-openai",
			modelId: "custom-model",
			overrides: {},
		})
	})

	it("shows invalid-number feedback without committing", async () => {
		renderProvider()
		await act(async () => {})
		fireEvent.click(screen.getByText("Model Configuration"))

		fireEvent.change(screen.getByLabelText("Max Output Tokens"), { target: { value: "80000o" } })

		expect(screen.getByRole("alert")).toHaveTextContent("Max Output Tokens must be a valid number.")
		expect(mocks.commitSelection).not.toHaveBeenCalled()
	})

	it("merges rapid edits using the pending override set", async () => {
		renderProvider()
		await act(async () => {})
		fireEvent.click(screen.getByText("Model Configuration"))

		fireEvent.change(screen.getByLabelText("Temperature"), { target: { value: "0.25" } })
		fireEvent.change(screen.getByLabelText("Input Price / 1M tokens"), { target: { value: "1.5" } })

		expect(mocks.commitSelection).toHaveBeenLastCalledWith("act", {
			providerId: "custom-openai",
			modelId: "custom-model",
			overrides: { inputPrice: 1.5, temperature: 0.25 },
		})
	})

	it("debounces model refreshes triggered by base URL edits", async () => {
		vi.useFakeTimers()
		renderProvider()
		await act(async () => {})
		expect(mocks.refreshOpenAiModels).toHaveBeenCalledTimes(1)

		fireEvent.change(screen.getByDisplayValue("http://localhost:1234/v1"), {
			target: { value: "http://localhost:5678/v1" },
		})
		expect(mocks.refreshOpenAiModels).toHaveBeenCalledTimes(1)

		await act(async () => {
			vi.advanceTimersByTime(499)
		})
		expect(mocks.refreshOpenAiModels).toHaveBeenCalledTimes(1)

		await act(async () => {
			vi.advanceTimersByTime(1)
		})
		expect(mocks.refreshOpenAiModels).toHaveBeenCalledTimes(2)
	})

	it("ignores a stale model-list response", async () => {
		vi.useFakeTimers()
		const oldRequest = deferred<{ values: string[] }>()
		const newRequest = deferred<{ values: string[] }>()
		mocks.refreshOpenAiModels.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise)
		renderProvider()

		fireEvent.change(screen.getByDisplayValue("http://localhost:1234/v1"), {
			target: { value: "http://localhost:5678/v1" },
		})
		await act(async () => {
			vi.advanceTimersByTime(500)
		})

		await act(async () => {
			newRequest.resolve({ values: ["new-model"] })
		})
		expect(screen.getByRole("option", { name: "new-model" })).toBeInTheDocument()

		await act(async () => {
			oldRequest.resolve({ values: ["stale-model"] })
		})
		expect(screen.queryByRole("option", { name: "stale-model" })).not.toBeInTheDocument()
		expect(screen.getByRole("option", { name: "new-model" })).toBeInTheDocument()
	})

	it("cancels a pending debounced refresh when unmounted", async () => {
		vi.useFakeTimers()
		const view = renderProvider()
		await act(async () => {})

		fireEvent.change(screen.getByDisplayValue("http://localhost:1234/v1"), {
			target: { value: "http://localhost:5678/v1" },
		})
		view.unmount()
		await act(async () => {
			vi.advanceTimersByTime(500)
		})

		expect(mocks.refreshOpenAiModels).toHaveBeenCalledTimes(1)
	})

	it("restores Azure settings and remote-config locks", async () => {
		mocks.useExtensionState.mockReturnValue({
			apiConfiguration: { azureApiVersion: "2025-04-01-preview", azureIdentity: true },
			remoteConfigSettings: {
				azureApiVersion: "2025-04-01-preview",
				openAiBaseUrl: "https://managed.example/v1",
				openAiHeaders: { "x-managed": "true" },
			},
		})
		renderProvider()
		await act(async () => {})

		expect(screen.getByDisplayValue("http://localhost:1234/v1")).toBeDisabled()
		expect(screen.getByRole("button", { name: "Add Header" })).toBeDisabled()
		expect(screen.getByLabelText("Set Azure API version")).toBeDisabled()
		expect(screen.getByRole("checkbox", { name: "Use Azure Identity Authentication" })).toBeChecked()
	})

	it("writes editable Azure settings through the legacy handlers", async () => {
		renderProvider()
		await act(async () => {})

		fireEvent.change(screen.getByLabelText("Set Azure API version"), { target: { value: "2026-01-01" } })
		fireEvent.click(screen.getByRole("checkbox", { name: "Use Azure Identity Authentication" }))

		expect(mocks.handleFieldChange).toHaveBeenCalledWith("azureApiVersion", "2026-01-01")
		expect(mocks.handleFieldChange).toHaveBeenCalledWith("azureIdentity", true)
	})
})
