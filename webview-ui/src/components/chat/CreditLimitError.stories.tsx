import type { Meta, StoryObj } from "@storybook/react-vite"
import React from "react"
import CreditLimitError from "./CreditLimitError"
import { ExtensionStateProviderMock, ExtensionStateMock } from "@/context/ExtensionStateContext"

const meta: Meta<typeof CreditLimitError> = {
	title: "Chat/CreditLimitError",
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
				<ExtensionStateProviderMock value={ExtensionStateMock}>
					<div className="max-w-md">
						<Story />
					</div>
				</ExtensionStateProviderMock>
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

// Low balance warning
export const LowBalance: Story = {
	args: {
		currentBalance: 250000, // $0.2500
		message: "Your credit balance is running low.",
		buyCreditsUrl: "https://app.cline.bot/dashboard",
	},
	parameters: {
		docs: {
			description: {
				story: "Credit warning with low but non-zero balance, encouraging users to top up.",
			},
		},
	},
}

// Moderate balance
export const ModerateBalance: Story = {
	args: {
		currentBalance: 2500000, // $2.5000
		message: "You have sufficient credits remaining.",
		buyCreditsUrl: "https://app.cline.bot/dashboard",
	},
	parameters: {
		docs: {
			description: {
				story: "Display with moderate balance showing the component can be used for balance information.",
			},
		},
	},
}

// High balance
export const HighBalance: Story = {
	args: {
		currentBalance: 25000000, // $25.0000
		message: "You have plenty of credits available.",
		buyCreditsUrl: "https://app.cline.bot/dashboard",
	},
	parameters: {
		docs: {
			description: {
				story: "High balance scenario demonstrating the component with substantial credits.",
			},
		},
	},
}

// Custom error message
export const CustomMessage: Story = {
	args: {
		currentBalance: 0,
		message:
			"API request failed due to insufficient credits. Please purchase more credits to continue using Cline's AI features.",
		buyCreditsUrl: "https://app.cline.bot/dashboard",
	},
	parameters: {
		docs: {
			description: {
				story: "Custom error message providing more detailed information about the credit limitation.",
			},
		},
	},
}

// Different purchase URL
export const CustomPurchaseUrl: Story = {
	args: {
		currentBalance: 0,
		message: "You have run out of credit.",
		buyCreditsUrl: "https://billing.example.com/credits",
	},
	parameters: {
		docs: {
			description: {
				story: "Component with a custom credit purchase URL for different billing systems.",
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

// Emergency state
export const EmergencyState: Story = {
	args: {
		currentBalance: 0,
		message: "⚠️ Critical: All credits have been exhausted. Immediate action required to continue service.",
		buyCreditsUrl: "https://app.cline.bot/dashboard?urgent=true",
	},
	parameters: {
		docs: {
			description: {
				story: "Emergency state with urgent messaging and modified purchase URL with query parameters.",
			},
		},
	},
}

// Minimal props
export const MinimalProps: Story = {
	args: {
		currentBalance: 0,
	},
	parameters: {
		docs: {
			description: {
				story: "Component with only required props, using all default values for optional parameters.",
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
				<ExtensionStateProviderMock value={ExtensionStateMock}>
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
				</ExtensionStateProviderMock>
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

// Dark theme variant
export const DarkTheme: Story = {
	args: {
		currentBalance: 750000, // $0.7500
		message: "Credit balance is getting low. Consider purchasing more credits soon.",
		buyCreditsUrl: "https://app.cline.bot/dashboard",
	},
	decorators: [
		(Story) => {
			return (
				<ExtensionStateProviderMock value={ExtensionStateMock}>
					<div
						className="max-w-md p-4 rounded"
						style={{
							backgroundColor: "var(--vscode-editor-background)",
							color: "var(--vscode-editor-foreground)",
						}}>
						<Story />
					</div>
				</ExtensionStateProviderMock>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "Component styled for dark theme environments, demonstrating theme compatibility.",
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
				<ExtensionStateProviderMock value={ExtensionStateMock}>
					<div className="max-w-xs">
						<Story />
					</div>
				</ExtensionStateProviderMock>
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
