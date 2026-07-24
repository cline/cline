import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useHasFeatureFlag } from "@/hooks/useFeatureFlag"
import { StateServiceClient } from "@/services/grpc-client"
import { ClinePassHint } from "../ClinePassHint"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

vi.mock("@/hooks/useFeatureFlag", () => ({
	useHasFeatureFlag: vi.fn(),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	StateServiceClient: {
		dismissBanner: vi.fn(() => Promise.resolve({})),
	},
}))

vi.mock("../utils/useApiConfigurationHandlers", () => ({
	useApiConfigurationHandlers: vi.fn(),
}))

const mockHandleFieldsChange = vi.fn(() => Promise.resolve())

const mockExtensionState = (overrides: Record<string, unknown> = {}) => {
	vi.mocked(useExtensionState).mockReturnValue({
		dismissedBanners: [],
		remoteConfigSettings: undefined,
		...overrides,
	} as any)
}

describe("ClinePassHint", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(useHasFeatureFlag).mockReturnValue(true)
		vi.mocked(useApiConfigurationHandlers).mockReturnValue({
			handleFieldsChange: mockHandleFieldsChange,
		} as any)
		mockExtensionState()
	})

	it("shows the hint for non-ClinePass providers", () => {
		render(<ClinePassHint selectedProvider="anthropic" />)
		expect(screen.getByTestId("cline-pass-settings-hint")).toBeInTheDocument()
	})

	it("selects the ClinePass provider when clicking Try it", () => {
		render(<ClinePassHint selectedProvider="anthropic" />)
		fireEvent.click(screen.getByText("Try it"))
		expect(mockHandleFieldsChange).toHaveBeenCalledWith({
			planModeApiProvider: "cline-pass",
			actModeApiProvider: "cline-pass",
		})
	})

	it("hides the hint when the feature flag is off", () => {
		vi.mocked(useHasFeatureFlag).mockReturnValue(false)
		render(<ClinePassHint selectedProvider="anthropic" />)
		expect(screen.queryByTestId("cline-pass-settings-hint")).not.toBeInTheDocument()
	})

	it("hides the hint when ClinePass is already selected", () => {
		render(<ClinePassHint selectedProvider="cline-pass" />)
		expect(screen.queryByTestId("cline-pass-settings-hint")).not.toBeInTheDocument()
	})

	it("hides the hint once dismissed and persists the dismissal", () => {
		render(<ClinePassHint selectedProvider="anthropic" />)
		fireEvent.click(screen.getByLabelText("Dismiss ClinePass hint"))
		expect(screen.queryByTestId("cline-pass-settings-hint")).not.toBeInTheDocument()
		expect(StateServiceClient.dismissBanner).toHaveBeenCalledWith({ value: "cline-pass-settings-hint-v1" })
	})

	it("stays hidden when a previous dismissal is in extension state", () => {
		mockExtensionState({ dismissedBanners: [{ bannerId: "cline-pass-settings-hint-v1", dismissedAt: 1 }] })
		render(<ClinePassHint selectedProvider="anthropic" />)
		expect(screen.queryByTestId("cline-pass-settings-hint")).not.toBeInTheDocument()
	})

	it("hides the hint when remote config excludes cline-pass", () => {
		mockExtensionState({ remoteConfigSettings: { remoteConfiguredProviders: ["anthropic"] } })
		render(<ClinePassHint selectedProvider="anthropic" />)
		expect(screen.queryByTestId("cline-pass-settings-hint")).not.toBeInTheDocument()
	})
})
