import type { Meta, StoryObj } from "@storybook/react-vite"
import React from "react"
import CreditLimitError from "./CreditLimitError"
import { StorybookProvider } from "../common/StorybookDecorator"

const meta: Meta<typeof CreditLimitError> = {
	title: "Component/CreditLimitError",
	component: CreditLimitError,
	parameters: {
		layout: "padded",
		docs: {
			description: {
				component: `
The CreditLimitError component displays credit limit information and provides actions for users who have exhausted their credits.

**Features:**
- **Balance Display**: Shows current balance converted from microcredits to dollars with 4 decimal precision
- **Credit Purchase**: Direct link to buy more credits via external URL
- **Retry Functionality**: Allows users to retry their request after potentially purchasing credits
- **Customizable Messaging**: Supports custom error messages for different scenarios
- **gRPC Integration**: Uses TaskServiceClient to handle retry requests through the extension backend

**Use Cases:**
- Displaying credit exhaustion errors during API requests
- Providing clear path to credit purchase
- Allowing immediate retry after credit purchase
- Showing current balance for user awareness

**Technical Details:**
- Balance is stored in microcredits (1 credit = 1,000,000 microcredits)
- Integrates with Cline's task system via gRPC for retry handling
- Uses VSCode UI toolkit components for consistent styling
- Supports external link navigation for credit purchases

**Props:**
- \`currentBalance\`: Current balance in microcredits
- \`totalSpent\`: Total amount spent (optional, for future use)
- \`totalPromotions\`: Total promotional credits (optional, for future use)
- \`message\`: Custom error message to display
- \`buyCreditsUrl\`: URL for credit purchase page
        `,
			},
		},
	},
	decorators: [
		(Story) => {
			return (
				<StorybookProvider>
					<Story />
				</StorybookProvider>
			)
		},
	],
	argTypes: {
		currentBalance: {
			control: { type: "number", min: 0, max: 10000000, step: 100000 },
			description: "Current balance in microcredits (1 credit = 1,000,000 microcredits)",
		},
		totalSpent: {
			control: { type: "number", min: 0, max: 100000000, step: 1000000 },
			description: "Total amount spent in microcredits (optional, for future use)",
		},
		totalPromotions: {
			control: { type: "number", min: 0, max: 10000000, step: 100000 },
			description: "Total promotional credits in microcredits (optional, for future use)",
		},
		message: {
			control: "text",
			description: "Custom error message to display to the user",
		},
		buyCreditsUrl: {
			control: "text",
			description: "URL for the credit purchase page",
		},
	},
}

export default meta
type Story = StoryObj<typeof CreditLimitError>

// Default credit limit error
export const Default: Story = {
	args: {
		currentBalance: 0,
		message: "You have run out of credit.",
		buyCreditsUrl: "https://app.cline.bot/dashboard",
	},
	parameters: {
		docs: {
			description: {
				story: "Default credit limit error with zero balance and standard message.",
			},
		},
	},
}

// With usage statistics
export const WithUsageStats: Story = {
	args: {
		currentBalance: 500000, // $0.5000
		totalSpent: 15000000, // $15.0000
		totalPromotions: 2000000, // $2.0000
		message: "Your current request would exceed your remaining credit balance.",
		buyCreditsUrl: "https://app.cline.bot/dashboard",
	},
	parameters: {
		docs: {
			description: {
				story: "Component showing usage statistics including total spent and promotional credits (for future implementation).",
			},
		},
	},
}

// Fractional balance
export const FractionalBalance: Story = {
	args: {
		currentBalance: 123456, // $0.1235 (rounded to 4 decimals)
		message: "You have a small amount of credit remaining.",
		buyCreditsUrl: "https://app.cline.bot/dashboard",
	},
	parameters: {
		docs: {
			description: {
				story: "Component with fractional balance demonstrating precise decimal formatting.",
			},
		},
	},
}

// Interactive demo
export const InteractiveDemo: Story = {
	args: {
		currentBalance: 0,
		message: "You have run out of credit.",
		buyCreditsUrl: "https://app.cline.bot/dashboard",
	},
	decorators: [
		(Story) => {
			const [retryCount, setRetryCount] = React.useState(0)
			const [lastAction, setLastAction] = React.useState<string>("")

			// Mock the TaskServiceClient for demo purposes
			React.useEffect(() => {
				const originalConsoleLog = console.log
				console.log = (...args) => {
					if (args[0]?.includes?.("TaskServiceClient")) {
						setLastAction("Retry request sent to extension")
						setRetryCount((prev) => prev + 1)
					}
					originalConsoleLog(...args)
				}

				return () => {
					console.log = originalConsoleLog
				}
			}, [])

			return (
				<StorybookProvider>
					<div className="max-w-md space-y-4">
						<Story />
						{(retryCount > 0 || lastAction) && (
							<div className="p-3 bg-[var(--vscode-textBlockQuote-background)] rounded border text-sm">
								<div className="font-semibold mb-1">Demo Actions:</div>
								{retryCount > 0 && <div>Retry attempts: {retryCount}</div>}
								{lastAction && <div>Last action: {lastAction}</div>}
							</div>
						)}
					</div>
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "Interactive demo showing retry functionality with action tracking for demonstration purposes.",
			},
		},
	},
}

// Long message handling
export const LongMessage: Story = {
	args: {
		currentBalance: 0,
		message:
			"You have exceeded your credit limit for this billing period. This can happen when making many API requests or using advanced AI models that consume more credits per request. To continue using Cline's AI-powered features, please purchase additional credits from your dashboard. Your current usage will be preserved and you can resume immediately after adding credits to your account.",
		buyCreditsUrl: "https://app.cline.bot/dashboard",
	},
	parameters: {
		docs: {
			description: {
				story: "Component handling long error messages, demonstrating text wrapping and layout behavior.",
			},
		},
	},
}

// Compact layout
export const CompactLayout: Story = {
	args: {
		currentBalance: 1000000, // $1.0000
		message: "Low credits",
		buyCreditsUrl: "https://app.cline.bot/dashboard",
	},
	decorators: [
		(Story) => {
			return (
				<StorybookProvider>
					<Story />
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "Component in a compact layout with shorter message, suitable for narrow interfaces.",
			},
		},
	},
}
