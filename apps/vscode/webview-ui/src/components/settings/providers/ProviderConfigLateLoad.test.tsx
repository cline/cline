import { act, fireEvent, render, screen } from "@testing-library/react"
import type { ChangeEventHandler, ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { LiteLlmProvider } from "./LiteLlmProvider"
import { OpenAICompatibleProvider } from "./OpenAICompatible"

// Regression tests for edits made while the provider config is still loading:
// the initial readProviderConfig round trip is in flight, so `config` is
// undefined. Typed text must be written to the backend, and the late-arriving
// stored config must not roll the field back. These tests use the real
// useProviderConfig, DebouncedTextField/useDebouncedInput, and API key
// plumbing; only the gRPC transport and unrelated UI is mocked.

const mocks = vi.hoisted(() => ({
	readProviderConfig: vi.fn(),
	refreshOpenAiModels: vi.fn(),
	writeProviderConfig: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: {
		readProviderConfig: mocks.readProviderConfig,
		refreshOpenAiModels: mocks.refreshOpenAiModels,
		writeProviderConfig: mocks.writeProviderConfig,
	},
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ apiConfiguration: {}, remoteConfigSettings: undefined }),
}))

vi.mock("@/hooks/useDynamicProviderSelection", () => ({
	useDynamicProviderSelection: () => ({ selectedModelId: "", selectedModelInfo: undefined, hideUsageCost: false }),
}))

vi.mock("@/hooks/useProviderModels", () => ({
	useProviderModels: () => ({
		models: {},
		defaultModelId: undefined,
		isLoading: false,
		isStale: false,
		error: undefined,
		refresh: vi.fn(),
	}),
}))

vi.mock("@/hooks/useProviderModelSelection", () => ({
	useProviderModelSelection: () => ({
		selectedModelId: "",
		selectedModelInfo: undefined,
		commitModelSelection: vi.fn(),
	}),
}))

vi.mock("../utils/useApiConfigurationHandlers", () => ({
	useApiConfigurationHandlers: () => ({ handleFieldChange: vi.fn(), handleModeFieldChange: vi.fn() }),
}))

vi.mock("@radix-ui/react-tooltip", () => ({
	TooltipContent: () => null,
	TooltipTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))

vi.mock("@/components/ui/tooltip", () => ({
	Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
	TooltipContent: () => null,
	TooltipTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
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
	VSCodeDropdown: ({ children, onChange, value }: { children?: ReactNode; onChange?: ChangeEventHandler; value?: string }) => (
		<select onChange={onChange} value={value}>
			{children}
		</select>
	),
	VSCodeLink: ({ children, href }: { children?: ReactNode; href?: string }) => <a href={href}>{children}</a>,
	VSCodeOption: ({ children, value }: { children?: ReactNode; value?: string }) => <option value={value}>{children}</option>,
	VSCodeTextField: ({
		children,
		disabled,
		onInput,
		placeholder,
		type,
		value,
	}: {
		children?: ReactNode
		disabled?: boolean
		onInput?: ChangeEventHandler<HTMLInputElement>
		placeholder?: string
		type?: string
		value?: string
	}) => (
		<label>
			{children}
			<input disabled={disabled} onChange={onInput} placeholder={placeholder} type={type ?? "text"} value={value} />
		</label>
	),
}))

vi.mock("../common/ModelAutocomplete", () => ({ ModelAutocomplete: () => null }))
vi.mock("../common/ModelInfoView", () => ({ ModelInfoView: () => null }))
vi.mock("../ReasoningEffortSelector", () => ({ default: () => null }))

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise
	})
	return { promise, resolve }
}

async function flushDebounce() {
	await act(async () => {
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 150))
	})
}

type WriteRequest = {
	providerId: string
	patch?: { apiKey?: string; baseUrl?: string }
}

function storedConfig(providerId: string) {
	return { providerId, apiKeyLength: 10, baseUrl: "http://stored.example/v1", headers: {} }
}

describe("provider settings edits made before config loads", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.refreshOpenAiModels.mockResolvedValue({ values: [] })
		mocks.writeProviderConfig.mockImplementation(async (request: WriteRequest) => ({
			providerId: request.providerId,
			baseUrl: request.patch?.baseUrl || "",
			apiKeyLength: request.patch?.apiKey ? request.patch.apiKey.length : 0,
			headers: {},
		}))
	})

	it("OpenAI Compatible: persists a base URL typed before the initial read resolves", async () => {
		const initialRead = deferred<ReturnType<typeof storedConfig>>()
		mocks.readProviderConfig.mockReturnValue(initialRead.promise)
		render(<OpenAICompatibleProvider currentMode="act" providerId="custom-openai" showModelOptions={false} />)

		const baseUrlInput = screen.getByPlaceholderText("Enter base URL...")
		fireEvent.change(baseUrlInput, { target: { value: "http://typed.example:1234/v1" } })
		await flushDebounce()

		expect(mocks.writeProviderConfig).toHaveBeenCalledTimes(1)
		expect(mocks.writeProviderConfig.mock.calls[0][0].patch.baseUrl).toBe("http://typed.example:1234/v1")

		// The slow initial read lands with the pre-edit stored config; it is
		// stale (an older request than the write) and must not roll back the
		// field.
		await act(async () => {
			initialRead.resolve(storedConfig("custom-openai"))
		})

		expect(baseUrlInput).toHaveValue("http://typed.example:1234/v1")
	})

	it("OpenAI Compatible: persists an API key typed before the initial read resolves", async () => {
		const initialRead = deferred<ReturnType<typeof storedConfig>>()
		mocks.readProviderConfig.mockReturnValue(initialRead.promise)
		render(<OpenAICompatibleProvider currentMode="act" providerId="custom-openai" showModelOptions={false} />)

		fireEvent.change(screen.getByPlaceholderText("Enter API Key..."), { target: { value: "early-secret" } })
		await flushDebounce()

		expect(mocks.writeProviderConfig).toHaveBeenCalledTimes(1)
		expect(mocks.writeProviderConfig.mock.calls[0][0].patch.apiKey).toBe("early-secret")

		await act(async () => {
			initialRead.resolve(storedConfig("custom-openai"))
		})

		// The write's read-back reports the new key's length, so the field
		// shows the saved-key mask for the key just typed — not the stale
		// stored key's mask.
		expect(screen.getByPlaceholderText("Enter API Key...")).toHaveValue("•".repeat("early-secret".length))
	})

	it("LiteLLM: persists a base URL typed before the initial read resolves", async () => {
		const initialRead = deferred<ReturnType<typeof storedConfig>>()
		mocks.readProviderConfig.mockReturnValue(initialRead.promise)
		render(<LiteLlmProvider currentMode="act" showModelOptions={false} />)

		const baseUrlInput = screen.getByPlaceholderText("Default: http://localhost:4000")
		fireEvent.change(baseUrlInput, { target: { value: "http://typed.example:4000" } })
		await flushDebounce()

		expect(mocks.writeProviderConfig).toHaveBeenCalledTimes(1)
		expect(mocks.writeProviderConfig.mock.calls[0][0].patch.baseUrl).toBe("http://typed.example:4000")

		await act(async () => {
			initialRead.resolve(storedConfig("litellm"))
		})

		expect(baseUrlInput).toHaveValue("http://typed.example:4000")
	})

	it("LiteLLM: persists an API key typed before the initial read resolves", async () => {
		const initialRead = deferred<ReturnType<typeof storedConfig>>()
		mocks.readProviderConfig.mockReturnValue(initialRead.promise)
		render(<LiteLlmProvider currentMode="act" showModelOptions={false} />)

		fireEvent.change(screen.getByPlaceholderText("Default: noop"), { target: { value: "sk-early" } })
		await flushDebounce()

		expect(mocks.writeProviderConfig).toHaveBeenCalledTimes(1)
		expect(mocks.writeProviderConfig.mock.calls[0][0].patch.apiKey).toBe("sk-early")

		await act(async () => {
			initialRead.resolve(storedConfig("litellm"))
		})

		expect(screen.getByPlaceholderText("Default: noop")).toHaveValue("•".repeat("sk-early".length))
	})
})
