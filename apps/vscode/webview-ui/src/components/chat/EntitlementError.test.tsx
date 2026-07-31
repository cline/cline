import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import EntitlementError from "./EntitlementError"

const mockAuth: { clineUser: { appBaseUrl?: string } | null } = {
	clineUser: null,
}

const mockApiConfiguration: Record<string, unknown> = {}
const mockClineModels: { models: Record<string, { name?: string }> } = { models: {} }

vi.mock("@/context/ClineAuthContext", () => ({
	useClineAuth: () => mockAuth,
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		apiConfiguration: mockApiConfiguration,
		mode: "act",
	}),
}))

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
const querySwitchButton = () => screen.queryByText("Switch to Usage-Based billing")

function useClinePassSelection() {
	mockApiConfiguration.actModeApiProvider = "cline-pass"
	mockApiConfiguration.actModeClinePassModelId = "cline-pass/deepseek-v4-flash"
	mockClineModels.models = {
		"deepseek/deepseek-v4-flash": { name: "DeepSeek V4 Flash" },
		"anthropic/claude-opus-5": { name: "Claude Opus 5" },
	}
}

describe("EntitlementError", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockAuth.clineUser = null
		for (const key of Object.keys(mockApiConfiguration)) {
			delete mockApiConfiguration[key]
		}
		mockClineModels.models = {}
		commitModelSelectionMock.mockResolvedValue({})
		handleModeFieldsChangeMock.mockResolvedValue(undefined)
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

	it("offers the usage-billed twin of the subscription-gated model", () => {
		useClinePassSelection()
		render(<EntitlementError />)

		expect(screen.getByText(/deepseek\/deepseek-v4-flash is billed per token/)).toBeInTheDocument()
		expect(querySwitchButton()).toBeInTheDocument()
	})

	it("switches the provider and model to Cline usage-based billing", async () => {
		useClinePassSelection()
		render(<EntitlementError />)

		fireEvent.click(screen.getByText("Switch to Usage-Based billing"))

		await waitFor(() => expect(commitModelSelectionMock).toHaveBeenCalledTimes(1))
		expect(commitModelSelectionMock.mock.calls[0][0]).toMatchObject({
			providerId: "cline",
			mode: "act",
			modelId: "deepseek/deepseek-v4-flash",
		})

		await waitFor(() => expect(handleModeFieldsChangeMock).toHaveBeenCalledTimes(1))
		expect(handleModeFieldsChangeMock.mock.calls[0][1]).toMatchObject({
			apiProvider: "cline",
			clineModelId: "deepseek/deepseek-v4-flash",
		})
		expect(handleModeFieldsChangeMock.mock.calls[0][2]).toBe("act")

		expect(await screen.findByText("Switched to Usage-Based billing")).toBeInTheDocument()
	})

	// Committing the switch rewrites the config the target is derived from, so
	// the confirmation has to survive the selection no longer being gated.
	it("keeps the confirmation visible after the committed config stops being ClinePass", async () => {
		useClinePassSelection()
		handleModeFieldsChangeMock.mockImplementation(async () => {
			mockApiConfiguration.actModeApiProvider = "cline"
			mockApiConfiguration.actModeClineModelId = "deepseek/deepseek-v4-flash"
			delete mockApiConfiguration.actModeClinePassModelId
		})

		render(<EntitlementError />)
		fireEvent.click(screen.getByText("Switch to Usage-Based billing"))

		expect(await screen.findByText("Switched to Usage-Based billing")).toBeInTheDocument()
		expect(screen.getByText("Retry the request after switching.")).toBeInTheDocument()
	})

	it("hides the switch action when the catalog has no usage-billed twin", () => {
		mockApiConfiguration.actModeApiProvider = "cline-pass"
		mockApiConfiguration.actModeClinePassModelId = "cline-pass/subscription-only-model"
		mockClineModels.models = { "deepseek/deepseek-v4-flash": {} }

		render(<EntitlementError />)

		expect(querySwitchButton()).toBeNull()
		expect(screen.getByText("Subscribe to ClinePass to use this model, then retry your request.")).toBeInTheDocument()
	})
})
