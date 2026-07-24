import type { ClineMessage } from "@shared/ExtensionMessage"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import ErrorRow from "./ErrorRow"

const mockSetUserOrganization = vi.hoisted(() => vi.fn())
const mockUpdateApiConfigurationProto = vi.hoisted(() => vi.fn())
const mockApiConfiguration = vi.hoisted(() => ({
	planModeApiProvider: "cline-pass",
	actModeApiProvider: "cline-pass",
	planModeClinePassModelId: "cline-pass/test-plan-model",
	actModeClinePassModelId: "cline-pass/test-act-model",
}))

// Mock the auth context
vi.mock("@/context/ClineAuthContext", () => ({
	useClineAuth: () => ({
		clineUser: null,
	}),
	useClineSignIn: () => ({
		isLoginLoading: false,
	}),
	handleSignOut: vi.fn(),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		apiConfiguration: mockApiConfiguration,
	}),
}))

// Mock CreditLimitError component
vi.mock("@/components/chat/CreditLimitError", () => ({
	default: ({ message }: { message: string }) => <div data-testid="credit-limit-error">{message}</div>,
}))

// Mock EntitlementError component
vi.mock("@/components/chat/EntitlementError", () => ({
	default: ({ message }: { message: string }) => <div data-testid="entitlement-error">{message}</div>,
}))

vi.mock("@/services/grpc-client", () => ({
	AccountServiceClient: {
		setUserOrganization: mockSetUserOrganization,
	},
	ModelsServiceClient: {
		updateApiConfigurationProto: mockUpdateApiConfigurationProto,
	},
}))

// Mock ClineError
vi.mock("../../../../src/services/error/ClineError", () => ({
	ClineError: {
		parse: vi.fn(),
	},
	ClineErrorType: {
		Balance: "balance",
		RateLimit: "rateLimit",
		Auth: "auth",
		Entitlement: "entitlement",
		OrgClinePassRestriction: "orgClinePassRestriction",
		ClinePassLimit: "clinePassLimit",
		QuotaExceeded: "quotaExceeded",
	},
}))

describe("ErrorRow", () => {
	const mockMessage: ClineMessage = {
		ts: 123456789,
		type: "say",
		say: "error",
		text: "Test error message",
	}

	beforeEach(() => {
		vi.clearAllMocks()
		mockSetUserOrganization.mockResolvedValue({})
		mockUpdateApiConfigurationProto.mockResolvedValue({})
	})

	it("renders basic error message", () => {
		render(<ErrorRow errorType="error" message={mockMessage} />)

		expect(screen.getByText("Test error message")).toBeInTheDocument()
	})

	it("renders mistake limit reached error", () => {
		const mistakeMessage = { ...mockMessage, text: "Mistake limit reached" }
		render(<ErrorRow errorType="mistake_limit_reached" message={mistakeMessage} />)

		expect(screen.getByText("Mistake limit reached")).toBeInTheDocument()
	})

	it("renders diff error", () => {
		render(<ErrorRow errorType="diff_error" message={mockMessage} />)

		expect(
			screen.getByText("The model used search patterns that don't match anything in the file. Retrying..."),
		).toBeInTheDocument()
	})

	it("renders clineignore error", () => {
		const clineignoreMessage = { ...mockMessage, text: "/path/to/file.txt" }
		render(<ErrorRow errorType="clineignore_error" message={clineignoreMessage} />)

		expect(screen.getByText(/Cline tried to access/)).toBeInTheDocument()
		expect(screen.getByText("/path/to/file.txt")).toBeInTheDocument()
	})

	describe("API error handling", () => {
		it("renders credit limit error when balance error is detected", async () => {
			const mockClineError = {
				message: "Insufficient credits",
				isErrorType: vi.fn((type) => type === "balance"),
				_error: {
					details: {
						current_balance: 0,
						total_spent: 10.5,
						total_promotions: 5.0,
						message: "You have run out of credits.",
						buy_credits_url: "https://app.cline.bot/dashboard",
					},
				},
			}

			const { ClineError } = await import("../../../../src/services/error/ClineError")
			vi.mocked(ClineError.parse).mockReturnValue(mockClineError as any)

			render(<ErrorRow apiRequestFailedMessage="Insufficient credits error" errorType="error" message={mockMessage} />)

			expect(screen.getByTestId("credit-limit-error")).toBeInTheDocument()
			expect(screen.getByText("You have run out of credits.")).toBeInTheDocument()
		})

		it("does not show Cline credits CTA for non-Cline balance errors without a provider URL", async () => {
			const mockClineError = {
				message: "Not enough credits available",
				providerId: "zai",
				isErrorType: vi.fn((type) => type === "balance"),
				_error: {
					code: "insufficient_credits",
					providerId: "zai",
					details: {
						current_balance: 0,
						message: "Not enough credits available",
					},
				},
			}

			const { ClineError } = await import("../../../../src/services/error/ClineError")
			vi.mocked(ClineError.parse).mockReturnValue(mockClineError as any)

			render(<ErrorRow apiRequestFailedMessage="Insufficient credits error" errorType="error" message={mockMessage} />)

			expect(screen.queryByTestId("credit-limit-error")).not.toBeInTheDocument()
			expect(screen.getByText(/\[zai\]/)).toBeInTheDocument()
		})

		it("renders rate limit error with request ID", async () => {
			const mockClineError = {
				message: "Rate limit exceeded",
				isErrorType: vi.fn((type) => type === "rateLimit"),
				_error: {
					request_id: "req_123456",
				},
			}

			const { ClineError } = await import("../../../../src/services/error/ClineError")
			vi.mocked(ClineError.parse).mockReturnValue(mockClineError as any)

			render(<ErrorRow apiRequestFailedMessage="Rate limit exceeded" errorType="error" message={mockMessage} />)

			expect(screen.getByText("Rate limit exceeded")).toBeInTheDocument()
			expect(screen.getByText("Request ID: req_123456")).toBeInTheDocument()
		})

		it("renders quota exceeded error", async () => {
			const mockClineError = {
				message: "Inference cap reached",
				isErrorType: vi.fn((type) => type === "quotaexceeded"),
			}

			const { ClineError } = await import("../../../../src/services/error/ClineError")
			vi.mocked(ClineError.parse).mockReturnValue(mockClineError as any)

			render(<ErrorRow apiRequestFailedMessage="The message" errorType="error" message="" />)
			expect(screen.getByText("Inference cap reached")).toBeInTheDocument()
		})

		it("renders entitlement error when ClineError detects ClineNotSubscribedError", async () => {
			const cliMessage =
				"No access to ClinePass subscription models yet. Subscribe to ClinePass, the low cost open weights model coding plan: https://app.cline.bot/promo?code=CLI-8OFF&personal=true"
			const mockClineError = {
				message: cliMessage,
				isErrorType: vi.fn((type) => type === "entitlement"),
				providerId: "cline-pass",
				_error: {
					message: cliMessage,
				},
			}

			const { ClineError } = await import("../../../../src/services/error/ClineError")
			vi.mocked(ClineError.parse).mockReturnValue(mockClineError as any)

			render(<ErrorRow apiRequestFailedMessage={cliMessage} errorType="error" message={mockMessage} />)

			expect(screen.getByTestId("entitlement-error")).toBeInTheDocument()
			expect(screen.getByText(cliMessage)).toBeInTheDocument()
			expect(screen.queryByText(/\[cline-pass\]/i)).not.toBeInTheDocument()
		})

		it("renders entitlement error when ClineError detects a raw required-plan message", async () => {
			const rawMessage = "403 Error 403: the user is not subscribed to required model plan"
			const mockClineError = {
				message: rawMessage,
				isErrorType: vi.fn((type) => type === "entitlement"),
				providerId: "cline-pass",
				_error: {
					message: rawMessage,
				},
			}

			const { ClineError } = await import("../../../../src/services/error/ClineError")
			vi.mocked(ClineError.parse).mockReturnValue(mockClineError as any)

			render(<ErrorRow apiRequestFailedMessage={rawMessage} errorType="error" message={mockMessage} />)

			expect(screen.getByTestId("entitlement-error")).toBeInTheDocument()
			expect(screen.getByText(rawMessage)).toBeInTheDocument()
		})

		it("renders organization account ClinePass restriction with friendly account switching copy", async () => {
			const rawMessage = "403 Error 403: organization accounts cannot use individual model inference subscriptions"
			const mockClineError = {
				message: rawMessage,
				isErrorType: vi.fn((type) => type === "orgClinePassRestriction"),
				providerId: "cline",
				_error: {
					message: rawMessage,
				},
			}

			const { ClineError } = await import("../../../../src/services/error/ClineError")
			vi.mocked(ClineError.parse).mockReturnValue(mockClineError as any)

			render(<ErrorRow apiRequestFailedMessage={rawMessage} errorType="error" message={mockMessage} />)

			expect(screen.getByTestId("org-cline-pass-restriction-error")).toBeInTheDocument()
			expect(screen.getByText(/Organization accounts cannot use ClinePass subscriptions/)).toBeInTheDocument()
			expect(screen.queryByText(rawMessage)).not.toBeInTheDocument()

			fireEvent.click(screen.getByText("Switch to personal account"))

			await waitFor(() => expect(mockSetUserOrganization).toHaveBeenCalledWith({}))
			expect(screen.getByText("Switched to personal account")).toBeInTheDocument()
		})

		it("renders organization ClinePass restriction when ClineError detects the SDK formatted message", async () => {
			const formattedMessage =
				"Organization accounts cannot use ClinePass subscriptions. Go to /account -> change account to switch to your personal account for ClinePass"
			const mockClineError = {
				message: formattedMessage,
				isErrorType: vi.fn((type) => type === "orgClinePassRestriction"),
				providerId: "cline-pass",
				_error: {
					message: formattedMessage,
				},
			}

			const { ClineError } = await import("../../../../src/services/error/ClineError")
			vi.mocked(ClineError.parse).mockReturnValue(mockClineError as any)

			render(<ErrorRow apiRequestFailedMessage={formattedMessage} errorType="error" message={mockMessage} />)

			expect(screen.getByTestId("org-cline-pass-restriction-error")).toBeInTheDocument()
			expect(screen.queryByText(formattedMessage)).not.toBeInTheDocument()
		})

		it("renders ClinePass limit error and switches to Cline usage-based billing", async () => {
			const limitMessage = "You have reached your weekly Clinepass limit. The limit resets in 7d, please try again later."
			const mockClineError = {
				message: limitMessage,
				isErrorType: vi.fn((type) => type === "clinePassLimit"),
				providerId: "cline-pass",
				_error: {
					message: limitMessage,
				},
			}

			const { ClineError } = await import("../../../../src/services/error/ClineError")
			vi.mocked(ClineError.parse).mockReturnValue(mockClineError as any)

			render(<ErrorRow apiRequestFailedMessage={limitMessage} errorType="error" message={mockMessage} />)

			expect(screen.getByTestId("cline-pass-limit-error")).toBeInTheDocument()
			expect(screen.getByText(limitMessage)).toBeInTheDocument()

			fireEvent.click(screen.getByText("Switch to Usage-Based billing"))

			await waitFor(() => expect(mockUpdateApiConfigurationProto).toHaveBeenCalledTimes(1))
			const request = mockUpdateApiConfigurationProto.mock.calls[0][0]
			expect(request.apiConfiguration.planModeApiProvider).toBe("cline")
			expect(request.apiConfiguration.actModeApiProvider).toBe("cline")
			expect(request.apiConfiguration.planModeClineModelId).toBeUndefined()
			expect(request.apiConfiguration.actModeClineModelId).toBeUndefined()
			expect(screen.getByText("Switched to Usage-Based billing")).toBeInTheDocument()
		})

		it("renders friendly logged-out message and sign in button when user is not signed in", async () => {
			const mockClineError = {
				message: "Authentication failed",
				isErrorType: vi.fn((type) => type === "auth"),
				providerId: "cline",
				_error: {},
			}

			const { ClineError } = await import("../../../../src/services/error/ClineError")
			vi.mocked(ClineError.parse).mockReturnValue(mockClineError as any)

			render(<ErrorRow apiRequestFailedMessage="Authentication failed" errorType="error" message={mockMessage} />)

			expect(screen.queryByText("Authentication failed")).not.toBeInTheDocument()
			expect(screen.getByText(/Whoops looks like you're logged out/)).toBeInTheDocument()
			expect(screen.getByText("Sign in to Cline")).toBeInTheDocument()
		})

		it("renders PowerShell troubleshooting link when error mentions PowerShell", async () => {
			const mockClineError = {
				message: "PowerShell is not recognized as an internal or external command",
				isErrorType: vi.fn(() => false),
				_error: {},
			}

			const { ClineError } = await import("../../../../src/services/error/ClineError")
			vi.mocked(ClineError.parse).mockReturnValue(mockClineError as any)

			render(
				<ErrorRow
					apiRequestFailedMessage="PowerShell is not recognized as an internal or external command"
					errorType="error"
					message={mockMessage}
				/>,
			)

			expect(screen.getByText(/PowerShell is not recognized/)).toBeInTheDocument()
			expect(screen.getByText("troubleshooting guide")).toBeInTheDocument()
			expect(screen.getByRole("link", { name: "troubleshooting guide" })).toHaveAttribute(
				"href",
				"https://github.com/cline/cline/wiki/TroubleShooting-%E2%80%90-%22PowerShell-is-not-recognized-as-an-internal-or-external-command%22",
			)
		})

		it("handles apiReqStreamingFailedMessage instead of apiRequestFailedMessage", async () => {
			const mockClineError = {
				message: "Streaming failed",
				isErrorType: vi.fn(() => false),
				_error: {},
			}

			const { ClineError } = await import("../../../../src/services/error/ClineError")
			vi.mocked(ClineError.parse).mockReturnValue(mockClineError as any)

			render(<ErrorRow apiReqStreamingFailedMessage="Streaming failed" errorType="error" message={mockMessage} />)

			expect(screen.getByText("Streaming failed")).toBeInTheDocument()
		})

		it("falls back to regular error message when ClineError.parse returns null", async () => {
			const { ClineError } = await import("../../../../src/services/error/ClineError")
			vi.mocked(ClineError.parse).mockReturnValue(undefined)

			render(<ErrorRow apiRequestFailedMessage="Some API error" errorType="error" message={mockMessage} />)

			// When ClineError.parse returns null, we display the raw error message for non-Cline providers
			// Since clineError is undefined, isClineUsageBillingProvider is false, so we show the raw apiRequestFailedMessage
			expect(screen.getByText("Some API error")).toBeInTheDocument()
		})

		it("renders regular error message when no API error messages are provided", () => {
			render(<ErrorRow errorType="error" message={mockMessage} />)

			expect(screen.getByText("Test error message")).toBeInTheDocument()
		})
	})
})
