import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import EntitlementError from "./EntitlementError"

const mockAuth: { clineUser: { appBaseUrl?: string } | null } = {
	clineUser: null,
}

vi.mock("@/context/ClineAuthContext", () => ({
	useClineAuth: () => mockAuth,
}))

const mockExtensionState: {
	apiConfiguration: Record<string, unknown>
	mode: "plan" | "act"
} = {
	apiConfiguration: {},
	mode: "act",
}

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockExtensionState,
}))

const mockClineModels: { models: Record<string, unknown> } = { models: {} }
vi.mock("@/hooks/useProviderModels", () => ({
	useProviderModels: () => mockClineModels,
}))

const handleModeFieldsChangeMock = vi.fn()
vi.mock("@/components/settings/utils/useApiConfigurationHandlers", () => ({
	useApiConfigurationHandlers: () => ({
		handleModeFieldsChange: (...args: unknown[]) => handleModeFieldsChangeMock(...args),
	}),
}))

const askResponseMock = vi.fn()
const commitModelSelectionMock = vi.fn()
vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		askResponse: (...args: unknown[]) => askResponseMock(...args),
	},
	ModelsServiceClient: {
		commitModelSelection: (...args: unknown[]) => commitModelSelectionMock(...args),
	},
}))

const getSubscribeHref = () => screen.getByRole("link", { name: /get clinepass/i }).getAttribute("href")
const querySubscribeLink = () => screen.queryByRole("link", { name: /get clinepass/i })
const querySwitchButton = () => screen.queryByText(/switch to usage-based billing/i)

function useClinePassSelection(modelId = "cline-pass/deepseek-v4-flash") {
	mockExtensionState.apiConfiguration = {
		actModeApiProvider: "cline-pass",
		actModeClinePassModelId: modelId,
	}
	mockClineModels.models = {
		"deepseek/deepseek-v4-flash": { name: "deepseek-v4-flash", contextWindow: 1_048_576 },
		"anthropic/claude-opus-4.6": { name: "claude-opus-4.6", contextWindow: 200_000 },
	}
}

describe("EntitlementError", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockAuth.clineUser = null
		mockExtensionState.apiConfiguration = {}
		mockExtensionState.mode = "act"
		mockClineModels.models = {}
		handleModeFieldsChangeMock.mockResolvedValue(undefined)
		commitModelSelectionMock.mockResolvedValue({})
	})

	it("shows friendly copy with the backend detail as muted support text", () => {
		render(<EntitlementError message="Error 403: the user is not subscribed to required model plan" />)
		expect(screen.getByText("This model requires a ClinePass subscription.")).toBeInTheDocument()
		expect(screen.getByText("Error 403: the user is not subscribed to required model plan")).toBeInTheDocument()
	})

	it("omits the subscribe link when no usable app base URL is available", () => {
		render(<EntitlementError />)
		expect(querySubscribeLink()).toBeNull()

		mockAuth.clineUser = {}
		render(<EntitlementError />)
		expect(querySubscribeLink()).toBeNull()

		mockAuth.clineUser = { appBaseUrl: "not a valid url" }
		render(<EntitlementError />)
		expect(querySubscribeLink()).toBeNull()
	})

	it("builds the subscribe link from the authenticated user's app base URL", () => {
		mockAuth.clineUser = { appBaseUrl: "https://staging-app.cline.bot" }
		const { unmount } = render(<EntitlementError />)
		expect(getSubscribeHref()).toBe("https://staging-app.cline.bot/dashboard/subscription?personal=true")
		unmount()

		mockAuth.clineUser = {
			appBaseUrl: "https://proxy.enterprise.com/cline/app",
		}
		render(<EntitlementError />)
		expect(getSubscribeHref()).toBe("https://proxy.enterprise.com/cline/app/dashboard/subscription?personal=true")
	})

	it("sends a yesButtonClicked askResponse when Retry Request is clicked", () => {
		render(<EntitlementError />)
		// VSCodeButton has no ARIA role in jsdom; click by label text instead.
		fireEvent.click(screen.getByText("Retry Request"))
		expect(askResponseMock).toHaveBeenCalledTimes(1)
		expect(askResponseMock.mock.calls[0][0]).toMatchObject({
			responseType: "yesButtonClicked",
		})
	})

	it("offers the usage-billed counterpart of the selected ClinePass model", () => {
		useClinePassSelection()
		render(<EntitlementError />)
		expect(
			screen.getByText(
				"Usage-based billing runs this model as deepseek/deepseek-v4-flash, charged to your Cline account balance.",
			),
		).toBeInTheDocument()
		expect(querySwitchButton()).not.toBeNull()
	})

	it("switches the provider and model to usage-based billing", async () => {
		useClinePassSelection()
		render(<EntitlementError />)

		fireEvent.click(screen.getByText("Switch to Usage-Based billing"))

		await waitFor(() => expect(handleModeFieldsChangeMock).toHaveBeenCalledTimes(1))
		expect(commitModelSelectionMock.mock.calls[0][0]).toMatchObject({
			providerId: "cline",
			mode: "act",
			modelId: "deepseek/deepseek-v4-flash",
		})
		expect(handleModeFieldsChangeMock.mock.calls[0][1]).toMatchObject({
			apiProvider: "cline",
			clineModelId: "deepseek/deepseek-v4-flash",
		})
		expect(handleModeFieldsChangeMock.mock.calls[0][2]).toBe("act")
		await screen.findByText("Switched to Usage-Based billing")
	})

	it("hides the switch action when the catalog has no usage-billed counterpart", () => {
		mockExtensionState.apiConfiguration = {
			actModeApiProvider: "cline-pass",
			actModeClinePassModelId: "cline-pass/some-unlisted-model",
		}
		mockClineModels.models = { "deepseek/deepseek-v4-flash": { name: "deepseek-v4-flash" } }
		render(<EntitlementError />)
		expect(querySwitchButton()).toBeNull()
	})

	it("hides the switch action when the selected provider is not cline-pass", () => {
		mockExtensionState.apiConfiguration = {
			actModeApiProvider: "cline",
			actModeClineModelId: "deepseek/deepseek-v4-flash",
		}
		mockClineModels.models = { "deepseek/deepseek-v4-flash": { name: "deepseek-v4-flash" } }
		render(<EntitlementError />)
		expect(querySwitchButton()).toBeNull()
	})
})
