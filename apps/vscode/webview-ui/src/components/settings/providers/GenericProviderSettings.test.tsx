import type { ProviderConfigField } from "@shared/proto/cline/models"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ChangeEventHandler, MouseEventHandler, ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModels } from "@/hooks/useProviderModels"
import { GenericProviderSettings } from "./GenericProviderSettings"

vi.mock("@/hooks/useProviderModels", () => ({
	useProviderModels: vi.fn(),
}))

vi.mock("@/hooks/useProviderConfig", () => ({
	useProviderConfig: vi.fn(),
}))

// The reasoning effort selector reads the extension state for the current
// mode-specific reasoning effort value.
vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ apiConfiguration: {}, planActSeparateModelsSetting: false }),
}))

// Render the dropdown web components as native elements so value/change
// behavior is observable in jsdom. Other toolkit components stay real.
vi.mock("@vscode/webview-ui-toolkit/react", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@vscode/webview-ui-toolkit/react")>()
	return {
		...actual,
		VSCodeCheckbox: ({
			children,
			checked,
			onChange,
			onClick,
		}: {
			children?: ReactNode
			checked?: boolean
			onChange?: ChangeEventHandler<HTMLInputElement>
			onClick?: MouseEventHandler<HTMLInputElement>
		}) => (
			<label>
				<input checked={checked} onChange={onChange} onClick={onClick} readOnly={!onChange} type="checkbox" />
				{children}
			</label>
		),
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
		VSCodeOption: ({ children, value }: { children?: ReactNode; value?: string }) => (
			<option value={value}>{children}</option>
		),
	}
})

function providerSettingsJson(settings: Record<string, unknown>) {
	return JSON.stringify(settings)
}

describe("GenericProviderSettings", () => {
	const apiKeyField: ProviderConfigField = {
		path: "apiKey",
		label: "API Key",
		type: "password",
		placeholder: "Enter API Key...",
		secret: true,
		required: true,
		options: [],
		defaultValueJson: undefined,
		description: undefined,
	}

	const baseUrlField: ProviderConfigField = {
		path: "baseUrl",
		label: "Base URL",
		type: "url",
		placeholder: "Default: https://generativelanguage.googleapis.com",
		secret: false,
		required: false,
		options: [],
		defaultValueJson: undefined,
		description: undefined,
	}

	const headersField: ProviderConfigField = {
		path: "headers",
		label: "Headers",
		type: "text",
		placeholder: '{"x-custom-header":"value"}',
		secret: false,
		required: false,
		options: [],
		defaultValueJson: undefined,
		description: undefined,
	}

	const bedrockGlobalInferenceField: ProviderConfigField = {
		path: "aws.useGlobalInference",
		label: "Global Inference",
		type: "boolean",
		placeholder: undefined,
		secret: false,
		required: false,
		options: [],
		defaultValueJson: JSON.stringify(false),
		description: undefined,
	}

	const bedrockAuthenticationField: ProviderConfigField = {
		path: "aws.authentication",
		label: "Authentication",
		type: "select",
		placeholder: undefined,
		secret: false,
		required: false,
		options: [
			{ label: "AWS SDK / IAM", value: "iam" },
			{ label: "AWS Profile", value: "profile" },
		],
		defaultValueJson: JSON.stringify("iam"),
		description: undefined,
	}

	const typedBooleanSelectField: ProviderConfigField = {
		path: "test.enabled",
		label: "Test Mode",
		type: "select",
		placeholder: undefined,
		secret: false,
		required: false,
		options: [
			{ label: "Disabled", value: "false", valueJson: "false" },
			{ label: "Enabled", value: "true", valueJson: "true" },
		],
		defaultValueJson: JSON.stringify(false),
		description: undefined,
	}

	it("renders catalog-backed provider settings and commits full model selections", async () => {
		const commitSelection = vi.fn(async () => undefined)
		const write = vi.fn(async () => undefined)
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
			config: undefined,
			write,
			commitSelection,
		})

		render(
			<GenericProviderSettings
				allowsCustomIds={false}
				currentMode="act"
				providerId="deepseek"
				providerName="DeepSeek"
				showModelOptions={true}
			/>,
		)

		expect(screen.getByLabelText("Model")).toHaveValue("deepseek-chat")
		expect(screen.queryByText("Reasoning Effort")).not.toBeInTheDocument()
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

	it("renders a reasoning effort selector when the selected model supports reasoning", () => {
		vi.mocked(useProviderModels).mockReturnValue({
			models: {
				"deepseek-reasoner": {
					name: "DeepSeek Reasoner",
					supportsPromptCache: true,
					contextWindow: 128_000,
					supportsReasoning: true,
				},
			},
			defaultModelId: "deepseek-reasoner",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})
		vi.mocked(useProviderConfig).mockReturnValue({
			config: undefined,
			write: vi.fn(async () => undefined),
			commitSelection: vi.fn(),
		})

		render(
			<GenericProviderSettings
				allowsCustomIds={false}
				currentMode="act"
				providerId="deepseek"
				providerName="DeepSeek"
				showModelOptions={true}
			/>,
		)

		expect(screen.getByText("Reasoning Effort")).toBeInTheDocument()
	})

	it("falls back to the allowed catalog model when custom ids are disabled", () => {
		vi.mocked(useProviderModels).mockReturnValue({
			models: {
				"allowed-model": { name: "Allowed Model", supportsPromptCache: true, contextWindow: 128_000 },
			},
			defaultModelId: "allowed-model",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})
		vi.mocked(useProviderConfig).mockReturnValue({
			config: {
				providerId: "openai-compatible",
				actSelection: {
					providerId: "openai-compatible",
					modelId: "blocked-custom-model",
					modelInfo: { supportsPromptCache: false },
				},
			} as any,
			write: vi.fn(async () => undefined),
			commitSelection: vi.fn(),
		})

		render(
			<GenericProviderSettings
				allowsCustomIds={false}
				currentMode="act"
				providerId="openai-compatible"
				providerName="OpenAI Compatible"
				showModelOptions={true}
			/>,
		)

		expect(screen.getByLabelText("Model")).toHaveValue("allowed-model")
		expect(screen.queryByText("Use custom model ID...")).not.toBeInTheDocument()
		expect(screen.queryByText(/blocked-custom-model/)).not.toBeInTheDocument()
	})

	it("renders secret fields blank and does not clear them on mount", async () => {
		const write = vi.fn(async () => undefined)
		vi.mocked(useProviderModels).mockReturnValue({
			models: {},
			defaultModelId: "",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})
		vi.mocked(useProviderConfig).mockReturnValue({ config: undefined, write, commitSelection: vi.fn() })

		render(
			<GenericProviderSettings
				allowsCustomIds={false}
				configFields={[apiKeyField]}
				currentMode="act"
				providerId="deepseek"
				providerName="DeepSeek"
				showModelOptions={false}
			/>,
		)

		const apiKeyInput = screen.getByPlaceholderText("Enter API Key...")
		expect(apiKeyInput).toHaveValue("")
		await new Promise((resolve) => setTimeout(resolve, 150))
		expect(write).not.toHaveBeenCalled()

		fireEvent.input(apiKeyInput, { target: { value: "new-secret" } })

		await waitFor(() => expect(write).toHaveBeenCalledWith({ settingsJson: providerSettingsJson({ apiKey: "new-secret" }) }))
	})

	it("writes secret field edits through provider settings json", async () => {
		const write = vi.fn(async () => undefined)
		vi.mocked(useProviderModels).mockReturnValue({
			models: {},
			defaultModelId: "",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})
		vi.mocked(useProviderConfig).mockReturnValue({ config: undefined, write, commitSelection: vi.fn() })

		render(
			<GenericProviderSettings
				allowsCustomIds={false}
				configFields={[apiKeyField]}
				currentMode="act"
				providerId="deepseek"
				providerName="DeepSeek"
				showModelOptions={false}
			/>,
		)

		fireEvent.input(screen.getByPlaceholderText("Enter API Key..."), { target: { value: "first-secret" } })

		await waitFor(() =>
			expect(write).toHaveBeenCalledWith({ settingsJson: providerSettingsJson({ apiKey: "first-secret" }) }),
		)
	})

	it("renders the saved API key mask and only writes the user-entered suffix", async () => {
		const write = vi.fn(async () => undefined)
		vi.mocked(useProviderModels).mockReturnValue({
			models: {},
			defaultModelId: "",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})
		vi.mocked(useProviderConfig).mockReturnValue({
			config: { apiKeyLength: 6 } as any,
			write,
			commitSelection: vi.fn(),
		})

		render(
			<GenericProviderSettings
				allowsCustomIds={false}
				configFields={[apiKeyField]}
				currentMode="act"
				providerId="deepseek"
				providerName="DeepSeek"
				showModelOptions={false}
			/>,
		)

		const apiKeyInput = screen.getByPlaceholderText("Enter API Key...")
		expect(apiKeyInput).toHaveValue("••••••")

		fireEvent.input(apiKeyInput, { target: { value: "••••••new-secret" } })

		await waitFor(() => expect(write).toHaveBeenCalledWith({ settingsJson: providerSettingsJson({ apiKey: "new-secret" }) }))
	})

	it("does not write locked provider fields", async () => {
		const write = vi.fn(async () => undefined)
		vi.mocked(useProviderModels).mockReturnValue({
			models: {},
			defaultModelId: "",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})
		vi.mocked(useProviderConfig).mockReturnValue({ config: undefined, write, commitSelection: vi.fn() })

		render(
			<GenericProviderSettings
				allowsCustomIds={false}
				configFields={[apiKeyField]}
				currentMode="act"
				lockedFieldPaths={["apiKey"]}
				providerId="deepseek"
				providerName="DeepSeek"
				showModelOptions={false}
			/>,
		)

		fireEvent.input(screen.getByPlaceholderText("Enter API Key..."), { target: { value: "blocked-secret" } })
		await new Promise((resolve) => setTimeout(resolve, 150))

		expect(write).not.toHaveBeenCalled()
	})

	it("does not replace in-progress secret field typing on rerender", async () => {
		const write = vi.fn(async () => undefined)
		vi.mocked(useProviderModels).mockReturnValue({
			models: {},
			defaultModelId: "",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})
		vi.mocked(useProviderConfig).mockReturnValue({ config: undefined, write, commitSelection: vi.fn() })

		const { rerender } = render(
			<GenericProviderSettings
				allowsCustomIds={false}
				configFields={[apiKeyField]}
				currentMode="act"
				providerId="deepseek"
				providerName="DeepSeek"
				showModelOptions={false}
			/>,
		)

		const apiKeyInput = screen.getByPlaceholderText("Enter API Key...")
		fireEvent.focus(apiKeyInput)
		fireEvent.input(apiKeyInput, { target: { value: "max" } })

		await waitFor(() => expect(write).toHaveBeenCalledWith({ settingsJson: providerSettingsJson({ apiKey: "max" }) }))

		vi.mocked(useProviderConfig).mockReturnValue({ config: undefined, write, commitSelection: vi.fn() })
		rerender(
			<GenericProviderSettings
				allowsCustomIds={false}
				configFields={[apiKeyField]}
				currentMode="act"
				providerId="deepseek"
				providerName="DeepSeek"
				showModelOptions={false}
			/>,
		)

		expect(apiKeyInput).toHaveValue("max")

		fireEvent.input(apiKeyInput, { target: { value: "maxpaulus" } })

		await waitFor(() => expect(write).toHaveBeenCalledWith({ settingsJson: providerSettingsJson({ apiKey: "maxpaulus" }) }))
		expect(write).not.toHaveBeenCalledWith({ settingsJson: JSON.stringify({ apiKey: "lus" }) })
	})

	it("can render and update an optional base URL field through provider config", async () => {
		const write = vi.fn(async () => undefined)
		const refresh = vi.fn(async () => undefined)
		vi.mocked(useProviderModels).mockReturnValue({
			models: {},
			defaultModelId: "gemini-3.1-pro-preview",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh,
			fingerprint: "fingerprint",
		})
		vi.mocked(useProviderConfig).mockReturnValue({
			config: undefined,
			write,
			commitSelection: vi.fn(),
		})

		render(
			<GenericProviderSettings
				allowsCustomIds={false}
				configFields={[baseUrlField]}
				configValuesJson={{ baseUrl: JSON.stringify("https://custom.example") }}
				currentMode="act"
				providerId="gemini"
				providerName="Gemini"
				showModelOptions={false}
			/>,
		)

		const baseUrlInput = screen.getByPlaceholderText("Default: https://generativelanguage.googleapis.com")
		expect(baseUrlInput).toHaveValue("https://custom.example")
		fireEvent.input(baseUrlInput, { target: { value: "https://new.example" } })

		await waitFor(() =>
			expect(write).toHaveBeenCalledWith({ settingsJson: providerSettingsJson({ baseUrl: "https://new.example" }) }),
		)
		await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
	})

	it("commits headers as a JSON object through provider config", async () => {
		const write = vi.fn(async () => undefined)
		const refresh = vi.fn(async () => undefined)
		vi.mocked(useProviderModels).mockReturnValue({
			models: {},
			defaultModelId: "custom-model",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh,
			fingerprint: "fingerprint",
		})
		vi.mocked(useProviderConfig).mockReturnValue({
			config: undefined,
			write,
			commitSelection: vi.fn(),
		})

		render(
			<GenericProviderSettings
				allowsCustomIds={true}
				configFields={[headersField]}
				configValuesJson={{ headers: JSON.stringify({ "x-existing": "old" }) }}
				currentMode="act"
				providerId="openai-compatible"
				providerName="OpenAI Compatible"
				showModelOptions={false}
			/>,
		)

		const headersInput = screen.getByPlaceholderText('{"x-custom-header":"value"}')
		expect(headersInput).toHaveValue('{"x-existing":"old"}')
		fireEvent.input(headersInput, { target: { value: '{"x-provider":"compatible"}' } })

		await waitFor(() =>
			expect(write).toHaveBeenCalledWith({
				settingsJson: providerSettingsJson({ headers: { "x-provider": "compatible" } }),
			}),
		)
		await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
	})

	it("shows an inline validation error for invalid headers JSON", async () => {
		const write = vi.fn(async () => undefined)
		vi.mocked(useProviderModels).mockReturnValue({
			models: {},
			defaultModelId: "custom-model",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})
		vi.mocked(useProviderConfig).mockReturnValue({
			config: undefined,
			write,
			commitSelection: vi.fn(),
		})

		render(
			<GenericProviderSettings
				allowsCustomIds={true}
				configFields={[headersField]}
				currentMode="act"
				providerId="openai-compatible"
				providerName="OpenAI Compatible"
				showModelOptions={false}
			/>,
		)

		fireEvent.input(screen.getByPlaceholderText('{"x-custom-header":"value"}'), {
			target: { value: '{"x-provider":42}' },
		})

		expect(await screen.findByRole("alert")).toHaveTextContent("Headers must be a JSON object with string values.")
		expect(write).not.toHaveBeenCalled()
	})

	it("keeps optimistic checkbox edits when provider listing values are stale", async () => {
		const write = vi.fn(async () => undefined)
		vi.mocked(useProviderModels).mockReturnValue({
			models: {},
			defaultModelId: "",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})
		vi.mocked(useProviderConfig).mockReturnValue({ config: undefined, write, commitSelection: vi.fn() })

		const { rerender } = render(
			<GenericProviderSettings
				allowsCustomIds={false}
				configFields={[bedrockGlobalInferenceField]}
				configValuesJson={{ "aws.useGlobalInference": JSON.stringify(false) }}
				currentMode="act"
				providerId="bedrock"
				providerName="AWS Bedrock"
				showModelOptions={false}
			/>,
		)

		const checkbox = screen.getByLabelText("Global Inference")
		fireEvent.click(checkbox)

		await waitFor(() =>
			expect(write).toHaveBeenCalledWith({
				settingsJson: providerSettingsJson({ aws: { useGlobalInference: true } }),
			}),
		)

		rerender(
			<GenericProviderSettings
				allowsCustomIds={false}
				configFields={[bedrockGlobalInferenceField]}
				configValuesJson={{ "aws.useGlobalInference": JSON.stringify(false) }}
				currentMode="act"
				providerId="bedrock"
				providerName="AWS Bedrock"
				showModelOptions={false}
			/>,
		)

		expect(screen.getByLabelText("Global Inference")).toBeChecked()
	})

	it("keeps optimistic select edits when provider listing values are stale", async () => {
		const write = vi.fn(async () => undefined)
		vi.mocked(useProviderModels).mockReturnValue({
			models: {},
			defaultModelId: "",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})
		vi.mocked(useProviderConfig).mockReturnValue({ config: undefined, write, commitSelection: vi.fn() })

		const { rerender } = render(
			<GenericProviderSettings
				allowsCustomIds={false}
				configFields={[bedrockAuthenticationField]}
				configValuesJson={{ "aws.authentication": JSON.stringify("iam") }}
				currentMode="act"
				providerId="bedrock"
				providerName="AWS Bedrock"
				showModelOptions={false}
			/>,
		)

		fireEvent.change(screen.getByLabelText("Authentication"), { target: { value: "profile" } })

		await waitFor(() =>
			expect(write).toHaveBeenCalledWith({
				settingsJson: providerSettingsJson({ aws: { authentication: "profile" } }),
			}),
		)

		rerender(
			<GenericProviderSettings
				allowsCustomIds={false}
				configFields={[bedrockAuthenticationField]}
				configValuesJson={{ "aws.authentication": JSON.stringify("iam") }}
				currentMode="act"
				providerId="bedrock"
				providerName="AWS Bedrock"
				showModelOptions={false}
			/>,
		)

		expect(screen.getByLabelText("Authentication")).toHaveValue("profile")
	})

	it("writes typed select option values from provider metadata", async () => {
		const write = vi.fn(async () => undefined)
		vi.mocked(useProviderModels).mockReturnValue({
			models: {},
			defaultModelId: "",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})
		vi.mocked(useProviderConfig).mockReturnValue({ config: undefined, write, commitSelection: vi.fn() })

		render(
			<GenericProviderSettings
				allowsCustomIds={false}
				configFields={[typedBooleanSelectField]}
				configValuesJson={{ "test.enabled": JSON.stringify(false) }}
				currentMode="act"
				providerId="openai"
				providerName="OpenAI Compatible"
				showModelOptions={false}
			/>,
		)

		fireEvent.change(screen.getByLabelText("Test Mode"), { target: { value: "true" } })

		await waitFor(() =>
			expect(write).toHaveBeenCalledWith({
				settingsJson: providerSettingsJson({ test: { enabled: true } }),
			}),
		)
	})

	it("scopes optimistic field values by mode", async () => {
		const write = vi.fn(async () => undefined)
		vi.mocked(useProviderModels).mockReturnValue({
			models: {},
			defaultModelId: "",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})
		vi.mocked(useProviderConfig).mockReturnValue({ config: undefined, write, commitSelection: vi.fn() })

		const { rerender } = render(
			<GenericProviderSettings
				allowsCustomIds={false}
				configFields={[baseUrlField]}
				configValuesJson={{ baseUrl: JSON.stringify("https://act.example") }}
				currentMode="act"
				providerId="openai-compatible"
				providerName="OpenAI Compatible"
				showModelOptions={false}
			/>,
		)

		fireEvent.input(screen.getByPlaceholderText("Default: https://generativelanguage.googleapis.com"), {
			target: { value: "https://act-edited.example" },
		})

		await waitFor(() =>
			expect(write).toHaveBeenCalledWith({
				settingsJson: providerSettingsJson({ baseUrl: "https://act-edited.example" }),
			}),
		)

		rerender(
			<GenericProviderSettings
				allowsCustomIds={false}
				configFields={[baseUrlField]}
				configValuesJson={{ baseUrl: JSON.stringify("https://plan.example") }}
				currentMode="plan"
				providerId="openai-compatible"
				providerName="OpenAI Compatible"
				showModelOptions={false}
			/>,
		)

		expect(screen.getByLabelText("Base URL")).toHaveValue("https://plan.example")
	})

	it("lets echoed provider listing values clear optimistic overrides", async () => {
		const write = vi.fn(async () => undefined)
		vi.mocked(useProviderModels).mockReturnValue({
			models: {},
			defaultModelId: "",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})
		vi.mocked(useProviderConfig).mockReturnValue({ config: undefined, write, commitSelection: vi.fn() })

		const { rerender } = render(
			<GenericProviderSettings
				allowsCustomIds={false}
				configFields={[baseUrlField]}
				configValuesJson={{ baseUrl: JSON.stringify("https://old.example") }}
				currentMode="act"
				providerId="gemini"
				providerName="Google Gemini"
				showModelOptions={false}
			/>,
		)

		fireEvent.input(screen.getByPlaceholderText("Default: https://generativelanguage.googleapis.com"), {
			target: { value: "https://edited.example" },
		})

		await waitFor(() =>
			expect(write).toHaveBeenCalledWith({
				settingsJson: providerSettingsJson({ baseUrl: "https://edited.example" }),
			}),
		)

		rerender(
			<GenericProviderSettings
				allowsCustomIds={false}
				configFields={[baseUrlField]}
				configValuesJson={{ baseUrl: JSON.stringify("https://edited.example") }}
				currentMode="act"
				providerId="gemini"
				providerName="Google Gemini"
				showModelOptions={false}
			/>,
		)
		rerender(
			<GenericProviderSettings
				allowsCustomIds={false}
				configFields={[baseUrlField]}
				configValuesJson={{ baseUrl: JSON.stringify("https://remote.example") }}
				currentMode="act"
				providerId="gemini"
				providerName="Google Gemini"
				showModelOptions={false}
			/>,
		)

		expect(screen.getByLabelText("Base URL")).toHaveValue("https://remote.example")
	})

	it("filters Vertex model choices when the selected region is global", () => {
		vi.mocked(useProviderModels).mockReturnValue({
			models: {
				"global-ready": {
					name: "Global Ready",
					supportsPromptCache: true,
					contextWindow: 128_000,
					supportsGlobalEndpoint: true,
				},
				"regional-only": {
					name: "Regional Only",
					supportsPromptCache: true,
					contextWindow: 128_000,
					supportsGlobalEndpoint: false,
				},
			},
			defaultModelId: "global-ready",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})
		vi.mocked(useProviderConfig).mockReturnValue({
			config: undefined,
			write: vi.fn(async () => undefined),
			commitSelection: vi.fn(),
		})

		render(
			<GenericProviderSettings
				allowsCustomIds={false}
				configValuesJson={{ "gcp.region": JSON.stringify("global") }}
				currentMode="act"
				providerId="vertex"
				providerName="Google Vertex AI"
				showModelOptions={true}
			/>,
		)

		expect(screen.getByRole("option", { name: "global-ready" })).toBeInTheDocument()
		expect(screen.queryByRole("option", { name: "regional-only" })).not.toBeInTheDocument()
	})
})
