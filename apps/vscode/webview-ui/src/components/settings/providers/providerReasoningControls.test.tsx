import { render, screen } from "@testing-library/react"
import type { ChangeEventHandler, ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModels } from "@/hooks/useProviderModels"
import { MoonshotProvider } from "./MoonshotProvider"
import { XaiProvider } from "./XaiProvider"
import { ZAiProvider } from "./ZAiProvider"

vi.mock("@/hooks/useProviderModels", () => ({
	useProviderModels: vi.fn(),
}))

vi.mock("@/hooks/useProviderUsageCostDisplay", () => ({
	useProviderUsageCostDisplay: () => "show",
}))

vi.mock("@/hooks/useProviderConfig", () => ({
	useProviderConfig: vi.fn(),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ apiConfiguration: {}, planActSeparateModelsSetting: false }),
}))

vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: { updateApiConfiguration: vi.fn(async () => undefined) },
	StateServiceClient: { updateSettings: vi.fn(async () => undefined) },
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
		}: {
			children?: ReactNode
			id?: string
			onChange?: ChangeEventHandler<HTMLSelectElement>
			value?: string
		}) => (
			<select id={id} onChange={onChange} value={value}>
				{children}
			</select>
		),
		VSCodeOption: ({ children, value }: { children?: ReactNode; value?: string }) => (
			<option value={value}>{children}</option>
		),
	}
})

function mockModels(models: Record<string, object>, defaultModelId: string) {
	vi.mocked(useProviderModels).mockReturnValue({
		models: models as never,
		defaultModelId,
		isLoading: false,
		isStale: false,
		error: undefined,
		refresh: vi.fn(),
		fingerprint: "fingerprint",
	})
}

const REASONING_MODELS = {
	"reasoning-model": { name: "Reasoning Model", contextWindow: 128_000, supportsReasoning: true },
	"plain-model": { name: "Plain Model", contextWindow: 128_000 },
}

beforeEach(() => {
	vi.mocked(useProviderConfig).mockReturnValue({
		config: undefined,
		write: vi.fn(async () => undefined),
		commitSelection: vi.fn(async () => undefined),
	} as never)
})

// The reasoning-effort selector must be driven by the catalog's
// `supportsReasoning` flag for providers with dedicated settings components,
// the same as GenericProviderSettings-backed providers.
describe.each([
	["XaiProvider", XaiProvider],
	["ZAiProvider", ZAiProvider],
	["MoonshotProvider", MoonshotProvider],
] as const)("%s reasoning controls", (_name, Provider) => {
	it("shows the reasoning effort selector for reasoning-capable models", () => {
		mockModels(REASONING_MODELS, "reasoning-model")

		render(<Provider currentMode="act" showModelOptions={true} />)

		expect(screen.getByText("Reasoning Effort")).toBeInTheDocument()
	})

	it("hides the reasoning effort selector for non-reasoning models", () => {
		mockModels(REASONING_MODELS, "plain-model")

		render(<Provider currentMode="act" showModelOptions={true} />)

		expect(screen.queryByText("Reasoning Effort")).not.toBeInTheDocument()
	})
})
