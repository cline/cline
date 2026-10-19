import type { ApiConfiguration } from "@shared/api"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ComponentProps, ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { BedrockProvider } from "./BedrockProvider"

const OPUS = "anthropic.claude-opus-4-6-v1"
const SONNET = "anthropic.claude-sonnet-4-6"
const HAIKU = "anthropic.claude-3-5-haiku-20241022-v1:0"
const mocks = vi.hoisted(() => ({
	apiConfiguration: {} as ApiConfiguration,
	separateModels: true,
	write: vi.fn(async () => ({})),
	update: vi.fn(async (): Promise<unknown> => ({})),
	commitSelection: vi.fn(async () => ({})),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		apiConfiguration: mocks.apiConfiguration,
		planActSeparateModelsSetting: mocks.separateModels,
	}),
}))
vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: { updateApiConfigurationProto: mocks.update },
}))
vi.mock("@/hooks/useProviderConfig", () => ({
	useProviderConfig: () => ({
		// A provider-wide value left by an older save must not replace either mode.
		config: { aws: { customModelBaseId: "anthropic.claude-sonnet-4-6" } },
		write: mocks.write,
		commitSelection: mocks.commitSelection,
	}),
}))
vi.mock("@/hooks/useProviderModelSelection", () => ({
	useProviderModelSelection: (_provider: string, mode: string) => ({
		selectedModelId: mode === "plan" ? "arn:plan-profile" : "arn:act-profile",
		selectedModelInfo: { contextWindow: 200_000, supportsPromptCache: true },
		commitModelSelection: mocks.commitSelection,
	}),
}))
vi.mock("@/hooks/useProviderModels", () => ({
	useProviderModels: () => ({
		models: {
			"anthropic.claude-opus-4-6-v1": { contextWindow: 200_000 },
			"anthropic.claude-sonnet-4-6": { contextWindow: 200_000 },
			"anthropic.claude-3-5-haiku-20241022-v1:0": { contextWindow: 200_000 },
		},
		defaultModelId: "anthropic.claude-opus-4-6-v1",
	}),
}))
vi.mock("../common/ModelInfoView", () => ({ ModelInfoView: () => null }))
vi.mock("../ReasoningEffortSelector", () => ({ default: () => null }))
vi.mock("../common/DebouncedTextField", () => ({
	DebouncedTextField: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))
vi.mock("@/components/ui/tooltip", () => ({
	Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
	TooltipTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
	TooltipContent: () => null,
}))
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeDropdown: (props: ComponentProps<"select">) => <select {...props} />,
	VSCodeOption: (props: ComponentProps<"option">) => <option {...props} />,
	VSCodeCheckbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
	VSCodeRadio: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
	VSCodeRadioGroup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
	VSCodeTextField: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

describe("Bedrock custom base model per mode (#15200)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.separateModels = true
		mocks.apiConfiguration = {
			planModeApiProvider: "bedrock",
			actModeApiProvider: "bedrock",
			planModeApiModelId: "arn:plan-profile",
			actModeApiModelId: "arn:act-profile",
			planModeAwsBedrockCustomModelBaseId: OPUS,
			actModeAwsBedrockCustomModelBaseId: SONNET,
		}
	})

	it("reads each mode independently of the provider-wide last-saved base", () => {
		const view = render(<BedrockProvider currentMode="plan" showModelOptions={true} />)
		expect(screen.getByLabelText("Base Inference Model")).toHaveValue(OPUS)
		view.rerender(<BedrockProvider currentMode="act" showModelOptions={true} />)
		expect(screen.getByLabelText("Base Inference Model")).toHaveValue(SONNET)
	})

	it.each(["plan", "act"] as const)("updates only the %s custom base", async (mode) => {
		render(<BedrockProvider currentMode={mode} showModelOptions={true} />)
		fireEvent.change(screen.getByLabelText("Base Inference Model"), { target: { value: HAIKU } })
		await waitFor(() =>
			expect(mocks.update).toHaveBeenCalledWith(
				expect.objectContaining({
					apiConfiguration: expect.objectContaining({
						planModeAwsBedrockCustomModelBaseId: mode === "plan" ? HAIKU : OPUS,
						actModeAwsBedrockCustomModelBaseId: mode === "act" ? HAIKU : SONNET,
					}),
				}),
			),
		)
		expect(mocks.write).not.toHaveBeenCalled()
	})

	it("keeps both modes synchronized when separate models are disabled", async () => {
		mocks.separateModels = false
		render(<BedrockProvider currentMode="act" showModelOptions={true} />)
		fireEvent.change(screen.getByLabelText("Base Inference Model"), { target: { value: HAIKU } })
		await waitFor(() =>
			expect(mocks.update).toHaveBeenCalledWith(
				expect.objectContaining({
					apiConfiguration: expect.objectContaining({
						planModeAwsBedrockCustomModelBaseId: HAIKU,
						actModeAwsBedrockCustomModelBaseId: HAIKU,
					}),
				}),
			),
		)
	})

	it.each(["plan", "act"] as const)("clears only the %s base when selecting a catalog model", async (mode) => {
		render(<BedrockProvider currentMode={mode} showModelOptions={true} />)
		fireEvent.change(screen.getByLabelText("Model"), { target: { value: HAIKU } })
		await waitFor(() =>
			expect(mocks.update).toHaveBeenCalledWith(
				expect.objectContaining({
					apiConfiguration: expect.objectContaining({
						planModeAwsBedrockCustomModelBaseId: mode === "plan" ? "" : OPUS,
						actModeAwsBedrockCustomModelBaseId: mode === "act" ? "" : SONNET,
					}),
				}),
			),
		)
		expect(mocks.write).not.toHaveBeenCalled()
		expect(mocks.commitSelection).toHaveBeenCalledWith(expect.objectContaining({ modelId: HAIKU }))
	})

	it("finishes clearing the custom base before committing the catalog model", async () => {
		let finishUpdate!: () => void
		mocks.update.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finishUpdate = resolve
				}),
		)
		render(<BedrockProvider currentMode="plan" showModelOptions={true} />)
		fireEvent.change(screen.getByLabelText("Model"), { target: { value: HAIKU } })
		expect(mocks.update).toHaveBeenCalledOnce()
		expect(mocks.commitSelection).not.toHaveBeenCalled()
		finishUpdate()
		await waitFor(() => expect(mocks.commitSelection).toHaveBeenCalledWith(expect.objectContaining({ modelId: HAIKU })))
	})

	it("does not show the other mode's custom controls for a standard model", () => {
		mocks.apiConfiguration.planModeAwsBedrockCustomModelBaseId = ""
		render(<BedrockProvider currentMode="plan" showModelOptions={true} />)
		expect(screen.queryByLabelText("Base Inference Model")).not.toBeInTheDocument()
	})
})
