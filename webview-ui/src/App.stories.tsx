import { HeroUIProvider } from "@heroui/react"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import type { ApiConfiguration } from "@shared/api"
import type { ClineMessage } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { useMemo } from "react"
import { expect, userEvent, within } from "storybook/test"
import { ExtensionStateContext, useExtensionState } from "@/context/ExtensionStateContext"
import ChatView from "./components/chat/ChatView"
import WelcomeView from "./components/welcome/WelcomeView"

// Mock component that mimics App behavior but works in Storybook
const MockApp = () => {
	const { showWelcome } = useExtensionState()

	return (
		<HeroUIProvider>
			{showWelcome ? (
				<WelcomeView />
			) : (
				<ChatView hideAnnouncement={() => {}} isHidden={false} showAnnouncement={false} showHistoryView={() => {}} />
			)}
		</HeroUIProvider>
	)
}

// Constants
const SIDEBAR_CLASS = "flex flex-col justify-center h-[60%] w-[80%] overflow-hidden"
const ExtensionStateProviderMock = ExtensionStateContext.Provider

const meta: Meta<typeof MockApp> = {
	title: "Views/Chat",
	component: MockApp,
	parameters: {
		layout: "fullscreen",
		docs: {
			description: {
				component: `
The ChatView component is the main interface for interacting with Cline. It provides a comprehensive chat experience with AI assistance, task management, and various tools.

**Key Features:**
- **Task Management**: Create, resume, and manage AI-assisted tasks
- **Message History**: View conversation history with rich formatting
- **File & Image Support**: Attach files and images to messages
- **Tool Integration**: Execute commands, browse files, and use various tools
- **Auto-approval**: Configure automatic approval for certain actions
- **Streaming Responses**: Real-time AI response streaming
- **Context Management**: Intelligent conversation context handling
- **Plan/Act Modes**: Separate planning and execution phases
- **MCP Integration**: Model Context Protocol server support
- **Browser Automation**: Automated browser interactions
- **Checkpoint System**: Save and restore conversation states

**Use Cases:**
- Software development assistance
- Code review and refactoring
- File system operations
- Web browsing and research
- Task automation
- Learning and exploration

**Note**: In Storybook, some features like file operations, command execution, and API calls are mocked for demonstration purposes.
        `,
			},
		},
	},
	decorators: [
		(Story) => (
			<div className="w-full h-full flex justify-center items-center overflow-hidden">
				<div className={SIDEBAR_CLASS}>
					<Story />
				</div>
			</div>
		),
	],
}

export default meta
type Story = StoryObj<typeof MockApp>

// Mock data factories
const createApiConfig = (overrides: Partial<ApiConfiguration> = {}): ApiConfiguration => ({
	actModeApiProvider: "anthropic",
	actModeApiModelId: "claude-3-5-sonnet-20241022",
	actModeOpenRouterModelInfo: {
		maxTokens: 8000,
		contextWindow: 200000,
		supportsPromptCache: true,
	},
	apiKey: "mock-key",
	...overrides,
})

const mockApiConfiguration = createApiConfig()
const mockApiConfigurationPlan = createApiConfig({
	planModeApiProvider: "anthropic",
	planModeApiModelId: "claude-3-5-sonnet-20241022",
})

const createHistoryItem = (id: string, hoursAgo: number, task: string, metrics: Partial<HistoryItem> = {}): HistoryItem => ({
	id,
	ulid: "01HZZZ1A1B2C3D4E5F6G7H8J9K",
	ts: Date.now() - hoursAgo * 3600000,
	task,
	tokensIn: 2500,
	tokensOut: 1200,
	cacheWrites: 350,
	cacheReads: 180,
	totalCost: 0.085,
	size: 123456,
	...metrics,
})

const mockTaskHistory: HistoryItem[] = [
	createHistoryItem("task-1", 1, "Create a React component for displaying user profiles"),
	createHistoryItem("task-2", 2, "Debug the authentication flow in the login system", {
		tokensIn: 3200,
		tokensOut: 1800,
		cacheWrites: 450,
		cacheReads: 220,
		totalCost: 0.125,
		size: 1234567,
	}),
	createHistoryItem("task-3", 24, "Optimize database queries for better performance", {
		tokensIn: 4500,
		tokensOut: 2400,
		cacheWrites: 680,
		cacheReads: 340,
		totalCost: 0.185,
		size: 12345678,
	}),
]

const createMessage = (
	minutesAgo: number,
	type: ClineMessage["type"],
	say: ClineMessage["say"],
	text: string,
	overrides: Partial<ClineMessage> = {},
): ClineMessage => ({
	ts: Date.now() - minutesAgo * 60000,
	type,
	say,
	text,
	...overrides,
})

const createApiReqMessage = (minutesAgo: number, request: string, metrics: any = {}) =>
	createMessage(
		minutesAgo,
		"say",
		"api_req_started",
		JSON.stringify({
			request,
			tokensIn: 19500,
			tokensOut: 4220,
			cacheWrites: 120,
			cacheReads: 60,
			size: 12345,
			cost: 0.025,
			...metrics,
		}),
	)

const mockActiveMessages: ClineMessage[] = [
	createMessage(5, "say", "task", "Help me create a responsive navigation component for a React application"),
	createApiReqMessage(4.9, "Initial analysis request"),
	createMessage(
		4.7,
		"say",
		"text",
		"I'll help you create a responsive navigation component for your React application. Let me start by examining your current project structure and then create a modern, accessible navigation component.",
	),
	createMessage(4.3, "say", "tool", JSON.stringify({ tool: "listFilesTopLevel", path: "src/components" })),
	createApiReqMessage(4.2, "Component creation request", { tokensIn: 12020, tokensOut: 6180, cost: 0.042 }),
	createMessage(
		4,
		"say",
		"text",
		"Based on your project structure, I'll create a responsive navigation component with the following features:\n\n- Mobile-first responsive design\n- Accessible keyboard navigation\n- Smooth animations\n- Support for nested menu items\n- Dark/light theme support",
	),
	createMessage(
		3.7,
		"say",
		"tool",
		JSON.stringify({
			tool: "newFileCreated",
			path: "src/components/Navigation/Navigation.tsx",
			content: "// Navigation component code...",
		}),
	),
	createApiReqMessage(3.5, "Final response request", { tokensIn: 41550, tokensOut: 3320, cost: 0.018 }),
	createMessage(
		3.3,
		"say",
		"text",
		"I've created a responsive navigation component with TypeScript support. The component includes:\n\n✅ Mobile-first responsive design\n✅ Accessible ARIA attributes\n✅ Toggle functionality for mobile\n✅ TypeScript interfaces for type safety\n✅ Theme support\n\nWould you like me to also create the CSS styles for this component?",
	),
]

const mockStreamingMessages: ClineMessage[] = [
	...mockActiveMessages,
	createMessage(
		0.17,
		"say",
		"text",
		"Now I'll create the CSS styles for the navigation component. This will include responsive breakpoints, smooth animations, and accessibility features...",
		{ partial: true },
	),
]

// Reusable state and decorator factories
const createMockState = (overrides: any = {}) => ({
	...useExtensionState(),
	useAutoCondense: true,
	autoCondenseThreshold: 0.5,
	welcomeViewCompleted: true,
	showWelcome: false,
	clineMessages: mockActiveMessages,
	taskHistory: mockTaskHistory,
	apiConfiguration: mockApiConfiguration,
	...overrides,
})

const createStoryDecorator =
	(stateOverrides: any = {}) =>
	(Story: any) => {
		const mockState = useMemo(() => createMockState(stateOverrides), [])
		return (
			<ExtensionStateProviderMock value={mockState}>
				<div className="w-full h-full flex justify-center items-center overflow-hidden">
					<div className={SIDEBAR_CLASS}>
						<Story />
					</div>
				</div>
			</ExtensionStateProviderMock>
		)
	}

export const WelcomeScreen: Story = {
	decorators: [createStoryDecorator({ welcomeViewCompleted: false, showWelcome: true, clineMessages: [] })],
	parameters: {
		docs: {
			description: {
				story: "The welcome screen shown to new users or when no task is active. Displays quick start options and recent task history.",
			},
		},
	},
	args: {},
	// More on component testing: https://storybook.js.org/docs/writing-tests/interaction-testing
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement)
		// Button has vscode-button element name
		const getStartedButton = canvas.getByText("Get Started for Free")
		const byokButton = canvas.getByText("Use your own API key")
		await expect(getStartedButton).toBeInTheDocument()
		await expect(byokButton).toBeInTheDocument()
		await userEvent.click(byokButton)
		await expect(getStartedButton).toBeInTheDocument()
		await expect(byokButton).not.toBeInTheDocument()
	},
}

export const ActiveConversation: Story = {
	decorators: [createStoryDecorator({ task: mockTaskHistory[0], currentTaskItem: mockTaskHistory[0] })],
	parameters: {
		docs: {
			description: {
				story: "An active conversation showing a typical interaction with Cline, including task creation, tool usage, and AI responses.",
			},
		},
	},
}

export const StreamingResponse: Story = {
	decorators: [createStoryDecorator({ clineMessages: mockStreamingMessages })],
	parameters: {
		docs: {
			description: {
				story: "Shows a streaming response in progress, demonstrating real-time AI response rendering.",
			},
		},
	},
}

const createLongMessages = (): ClineMessage[] => [
	createMessage(30, "say", "task", "Help me build a complete e-commerce application with React, Node.js, and MongoDB"),
	createMessage(
		29.7,
		"say",
		"text",
		"I'll help you build a complete e-commerce application. Let's start by setting up the project structure and implementing the core features step by step.",
	),
	createMessage(
		29.3,
		"say",
		"tool",
		JSON.stringify({ tool: "newFileCreated", path: "package.json", content: "// Package.json content..." }),
	),
	createMessage(
		29,
		"say",
		"text",
		"Great! I've set up the initial package.json. Now let's create the backend server with Express and MongoDB integration.",
	),
	createMessage(
		28.7,
		"say",
		"tool",
		JSON.stringify({ tool: "newFileCreated", path: "server.js", content: "// Express server code..." }),
	),
	createMessage(
		28.3,
		"say",
		"text",
		"Perfect! The backend server is set up. Now let's create the product model and routes for handling product operations.",
	),
	createMessage(
		28,
		"say",
		"tool",
		JSON.stringify({ tool: "newFileCreated", path: "models/Product.js", content: "// Product model code..." }),
	),
	createMessage(
		27.7,
		"say",
		"text",
		"Excellent! The Product model is ready with all necessary fields. Now let's create the React frontend with a modern component structure.",
	),
	createMessage(27.3, "say", "command", "cd client && npx create-react-app . --template typescript"),
	createMessage(27, "say", "command_output", "Creating a new React app... Success! Created client at /path/to/project/client"),
	createMessage(
		26.7,
		"say",
		"text",
		"Great! The React frontend is set up with TypeScript. Now let's create the main components for our e-commerce application.",
	),
]

export const LongConversation: Story = {
	decorators: [createStoryDecorator({ clineMessages: createLongMessages() })],
	parameters: {
		docs: {
			description: {
				story: "A longer conversation showing multiple tool uses, file creation, and command execution in a complex development task.",
			},
		},
	},
}

// Optimized message patterns for common scenarios
const createErrorMessages = () => [
	createMessage(5, "say", "task", "Help me fix the build errors in my React application"),
	createMessage(
		4.7,
		"say",
		"text",
		"I'll help you fix the build errors. Let me first examine the current state of your application.",
	),
	createMessage(4.3, "say", "command", "npm run build"),
	createMessage(4, "say", "error", "Build failed with TypeScript errors in UserProfile.tsx and api.ts"),
	createMessage(
		3.7,
		"say",
		"text",
		"I can see there are TypeScript errors in your code. Let me examine the files and fix these issues.",
	),
	createMessage(3.3, "say", "tool", JSON.stringify({ tool: "readFile", path: "src/components/UserProfile.tsx" })),
	createMessage(
		3,
		"say",
		"text",
		"I found the issue. The User type doesn't have a 'username' property. Let me fix this by updating the component to use the correct property name.",
	),
]

const createAskMessage = (type: string, text: string, streamingFailedMessage?: string) => ({
	ts: Date.now() - 60000,
	type: "ask" as const,
	ask: type,
	text,
	streamingFailedMessage,
})

export const ErrorState: Story = {
	decorators: [createStoryDecorator({ clineMessages: createErrorMessages() })],
	parameters: {
		docs: {
			description: {
				story: "Shows how Cline handles and displays error messages, helping users understand and resolve issues.",
			},
		},
	},
}

export const AutoApprovalEnabled: Story = {
	decorators: [
		createStoryDecorator({
			autoApprovalSettings: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS,
				enabled: true,
			},
		}),
	],
	parameters: {
		docs: {
			description: {
				story: "Shows the interface with auto-approval enabled, allowing Cline to execute certain actions automatically without user confirmation.",
			},
		},
	},
}

const createPlanModeMessages = () => [
	createMessage(5, "say", "task", "Help me refactor my React application to use TypeScript and improve performance"),
	createApiReqMessage(4.9, "Planning analysis request", { tokensIn: 20000, tokensOut: 19500, cost: 0.065 }),
	createMessage(
		4.7,
		"say",
		"text",
		"I'll help you refactor your React application to use TypeScript and improve performance. Let me create a detailed plan for this migration.",
	),
	createApiReqMessage(4.5, "Detailed planning request", { tokensIn: 20002, tokensOut: 12500, cost: 0.095 }),
	createAskMessage(
		"plan_mode_respond",
		"Here's my comprehensive plan for refactoring your React application with TypeScript migration and performance optimization phases.",
	),
]

export const PlanMode: Story = {
	decorators: [
		createStoryDecorator({
			clineMessages: createPlanModeMessages(),
			apiConfiguration: mockApiConfigurationPlan,
			mode: "plan" as const,
		}),
	],
	parameters: {
		docs: {
			description: {
				story: "Shows Cline in Plan mode, where it focuses on creating detailed plans and discussing approaches before implementation.",
			},
		},
	},
}

export const EmptyState: Story = {
	decorators: [createStoryDecorator({ clineMessages: [], taskHistory: [], isNewUser: true })],
	parameters: {
		docs: {
			description: {
				story: "Shows the empty state for first-time users with no conversation history or active tasks.",
			},
		},
	},
}

const createBrowserMessages = () => [
	createMessage(5, "say", "task", "Help me test the login functionality on my web application"),
	createMessage(
		4.7,
		"say",
		"text",
		"I'll help you test the login functionality. Let me launch a browser and navigate to your application.",
	),
	createMessage(4.3, "say", "browser_action_launch", JSON.stringify({ action: "launch", url: "http://localhost:3000/login" })),
	createMessage(
		4,
		"say",
		"browser_action_result",
		JSON.stringify({ currentUrl: "http://localhost:3000/login", logs: "Page loaded successfully" }),
	),
	createMessage(
		3.7,
		"say",
		"text",
		"Great! The browser has launched and navigated to your login page. Now let me test the login functionality.",
	),
	createMessage(3.3, "say", "browser_action", JSON.stringify({ action: "click", coordinate: "400,200" })),
	createMessage(3, "say", "browser_action", JSON.stringify({ action: "type", text: "test@example.com" })),
]

export const BrowserAutomation: Story = {
	decorators: [createStoryDecorator({ clineMessages: createBrowserMessages() })],
	parameters: {
		docs: {
			description: {
				story: "Shows Cline performing browser automation tasks, including launching browsers, clicking elements, and testing web applications.",
			},
		},
	},
}

// Optimized stories using ask message pattern
const createToolApprovalMessages = () => [
	createMessage(5, "say", "task", "Help me read the configuration file"),
	createMessage(4.7, "say", "text", "I need to read a file to understand your configuration."),
	createAskMessage("tool", JSON.stringify({ tool: "read_file", path: "config.json" })),
]

export const ToolApproval: Story = {
	decorators: [createStoryDecorator({ clineMessages: createToolApprovalMessages() })],
	parameters: {
		docs: {
			description: {
				story: "Shows tool approval request with Approve/Reject buttons for file operations.",
			},
		},
	},
}

export const ToolSave: Story = {
	decorators: [
		createStoryDecorator({
			clineMessages: [
				createMessage(5, "say", "task", "Update the README file with new instructions"),
				createMessage(4.7, "say", "text", "I'll update your README file with the new instructions."),
				createAskMessage("tool", JSON.stringify({ tool: "editedExistingFile", path: "README.md" })),
			],
		}),
	],
	parameters: {
		docs: {
			description: {
				story: "Shows file save request with Save/Reject buttons for file editing operations.",
			},
		},
	},
}

// Quick story generators for common patterns
const quickStory = (
	name: string,
	askType: string,
	text: string,
	description: string,
	streamingFailedMessage?: string,
): Story => ({
	decorators: [
		createStoryDecorator({
			clineMessages: [
				...createLongMessages(),
				createMessage(6, "say", "task", `Help with ${name.toLowerCase()}`),
				createMessage(4.7, "say", "text", `I'll help you with ${name.toLowerCase()}.`),
				createAskMessage(askType, text, streamingFailedMessage),
			],
		}),
	],
	parameters: { docs: { description: { story: description } } },
})

export const CommandExecution: Story = quickStory(
	"Command Execution",
	"command",
	"npm install",
	"Shows command execution request with Run Command/Reject buttons.",
)

export const CommandOutput: Story = {
	decorators: [
		createStoryDecorator({
			clineMessages: [
				createAskMessage("command", "npm install"),
				createAskMessage("command_output", "Installing packages... This may take a few minutes."),
			],
		}),
	],
	parameters: {
		docs: {
			description: {
				story: "Shows command output with Proceed While Running button during command execution.",
			},
		},
	},
}

// Batch create remaining optimized stories
export const ApiRequestFailed = quickStory(
	"API Request Failed",
	"api_req_failed",
	"API request failed due to network timeout. Would you like to retry?",
	"Shows error recovery options with Retry/Start New Task buttons when API requests fail.",
)
export const MistakeLimitReached = quickStory(
	"Mistake Limit",
	"mistake_limit_reached",
	"I've made several attempts to fix this issue but haven't been successful.",
	"Shows mistake limit reached state with Proceed Anyways/Start New Task options.",
)
export const CompletionResult = quickStory(
	"Task Completion",
	"completion_result",
	"Task completed successfully! I've implemented all the requested features.",
	"Shows task completion state with Start New Task button.",
)
export const BrowserActionLaunch = quickStory(
	"Browser Launch",
	"browser_action_launch",
	"Launch browser to test the website at http://localhost:3000",
	"Shows browser action approval with Approve/Reject buttons for browser launch.",
)
export const McpServerUsage = quickStory(
	"MCP Server",
	"use_mcp_server",
	JSON.stringify({ tool: "get_weather", location: "New York" }),
	"Shows MCP server usage approval with Approve/Reject buttons for external tool usage.",
)
export const Followup = quickStory(
	"Follow-up",
	"followup",
	"What would you like me to work on next?",
	"Shows followup question state where Cline asks for next steps.",
)
export const ResumeTask = quickStory(
	"Resume Task",
	"resume_task",
	"Would you like to resume the previous task?",
	"Shows resume task option for continuing interrupted work.",
)
export const NewTaskWithContext = quickStory(
	"New Task",
	"new_task",
	"Start a new task with the current conversation context",
	"Shows new task creation with context preservation option.",
)
export const ApiRequestActive: Story = {
	decorators: [
		createStoryDecorator({
			clineMessages: [
				createMessage(5, "say", "text", "Processing your request...", { partial: true }),
				createApiReqMessage(4.7, "Making API request to generate response", { partial: true }),
			],
		}),
	],
	parameters: { docs: { description: { story: "Shows active API request state with Cancel button available." } } },
}
export const PlanModeResponse = quickStory(
	"Plan Mode Response",
	"plan_mode_respond",
	"Here's my detailed plan for creating a comprehensive testing strategy.",
	"Shows plan mode response where Cline presents a detailed plan for user approval.",
)
export const CondenseConversation = quickStory(
	"Condense Conversation",
	"condense",
	"Would you like me to condense the conversation to improve performance?",
	"Shows utility action to condense conversation for better performance.",
)
export const ReportBug = quickStory(
	"Report Bug",
	"report_bug",
	"Would you like to report this issue to help improve Cline?",
	"Shows utility action to report bugs to the GitHub repository.",
)
export const ResumeCompletedTask = quickStory(
	"Resume Completed Task type",
	"resume_completed_task",
	"The previous task has been completed. Would you like to start a new task?",
	"Shows Start New Task option for resume completed task.",
)
