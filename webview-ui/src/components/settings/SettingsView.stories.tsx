import type { Meta, StoryObj } from "@storybook/react-vite"
import React from "react"
import SettingsView from "./SettingsView"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { DEFAULT_BROWSER_SETTINGS } from "@shared/BrowserSettings"
import { DEFAULT_CHAT_SETTINGS } from "@shared/ChatSettings"
import { StorybookProvider, VSCodeWebview } from "../common/StorybookDecorator"
import { ExtensionState } from "@shared/ExtensionMessage"

const meta: Meta<typeof SettingsView> = {
	title: "Views/SettingsView",
	component: SettingsView,
	parameters: {
		layout: "fullscreen",
		docs: {
			description: {
				component: `
The SettingsView component provides a comprehensive settings interface for Cline with tabbed navigation.

**Features:**
- **Tabbed Interface**: Organized settings into logical sections (API Configuration, General, Features, Browser, Terminal, Debug, About)
- **Responsive Design**: Adapts to different screen sizes with compact mode for narrow layouts
- **Plan/Act Mode Support**: Separate model configurations for planning and execution modes
- **Real-time Updates**: All settings save immediately without requiring a save button
- **Contextual Navigation**: Can navigate directly to specific settings sections
- **Debug Tools**: Development-only debug section for state management
- **Accessibility**: Proper ARIA labels and keyboard navigation support

**Tabs:**
- **API Configuration**: Model selection, API keys, and provider settings
- **General**: Language preferences, telemetry, and basic settings
- **Features**: Auto-approval, checkpoints, MCP marketplace, and feature toggles
- **Browser**: Browser automation settings and preferences
- **Terminal**: Terminal integration, profiles, and output settings
- **Debug**: Development tools for state reset and debugging (dev mode only)
- **About**: Version information and extension details

**Use Cases:**
- Configuring AI models and API providers
- Customizing extension behavior and features
- Managing terminal and browser integration
- Debugging and troubleshooting (development)
        `,
			},
		},
	},
	decorators: [VSCodeWebview],
	argTypes: {
		onDone: {
			action: "done clicked",
			description: "Callback when the Done button is clicked",
		},
		targetSection: {
			control: "select",
			options: ["api-config", "general", "features", "browser", "terminal", "debug", "about"],
			description: "The settings section to navigate to initially",
		},
	},
}

export default meta
type Story = StoryObj<typeof SettingsView>

// Default settings view
export const Default: Story = {
	args: {
		onDone: () => console.log("Settings done clicked"),
	},
	parameters: {
		docs: {
			description: {
				story: "Default settings view starting with the API Configuration tab.",
			},
		},
	},
}

// API Configuration tab focused
export const ApiConfiguration: Story = {
	args: {
		onDone: () => console.log("Settings done clicked"),
		targetSection: "api-config",
	},
	parameters: {
		docs: {
			description: {
				story: "Settings view focused on the API Configuration tab for model and provider setup.",
			},
		},
	},
}

// General settings tab
export const GeneralSettings: Story = {
	args: {
		onDone: () => console.log("Settings done clicked"),
		targetSection: "general",
	},
	parameters: {
		docs: {
			description: {
				story: "General settings tab with language preferences and basic configuration options.",
			},
		},
	},
}

// Features tab with enhanced state
export const FeaturesTab: Story = {
	args: {
		onDone: () => console.log("Settings done clicked"),
		targetSection: "features",
	},
	decorators: [
		(Story) => {
			const defaultStates = {
				autoApprovalSettings: {
					...DEFAULT_AUTO_APPROVAL_SETTINGS,
				},
				apiConfiguration: {
					apiProvider: "cline",
				},
				enableCheckpointsSetting: true,
				mcpMarketplaceEnabled: true,
				mcpDisplayMode: "rich",
			} satisfies Partial<ExtensionState>

			return (
				<StorybookProvider mockState={defaultStates}>
					<Story />
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "Features tab showing auto-approval settings, checkpoints, and MCP marketplace options.",
			},
		},
	},
}

// Browser settings tab
export const BrowserSettings: Story = {
	args: {
		onDone: () => console.log("Settings done clicked"),
		targetSection: "browser",
	},
	decorators: [
		(Story) => {
			const mockState = {
				browserSettings: {
					...DEFAULT_BROWSER_SETTINGS,
					viewport: { width: 1200, height: 800 },
					userAgent: "Custom User Agent String",
				},
			}

			return (
				<StorybookProvider mockState={mockState}>
					<Story />
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "Browser settings tab with viewport configuration and user agent settings.",
			},
		},
	},
}

// Terminal settings tab
export const TerminalSettings: Story = {
	args: {
		onDone: () => console.log("Settings done clicked"),
		targetSection: "terminal",
	},
	decorators: [
		(Story) => {
			const mockState = {
				shellIntegrationTimeout: 6000,
				terminalReuseEnabled: false,
				terminalOutputLineLimit: 1000,
				defaultTerminalProfile: "PowerShell",
				availableTerminalProfiles: [
					{ id: "powershell", name: "PowerShell", path: "powershell.exe" },
					{ id: "cmd", name: "Command Prompt", path: "cmd.exe" },
					{ id: "bash", name: "Git Bash", path: "bash.exe" },
				],
			}

			return (
				<StorybookProvider mockState={mockState}>
					<Story />
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "Terminal settings tab with shell integration, profiles, and output configuration.",
			},
		},
	},
}

// Debug tab (development mode)
export const DebugTab: Story = {
	args: {
		onDone: () => console.log("Settings done clicked"),
		targetSection: "debug",
	},
	parameters: {
		docs: {
			description: {
				story: "Debug tab with development tools for state management and troubleshooting. Only visible in development mode.",
			},
		},
	},
}

// About tab
export const AboutTab: Story = {
	args: {
		onDone: () => console.log("Settings done clicked"),
		targetSection: "about",
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
				story: "About tab showing version information and extension details.",
			},
		},
	},
}

// Plan mode configuration
export const PlanModeConfiguration: Story = {
	args: {
		onDone: () => console.log("Settings done clicked"),
		targetSection: "api-config",
	},
	decorators: [
		(Story) => {
			const mockState = {
				chatSettings: {
					...DEFAULT_CHAT_SETTINGS,
					mode: "plan" as const,
				},
				planActSeparateModelsSetting: true,
			}

			return (
				<StorybookProvider mockState={mockState}>
					<Story />
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "Settings view in Plan mode showing separate model configuration options.",
			},
		},
	},
}

// Act mode configuration
export const ActModeConfiguration: Story = {
	args: {
		onDone: () => console.log("Settings done clicked"),
		targetSection: "api-config",
	},
	decorators: [
		(Story) => {
			const mockState = {
				chatSettings: {
					...DEFAULT_CHAT_SETTINGS,
					mode: "act" as const,
				},
				planActSeparateModelsSetting: true,
			}

			return (
				<StorybookProvider mockState={mockState}>
					<Story />
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "Settings view in Act mode showing execution-focused model configuration.",
			},
		},
	},
}

// Compact mode (narrow layout)
export const CompactMode: Story = {
	args: {
		onDone: () => console.log("Settings done clicked"),
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
				story: "Settings view in compact mode for narrow layouts, showing icon-only navigation with tooltips.",
			},
		},
	},
}

// With comprehensive feature toggles
export const WithFeatureToggles: Story = {
	args: {
		onDone: () => console.log("Settings done clicked"),
		targetSection: "features",
	},
	decorators: [
		(Story) => {
			const mockState = {
				globalClineRulesToggles: {
					"use-typescript": true,
					"prefer-react": false,
					"follow-conventions": true,
				},
				localClineRulesToggles: {
					"project-specific": true,
					"local-override": false,
				},
				globalWorkflowToggles: {
					"auto-format": true,
					"run-tests": false,
				},
				localWorkflowToggles: {
					"build-on-save": true,
				},
			}

			return (
				<StorybookProvider mockState={mockState}>
					<Story />
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "Features tab with various rule and workflow toggles enabled to demonstrate the full feature set.",
			},
		},
	},
}

// Mode switching in progress
export const ModeSwitching: Story = {
	args: {
		onDone: () => console.log("Settings done clicked"),
		targetSection: "api-config",
	},
	decorators: [
		(Story) => {
			// Simulate mode switching state
			const [isSwitching, setIsSwitching] = React.useState(true)

			React.useEffect(() => {
				const timer = setTimeout(() => setIsSwitching(false), 2000)
				return () => clearTimeout(timer)
			}, [])

			const mockState = {
				chatSettings: {
					...DEFAULT_CHAT_SETTINGS,
					mode: "plan" as const,
				},
			}

			return (
				<StorybookProvider mockState={mockState}>
					<Story />
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "Settings view showing the mode switching state with disabled controls during transition.",
			},
		},
	},
}
