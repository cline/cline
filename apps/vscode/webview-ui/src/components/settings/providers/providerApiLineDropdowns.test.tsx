import { fireEvent, render, screen } from "@testing-library/react"
import type { ChangeEventHandler, ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModels } from "@/hooks/useProviderModels"
import { MoonshotProvider } from "./MoonshotProvider"
import { QwenProvider } from "./QwenProvider"

vi.mock("@/hooks/useProviderModels", () => ({
	useProviderModels: vi.fn(),
}))

vi.mock("@/hooks/useProviderUsageCostDisplay", () => ({
	useProviderUsageCostDisplay: () => "show",
}))

vi.mock("@/hooks/useProviderConfig", () => ({
	useProviderConfig: vi.fn(),
}))

const mockExtensionState = vi.hoisted(() => ({
	state: { apiConfiguration: {} as Record<string, unknown>, planActSeparateModelsSetting: false },
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockExtensionState.state,
}))

vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: {
		updateApiConfiguration: vi.fn(async () => undefined),
		updateApiConfigurationProto: vi.fn(async () => undefined),
	},
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

const writeMock = vi.fn(async () => undefined)

function mockProviderConfig(config: { apiLine?: string } | undefined) {
	vi.mocked(useProviderConfig).mockReturnValue({
		config,
		write: writeMock,
		commitSelection: vi.fn(async () => undefined),
	} as never)
}

beforeEach(() => {
	vi.clearAllMocks()
	mockExtensionState.state = { apiConfiguration: {}, planActSeparateModelsSetting: false }
	mockProviderConfig(undefined)
	vi.mocked(useProviderModels).mockReturnValue({
		models: { "some-model": { name: "Some Model", contextWindow: 128_000 } } as never,
		defaultModelId: "some-model",
		isLoading: false,
		isStale: false,
		error: undefined,
		refresh: vi.fn(),
		fingerprint: "fingerprint",
	})
})

// The regional API line must persist through useProviderConfig's write()
// (WriteProviderConfig gRPC), which updates providers.json — shared with the
// CLI and desktop app — and mirrors to the legacy state key host-side. A
// legacy-state-only write leaves providers.json stale and sends other hosts
// to the wrong regional endpoint.
describe.each([
	{
		name: "QwenProvider",
		Provider: QwenProvider,
		label: "Alibaba API Line",
		legacyKey: "qwenApiLine",
	},
	{
		name: "MoonshotProvider",
		Provider: MoonshotProvider,
		label: "Moonshot Entrypoint",
		legacyKey: "moonshotApiLine",
	},
] as const)("$name API line dropdown", ({ Provider, label, legacyKey }) => {
	it("writes apiLine through the SDK provider config on change", () => {
		render(<Provider currentMode="act" showModelOptions={false} />)

		fireEvent.change(screen.getByLabelText(label), { target: { value: "china" } })

		expect(writeMock).toHaveBeenCalledTimes(1)
		expect(writeMock).toHaveBeenCalledWith({ apiLine: "china" })
	})

	it("renders the SDK provider config's apiLine once loaded", () => {
		mockProviderConfig({ apiLine: "china" })
		mockExtensionState.state = { apiConfiguration: { [legacyKey]: "international" }, planActSeparateModelsSetting: false }

		render(<Provider currentMode="act" showModelOptions={false} />)

		expect(screen.getByLabelText(label)).toHaveValue("china")
	})

	it("falls back to the legacy state value before the SDK config loads", () => {
		mockProviderConfig(undefined)
		mockExtensionState.state = { apiConfiguration: { [legacyKey]: "china" }, planActSeparateModelsSetting: false }

		render(<Provider currentMode="act" showModelOptions={false} />)

		expect(screen.getByLabelText(label)).toHaveValue("china")
	})
})
