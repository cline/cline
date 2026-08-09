import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ChangeEventHandler, ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { LMStudioProvider } from "./LMStudioProvider"

const mocks = vi.hoisted(() => ({
	commitModelSelection: vi.fn(),
	commitSelection: vi.fn(),
	getLmStudioModels: vi.fn(),
	handleFieldChange: vi.fn(),
	useExtensionState: vi.fn(),
	useProviderConfig: vi.fn(),
	useProviderModelSelection: vi.fn(),
	write: vi.fn(),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: mocks.useExtensionState,
}))

vi.mock("@/hooks/useProviderConfig", () => ({
	useProviderConfig: mocks.useProviderConfig,
}))

vi.mock("@/hooks/useProviderModelSelection", () => ({
	useProviderModelSelection: mocks.useProviderModelSelection,
}))

vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: {
		getLmStudioModels: mocks.getLmStudioModels,
	},
}))

vi.mock("../utils/useApiConfigurationHandlers", () => ({
	useApiConfigurationHandlers: () => ({ handleFieldChange: mocks.handleFieldChange }),
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
		<select aria-label="LM Studio model" onChange={onChange} value={value}>
			{children}
		</select>
	),
	VSCodeLink: ({ children, href }: { children?: ReactNode; href?: string }) => <a href={href}>{children}</a>,
	VSCodeOption: ({ children, value }: { children?: ReactNode; value?: string }) => <option value={value}>{children}</option>,
	VSCodeTextField: ({ disabled, value }: { disabled?: boolean; value?: string }) => (
		<input aria-label="Context Window" disabled={disabled} value={value} />
	),
}))

vi.mock("../common/ApiKeyField", () => ({
	ApiKeyField: ({ initialValue, onChange }: { initialValue?: string; onChange: (value: string) => void }) => (
		<input aria-label="LM Studio API key" onChange={(event) => onChange(event.target.value)} value={initialValue ?? ""} />
	),
}))

vi.mock("../common/BaseUrlField", () => ({
	BaseUrlField: () => null,
}))

vi.mock("../common/DebouncedTextField", () => ({
	DebouncedTextField: ({ initialValue, placeholder }: { initialValue?: string; placeholder?: string }) => (
		<input placeholder={placeholder} readOnly={true} value={initialValue ?? ""} />
	),
}))

vi.mock("../common/ModelSelector", () => ({
	DropdownContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise
	})
	return { promise, resolve }
}

function modelResponse(id: string) {
	return { values: [JSON.stringify({ id, max_context_length: 8_192 })] }
}

describe("LMStudioProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.commitModelSelection.mockResolvedValue(undefined)
		mocks.commitSelection.mockResolvedValue(undefined)
		mocks.getLmStudioModels.mockResolvedValue({ values: [] })
		mocks.write.mockResolvedValue(undefined)
		mocks.useExtensionState.mockReturnValue({ apiConfiguration: {} })
		mocks.useProviderConfig.mockReturnValue({
			config: { baseUrl: "http://localhost:1234", providerId: "lmstudio" },
			commitSelection: mocks.commitSelection,
			write: mocks.write,
		})
		mocks.useProviderModelSelection.mockReturnValue({
			commitModelSelection: mocks.commitModelSelection,
			selectedModel: { modelId: "", modelInfo: {} },
		})
	})

	it("keeps the latest model list when an earlier API-key refresh resolves last", async () => {
		const firstApiKeyRefresh = deferred<{ values: string[] }>()
		const latestApiKeyRefresh = deferred<{ values: string[] }>()
		mocks.getLmStudioModels
			.mockResolvedValueOnce({ values: [] })
			.mockReturnValueOnce(firstApiKeyRefresh.promise)
			.mockReturnValueOnce(latestApiKeyRefresh.promise)

		render(<LMStudioProvider currentMode="act" showModelOptions={false} />)
		await waitFor(() => expect(mocks.getLmStudioModels).toHaveBeenCalledTimes(1))

		fireEvent.change(screen.getByLabelText("LM Studio API key"), { target: { value: "partial-key" } })
		await waitFor(() => expect(mocks.getLmStudioModels).toHaveBeenCalledTimes(2))

		fireEvent.change(screen.getByLabelText("LM Studio API key"), { target: { value: "final-key" } })
		await waitFor(() => expect(mocks.getLmStudioModels).toHaveBeenCalledTimes(3))

		await act(async () => {
			latestApiKeyRefresh.resolve(modelResponse("latest-model"))
		})
		expect(screen.getByRole("option", { name: "latest-model" })).toBeInTheDocument()

		await act(async () => {
			firstApiKeyRefresh.resolve(modelResponse("stale-model"))
		})
		expect(screen.queryByRole("option", { name: "stale-model" })).not.toBeInTheDocument()
		expect(screen.getByRole("option", { name: "latest-model" })).toBeInTheDocument()
	})
})
