import { ClineMessage } from "@shared/ExtensionMessage"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { useMemo } from "react"
import { expect, userEvent, within } from "storybook/test"
import { createStorybookDecorator } from "@/config/StorybookDecorator"
import ErrorRow from "./ErrorRow"

// Mock data factories
const createMockMessage = (overrides: Partial<ClineMessage> = {}): ClineMessage => ({
	ts: Date.now(),
	type: "say",
	say: "error",
	text: "An error occurred while processing your request.",
	...overrides,
})

const createMockAuthState = (overrides: any = {}) => ({
	clineUser: null,
	activeOrganization: null,
	isAuthenticated: false,
	...overrides,
})

const createMockExtensionState = (overrides: any = {}) => ({
	version: "1.0.0",
	clineMessages: [],
	taskHistory: [],
	shouldShowAnnouncement: false,
	...overrides,
})

// Reusable decorators
const createStoryDecorator =
	(authOverrides: any = {}, extensionOverrides: any = {}) =>
	(Story: any) => {
		const mockExtensionState = useMemo(
			() => ({
				state: { ...createMockExtensionState(extensionOverrides) },
				auth: { ...createMockAuthState(authOverrides) },
			}),
			[],
		)

		return createStorybookDecorator(mockExtensionState.state, "p-4", mockExtensionState.auth)(Story)
	}

const meta: Meta<typeof ErrorRow> = {
	title: "Views/Components/ErrorRow",
	component: ErrorRow,
	parameters: {
		docs: {
			description: {
				component:
					"Displays different types of error messages in the chat interface, including API errors, credit limit errors, diff errors, and clineignore errors. Handles special error parsing for Cline provider errors and provides appropriate user actions.",
			},
		},
	},
	decorators: [createStoryDecorator()],
}

export default meta
type Story = StoryObj<typeof ErrorRow>

// Interactive plain text error story with configurable args and presets
export const Default: Story = {
	args: {
		message: createMockMessage({ text: "Something went wrong while executing the command." }),
		errorType: "error",
		apiRequestFailedMessage: undefined,
	},
	argTypes: {
		errorType: {
			control: { type: "select" },
			options: ["error", "mistake_limit_reached", "diff_error", "clineignore_error"],
			description: "Type of error to display",
		},
		message: {
			control: { type: "object" },
			description: "Message object containing error text and metadata",
		},
		apiRequestFailedMessage: {
			control: { type: "select" },
			options: [
				// Empty option for no error message
				"",
				// PowerShell error
				"PowerShell is not recognized as an internal or external command, operable program or batch file.",
				JSON.stringify({
					request_id: "has-request-id",
					message: "error message.",
					code: "random_code",
				}),
			],
		},
	},
	parameters: {
		docs: {
			description: {
				story: "Interactive story for testing different plain text error types and messages. Use the preset dropdown to quickly test common scenarios, or manually configure the error type and message object.",
			},
		},
	},
}

// API request errors
export const ApiRequestFailed: Story = {
	args: {
		message: createMockMessage(),
		errorType: "error",
		apiRequestFailedMessage:
			"Network error: Unable to connect to the API server. Please check your internet connection and try again.",
	},
}

export const ApiStreamingFailed: Story = {
	args: {
		message: createMockMessage(),
		errorType: "error",
		apiReqStreamingFailedMessage: "Streaming error: Connection was interrupted while receiving the response.",
	},
}

// Cline-specific errors
export const ClineBalanceError: Story = {
	args: {
		message: createMockMessage(),
		errorType: "error",
		apiRequestFailedMessage: JSON.stringify({
			message: "Insufficient credits to complete this request.",
			code: "insufficient_credits",
			request_id: "req_123456789",
			providerId: "cline",
			details: {
				current_balance: 0.5,
				total_spent: 25.75,
				total_promotions: 5.0,
				message: "You have run out of credits. Please purchase more to continue.",
				buy_credits_url: "https://app.example.bot/dashboard/account?tab=credits&redirect=true",
			},
		}),
	},
}

export const ClineRateLimitError: Story = {
	args: {
		message: createMockMessage(),
		errorType: "error",
		apiRequestFailedMessage: JSON.stringify({
			message: "Rate limit exceeded. Please wait before making another request.",
			request_id: "req_987654321",
			providerId: "cline",
		}),
	},
}

// Authentication-related errors with configurable scenarios
export const AuthenticationErrors: Story = {
	args: {
		message: createMockMessage(),
		errorType: "error",
		apiRequestFailedMessage: JSON.stringify({
			message: "Authentication failed. Please sign in to continue.",
			code: "ERR_BAD_REQUEST",
			request_id: "req_auth_123",
			providerId: "cline",
		}),
	},
	argTypes: {
		apiRequestFailedMessage: {
			control: { type: "text" },
			description: "JSON string containing error details",
		},
	},
	parameters: {
		docs: {
			description: {
				story: "Interactive story for testing authentication-related errors. Configure the error message JSON to test different auth scenarios including signed in/out states.",
			},
		},
	},
}

// Auth error when signed in (shows different UI)
export const AuthErrorSignedIn: Story = {
	...AuthenticationErrors,
	decorators: [
		createStoryDecorator({
			clineUser: { id: "user123", email: "user@example.com" },
			isAuthenticated: true,
		}),
	],
	args: {
		message: createMockMessage(),
		errorType: "error",
		apiRequestFailedMessage: JSON.stringify({
			message: "Authentication failed. Please retry your request.",
			request_id: "req_auth_456",
			providerId: "anthropic",
		}),
	},
}

// Interactive tests
export const InteractiveSignIn: Story = {
	args: {
		message: createMockMessage(),
		errorType: "error",
		apiRequestFailedMessage: JSON.stringify({
			message: "Please sign in to access Cline services.",
			code: "ERR_BAD_REQUEST",
			request_id: "req_signin_test",
			providerId: "cline",
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)

		// Find the sign in button
		const signInButton = canvas.getByRole("button", { name: /sign in to cline/i })
		await expect(signInButton).toBeInTheDocument()

		// Test button is clickable
		await expect(signInButton).toBeEnabled()

		// Click the button (this will trigger the mock handler)
		await userEvent.click(signInButton)
	},
}

export const TroubleshootingLink: Story = {
	args: {
		message: createMockMessage(),
		errorType: "error",
		apiRequestFailedMessage:
			"PowerShell is not recognized as an internal or external command. Please check your system configuration.",
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)

		// Find the troubleshooting link
		const troubleshootingLink = canvas.getByRole("link", { name: /troubleshooting guide/i })
		await expect(troubleshootingLink).toBeInTheDocument()

		// Verify link attributes
		await expect(troubleshootingLink).toHaveAttribute("href")
		await expect(troubleshootingLink).toHaveClass("underline")
	},
}

// Keep this one as it has specific testing logic for request ID
export const ErrorWithRequestId: Story = {
	args: {
		message: createMockMessage(),
		errorType: "error",
		apiRequestFailedMessage: JSON.stringify({
			message: "An unexpected error occurred while processing your request.",
			request_id: "req_detailed_123456",
			providerId: "cline",
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)

		// Verify error message is displayed
		const errorMessage = canvas.getByText(/an unexpected error occurred/i)
		await expect(errorMessage).toBeInTheDocument()

		// Verify request ID is displayed
		const requestId = canvas.getByText(/request id: req_detailed_123456/i)
		await expect(requestId).toBeInTheDocument()
	},
}
