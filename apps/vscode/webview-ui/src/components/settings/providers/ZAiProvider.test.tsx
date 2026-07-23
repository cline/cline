import { toProtobufModelInfo } from "@shared/proto-conversions/models/typeConversion"
import { render, screen } from "@testing-library/react"
import type { ChangeEventHandler, ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModels } from "@/hooks/useProviderModels"
import { useStaticProviderSelection } from "@/hooks/useStaticProviderSelection"
import { ZAiProvider } from "./ZAiProvider"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

vi.mock("@/hooks/useProviderConfig", () => ({
	useProviderConfig: vi.fn(),
}))

vi.mock("@/hooks/useProviderModels", () => ({
	useProviderModels: vi.fn(),
}))

vi.mock("@/hooks/useStaticProviderSelection", () => ({
	useStaticProviderSelection: vi.fn(),
}))

vi.mock("../utils/useApiConfigurationHandlers", () => ({
	useApiConfigurationHandlers: () => ({
		handleModeFieldChange: vi.fn(),
	}),
}))

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

describe("ZAiProvider", () => {
	it("uses live catalog reasoning support when the saved model snapshot is stale", () => {
		const liveModelInfo = {
			name: "GLM 5.2",
			supportsPromptCache: true,
			contextWindow: 1_048_576,
			supportsReasoning: true,
		}

		vi.mocked(useExtensionState).mockReturnValue({
			apiConfiguration: {
				apiProvider: "zai",
				actModeApiModelId: "glm-5.2",
				zaiApiKey: "test-key",
			},
		} as ReturnType<typeof useExtensionState>)
		vi.mocked(useProviderModels).mockReturnValue({
			models: {},
			defaultModelId: "",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})
		vi.mocked(useStaticProviderSelection).mockReturnValue({
			models: {
				"glm-5.2": liveModelInfo,
			},
			defaultModelId: "glm-5.2",
			selectedModelId: "glm-5.2",
			selectedModelInfo: {
				name: "GLM 5.2",
				supportsPromptCache: true,
			},
			hideUsageCost: false,
		})
		vi.mocked(useProviderConfig).mockReturnValue({
			config: {
				actSelection: {
					providerId: "zai",
					modelId: "glm-5.2",
					modelInfo: toProtobufModelInfo({
						name: "GLM 5.2",
						supportsPromptCache: true,
					}),
				},
			},
			write: vi.fn(async () => undefined),
			commitSelection: vi.fn(),
		})

		render(<ZAiProvider currentMode="act" showModelOptions={true} />)

		expect(screen.getByText("Reasoning Effort")).toBeInTheDocument()
	})
})
