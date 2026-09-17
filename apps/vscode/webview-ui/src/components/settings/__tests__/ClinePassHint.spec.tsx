import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useClinePassPromo } from "@/hooks/useClinePassPromo"
import { StateServiceClient } from "@/services/grpc-client"
import { clearSessionBannerDismissalsForTesting } from "@/utils/sessionBannerDismissals"
import { ClinePassHint } from "../ClinePassHint"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

vi.mock("@/hooks/useClinePassPromo", async (importOriginal) => {
	const actual = await importOriginal()
	return {
		...(actual as Record<string, unknown>),
		useClinePassPromo: vi.fn(),
	}
})

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

const mockHandleModeFieldChange = vi.fn(() => Promise.resolve())

const mockExtensionState = (overrides: Record<string, unknown> = {}) => {
	vi.mocked(useExtensionState).mockReturnValue({
		dismissedBanners: [],
		...overrides,
	} as any)
}

const mockPromo = (overrides: Partial<ReturnType<typeof useClinePassPromo>> = {}) => {
	vi.mocked(useClinePassPromo).mockReturnValue({
		isClinePassEnabled: true,
		...overrides,
	} as any)
}

describe("ClinePassHint", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		clearSessionBannerDismissalsForTesting()
		mockPromo()
		vi.mocked(useApiConfigurationHandlers).mockReturnValue({
			handleModeFieldChange: mockHandleModeFieldChange,
		} as any)
		mockExtensionState()
	})

	it("shows the hint for non-ClinePass providers", () => {
		render(<ClinePassHint currentMode="plan" selectedProvider="anthropic" />)
		expect(screen.getByTestId("cline-pass-settings-hint")).toBeInTheDocument()
	})

	it("selects the ClinePass provider for the current mode when clicking Try it", () => {
		render(<ClinePassHint currentMode="plan" selectedProvider="anthropic" />)
		fireEvent.click(screen.getByText("Try it"))
		expect(mockHandleModeFieldChange).toHaveBeenCalledWith(
			{ plan: "planModeApiProvider", act: "actModeApiProvider" },
			"cline-pass",
			"plan",
		)
	})

	it("hides the hint when ClinePass promotions are disabled (self-hosted or org allowlist)", () => {
		mockPromo({ isClinePassEnabled: false })
		render(<ClinePassHint currentMode="plan" selectedProvider="anthropic" />)
		expect(screen.queryByTestId("cline-pass-settings-hint")).not.toBeInTheDocument()
	})

	it("hides the hint when ClinePass is already selected", () => {
		render(<ClinePassHint currentMode="plan" selectedProvider="cline-pass" />)
		expect(screen.queryByTestId("cline-pass-settings-hint")).not.toBeInTheDocument()
	})

	it("hides the hint once dismissed and persists the dismissal", () => {
		render(<ClinePassHint currentMode="plan" selectedProvider="anthropic" />)
		fireEvent.click(screen.getByLabelText("Dismiss ClinePass hint"))
		expect(screen.queryByTestId("cline-pass-settings-hint")).not.toBeInTheDocument()
		expect(StateServiceClient.dismissBanner).toHaveBeenCalledWith({ value: "cline-pass-settings-hint-v1" })
	})

	it("stays hidden after a remount within the same session", () => {
		const { unmount } = render(<ClinePassHint currentMode="plan" selectedProvider="anthropic" />)
		fireEvent.click(screen.getByLabelText("Dismiss ClinePass hint"))
		unmount()
		// Remount before the persisted dismissal has synced back from the host
		render(<ClinePassHint currentMode="plan" selectedProvider="anthropic" />)
		expect(screen.queryByTestId("cline-pass-settings-hint")).not.toBeInTheDocument()
	})

	it("stays hidden when a previous dismissal is in extension state", () => {
		mockExtensionState({ dismissedBanners: [{ bannerId: "cline-pass-settings-hint-v1", dismissedAt: 1 }] })
		render(<ClinePassHint currentMode="plan" selectedProvider="anthropic" />)
		expect(screen.queryByTestId("cline-pass-settings-hint")).not.toBeInTheDocument()
	})
})
