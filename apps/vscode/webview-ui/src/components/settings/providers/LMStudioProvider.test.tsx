import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ChangeEventHandler, ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { LMStudioProvider } from "./LMStudioProvider"

const mocks = vi.hoisted(() => ({
	commitSelection: vi.fn(),
	handleFieldChange: vi.fn(),
	getLmStudioModels: vi.fn(),
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
	useApiConfigurationHandlers: () => ({
		handleFieldChange: mocks.handleFieldChange,
	}),
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeDropdown: ({
		children,
		id,
		onChange,
		value,
		"aria-label": ariaLabel,
	}: {
		children?: ReactNode
		id?: string
		onChange?: ChangeEventHandler<HTMLSelectElement>
		value?: string
		"aria-label"?: string
	}) => (
		<select aria-label={ariaLabel} id={id} onChange={onChange} value={value}>
			{children}
		</select>
	),
	VSCodeLink: ({ children, href }: { children?: ReactNode; href?: string }) => (
		<a href={href}>{children}</a>
	),
	VSCodeOption: ({ children, value }: { children?: ReactNode; value?: string }) => <option value={value}>{children}</option>,
	VSCodeTextField: ({
		children,
		disabled,
		value,
	}: {
		children?: ReactNode
		disabled?: boolean
		value?: string
	}) => <input disabled={disabled} value={value ?? ""} readOnly />,
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
		<input
			aria-label={`${providerName} API key`}
			data-testid="api-key-field"
			onChange={(event) => onChange(event.target.value)}
			value={initialValue ?? ""}
		/>
	),
}))

vi.mock("../common/BaseUrlField", () => ({
	BaseUrlField: ({
		initialValue,
		label,
		onChange,
	}: {
		initialValue?: string
		label: string
		onChange: (value: string) => void
	}) => (
		<label>
			{label}
			<input aria-label={label} onChange={(event) => onChange(event.target.value)} value={initialValue ?? ""} />
		</label>
	),
}))

vi.mock("../common/DebouncedTextField", () => ({
	DebouncedTextField: ({
		initialValue,
		onChange,
		placeholder,
	}: {
		initialValue?: string
		onChange: (value: string) => void
		placeholder?: string
	}) => <input onChange={(event) => onChange(event.target.value)} placeholder={placeholder} value={initialValue ?? ""} />,
}))

async function renderProvider() {
	const view = render(<LMStudioProvider currentMode="act" showModelOptions={false} />)
	await waitFor(() => expect(mocks.getLmStudioModels).toHaveBeenCalled())
	return view
}

describe("LMStudioProvider", () => {
	beforeEach(() => {
		vi.useRealTimers()
		vi.clearAllMocks()
		mocks.commitSelection.mockResolvedValue(undefined)
		mocks.write.mockResolvedValue(undefined)
		mocks.getLmStudioModels.mockResolvedValue({ values: [] })
		mocks.useExtensionState.mockReturnValue({ apiConfiguration: {} })
		mocks.useProviderModelSelection.mockReturnValue({
			selectedModel: { modelId: "" },
			commitModelSelection: mocks.commitSelection,
		})
		mocks.useProviderConfig.mockReturnValue({
			config: {
				apiKeyLength: 0,
				baseUrl: undefined,
				headers: {},
				providerId: "lmstudio",
			},
			commitSelection: mocks.commitSelection,
			write: mocks.write,
		})
	})

	it("renders an API key field", async () => {
		await renderProvider()
		expect(screen.getByTestId("api-key-field")).toBeInTheDocument()
	})

	it("writes the API key when the user types one", async () => {
		await renderProvider()

		fireEvent.change(screen.getByTestId("api-key-field"), { target: { value: "my-secret-key" } })

		await waitFor(() => expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "my-secret-key" })))
	})

	it("shows a masked placeholder when an API key is already saved", async () => {
		mocks.useProviderConfig.mockReturnValue({
			config: {
				apiKeyLength: 8,
				baseUrl: undefined,
				headers: {},
				providerId: "lmstudio",
			},
			commitSelection: mocks.commitSelection,
			write: mocks.write,
		})

		await renderProvider()
		const input = screen.getByTestId("api-key-field") as HTMLInputElement
		expect(input.value).toBe("••••••••")
	})

	it("fetches models from the configured base URL on mount", async () => {
		mocks.useProviderConfig.mockReturnValue({
			config: {
				apiKeyLength: 0,
				baseUrl: "http://lmstudio.local:1234",
				headers: {},
				providerId: "lmstudio",
			},
			commitSelection: mocks.commitSelection,
			write: mocks.write,
		})

		await renderProvider()

		await waitFor(() => expect(mocks.getLmStudioModels).toHaveBeenCalledWith(expect.objectContaining({ value: "http://lmstudio.local:1234" })))
	})
})
