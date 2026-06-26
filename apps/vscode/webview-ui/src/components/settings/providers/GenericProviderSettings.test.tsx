import { ApiFormat } from "@shared/proto/cline/models"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ChangeEventHandler, ReactNode } from "react"
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

describe("GenericProviderSettings", () => {
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

	it("shows saved API keys as masked and does not clear them on mount", async () => {
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
		vi.mocked(useProviderConfig).mockReturnValue({ config: { apiKeyLength: 12 } as any, write, commitSelection: vi.fn() })

		render(
			<GenericProviderSettings
				allowsCustomIds={false}
				currentMode="act"
				providerId="deepseek"
				providerName="DeepSeek"
				showModelOptions={false}
			/>,
		)

		const apiKeyInput = screen.getByDisplayValue("••••••••••••")
		await new Promise((resolve) => setTimeout(resolve, 150))
		expect(write).not.toHaveBeenCalled()

		fireEvent.input(apiKeyInput, { target: { value: "new-secret" } })

		await waitFor(() => expect(write).toHaveBeenCalledWith({ apiKey: "new-secret" }))
	})

	it("does not persist mask characters when editing a saved API key", async () => {
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
		vi.mocked(useProviderConfig).mockReturnValue({ config: { apiKeyLength: 7 } as any, write, commitSelection: vi.fn() })

		render(
			<GenericProviderSettings
				allowsCustomIds={false}
				currentMode="act"
				providerId="deepseek"
				providerName="DeepSeek"
				showModelOptions={false}
			/>,
		)

		fireEvent.input(screen.getByDisplayValue("•••••••"), { target: { value: "•••••••f" } })

		await waitFor(() => expect(write).toHaveBeenCalledWith({ apiKey: "f" }), { timeout: 1_000 })
		expect(write).not.toHaveBeenCalledWith({ apiKey: "•••••••f" })
	})

	it("does not replace in-progress API key typing when saved key length rerenders", async () => {
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
		vi.mocked(useProviderConfig).mockReturnValue({ config: { apiKeyLength: 0 } as any, write, commitSelection: vi.fn() })

		const { rerender } = render(
			<GenericProviderSettings
				allowsCustomIds={false}
				currentMode="act"
				providerId="deepseek"
				providerName="DeepSeek"
				showModelOptions={false}
			/>,
		)

		const apiKeyInput = screen.getByPlaceholderText("Enter API Key...")
		fireEvent.focus(apiKeyInput)
		fireEvent.input(apiKeyInput, { target: { value: "max" } })

		await waitFor(() => expect(write).toHaveBeenCalledWith({ apiKey: "max" }))

		vi.mocked(useProviderConfig).mockReturnValue({ config: { apiKeyLength: 3 } as any, write, commitSelection: vi.fn() })
		rerender(
			<GenericProviderSettings
				allowsCustomIds={false}
				currentMode="act"
				providerId="deepseek"
				providerName="DeepSeek"
				showModelOptions={false}
			/>,
		)

		expect(apiKeyInput).toHaveValue("max")

		fireEvent.input(apiKeyInput, { target: { value: "maxpaulus" } })

		await waitFor(() => expect(write).toHaveBeenCalledWith({ apiKey: "maxpaulus" }))
		expect(write).not.toHaveBeenCalledWith({ apiKey: "lus" })
	})

	it("can render and update an optional base URL field through provider config", async () => {
		const write = vi.fn(async () => undefined)
		vi.mocked(useProviderModels).mockReturnValue({
			models: {
				"gemini-3.1-pro-preview": {
					name: "Gemini 3.1 Pro Preview",
					supportsPromptCache: true,
					contextWindow: 1_000_000,
					apiFormat: ApiFormat.GEMINI_CHAT,
				},
			},
			defaultModelId: "gemini-3.1-pro-preview",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})
		vi.mocked(useProviderConfig).mockReturnValue({
			config: { baseUrl: "https://custom.example", apiKeyLength: 0 } as any,
			write,
			commitSelection: vi.fn(),
		})

		render(
			<GenericProviderSettings
				allowsCustomIds={false}
				baseUrlField={{
					label: "Use custom base URL",
					placeholder: "Default: https://generativelanguage.googleapis.com",
				}}
				currentMode="act"
				providerId="gemini"
				providerName="Gemini"
				showModelOptions={false}
			/>,
		)

		const baseUrlInput = screen.getByPlaceholderText("Default: https://generativelanguage.googleapis.com")
		fireEvent.input(baseUrlInput, { target: { value: "https://new.example" } })

		await waitFor(() => expect(write).toHaveBeenCalledWith({ baseUrl: "https://new.example" }))

		fireEvent.click(screen.getByText("Use custom base URL"))

		expect(write).toHaveBeenCalledWith({ baseUrl: "" })
	})
})
