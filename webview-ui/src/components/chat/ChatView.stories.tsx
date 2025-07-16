import type { Meta, StoryObj } from "@storybook/react-vite"
import { ClineMessage } from "@shared/ExtensionMessage"
import { HistoryItem } from "@shared/HistoryItem"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { DEFAULT_CHAT_SETTINGS } from "@shared/ChatSettings"
import { ApiConfiguration } from "@shared/api"
import ChatView from "./ChatView"
import { StorybookProvider, VSCodeWebview } from "../common/StorybookDecorator"

const sidebarViewClassNames = "w-[80px]"

const meta: Meta<typeof ChatView> = {
	title: "Views/ChatView",
	component: ChatView,
	decorators: [VSCodeWebview],
}

export default meta

type Story = StoryObj<typeof ChatView>

export const Default: StoryObj<typeof meta> = {}

// Mock API configuration
const mockApiConfiguration: ApiConfiguration = {
	apiProvider: "anthropic",
	apiModelId: "claude-3-5-sonnet-20241022",
	apiKey: "mock-key",
}

// Mock task history
const mockTaskHistory: HistoryItem[] = [
	{
		id: "task-1",
		ts: Date.now() - 3600000, // 1 hour ago
		task: "Create a React component for displaying user profiles",
		tokensIn: 1500,
		tokensOut: 800,
		cacheWrites: 200,
		cacheReads: 100,
		totalCost: 0.05,
	},
	{
		id: "task-2",
		ts: Date.now() - 7200000, // 2 hours ago
		task: "Debug the authentication flow in the login system",
		tokensIn: 2200,
		tokensOut: 1200,
		cacheWrites: 300,
		cacheReads: 150,
		totalCost: 0.08,
	},
	{
		id: "task-3",
		ts: Date.now() - 86400000, // 1 day ago
		task: "Optimize database queries for better performance",
		tokensIn: 3000,
		tokensOut: 1800,
		cacheWrites: 500,
		cacheReads: 250,
		totalCost: 0.12,
	},
]

// Mock messages for active conversation
const mockActiveMessages: ClineMessage[] = [
	{
		ts: Date.now() - 300000, // 5 minutes ago
		type: "say",
		say: "task",
		text: "Help me create a responsive navigation component for a React application",
	},
	{
		ts: Date.now() - 280000,
		type: "say",
		say: "text",
		text: "I'll help you create a responsive navigation component for your React application. Let me start by examining your current project structure and then create a modern, accessible navigation component.",
	},
	{
		ts: Date.now() - 260000,
		type: "say",
		say: "tool",
		text: JSON.stringify({
			tool: "listFilesTopLevel",
			path: "src/components",
		}),
	},
	{
		ts: Date.now() - 240000,
		type: "say",
		say: "text",
		text: "Based on your project structure, I'll create a responsive navigation component with the following features:\n\n- Mobile-first responsive design\n- Accessible keyboard navigation\n- Smooth animations\n- Support for nested menu items\n- Dark/light theme support",
	},
	{
		ts: Date.now() - 220000,
		type: "say",
		say: "tool",
		text: JSON.stringify({
			tool: "newFileCreated",
			path: "src/components/Navigation/Navigation.tsx",
			content: `import React, { useState } from 'react'
import './Navigation.css'

interface NavigationProps {
  items: NavigationItem[]
  theme?: 'light' | 'dark'
}

interface NavigationItem {
  label: string
  href: string
  children?: NavigationItem[]
}

export const Navigation: React.FC<NavigationProps> = ({ items, theme = 'light' }) => {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <nav className={\`navigation navigation--\${theme}\`}>
      <div className="navigation__container">
        <button 
          className="navigation__toggle"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
        >
          Menu
        </button>
        <ul className={\`navigation__list \${isOpen ? 'navigation__list--open' : ''}\`}>
          {items.map((item, index) => (
            <li key={index} className="navigation__item">
              <a href={item.href} className="navigation__link">
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}`,
		}),
	},
	{
		ts: Date.now() - 200000,
		type: "say",
		say: "text",
		text: "I've created a responsive navigation component with TypeScript support. The component includes:\n\n✅ Mobile-first responsive design\n✅ Accessible ARIA attributes\n✅ Toggle functionality for mobile\n✅ TypeScript interfaces for type safety\n✅ Theme support\n\nWould you like me to also create the CSS styles for this component?",
	},
]

// Mock streaming message
const mockStreamingMessages: ClineMessage[] = [
	...mockActiveMessages,
	{
		ts: Date.now() - 10000,
		type: "say",
		say: "text",
		text: "Now I'll create the CSS styles for the navigation component. This will include responsive breakpoints, smooth animations, and accessibility features...",
		partial: true,
	},
]

export const WelcomeScreen: Story = {
	decorators: [
		(Story) => {
			const mockState = {
				welcomeViewCompleted: false,
				showWelcome: true,
				clineMessages: [],
				taskHistory: mockTaskHistory,
				apiConfiguration: mockApiConfiguration,
			}

			return (
				<StorybookProvider mockState={mockState}>
					<Story />
				</StorybookProvider>
			)
		},
	],
}

export const ActiveConversation: Story = {
	decorators: [
		(Story) => (
			<StorybookProvider
				mockState={{
					welcomeViewCompleted: true,
					clineMessages: mockActiveMessages,
					taskHistory: mockTaskHistory,
					apiConfiguration: mockApiConfiguration,
				}}>
				<Story />
			</StorybookProvider>
		),
	],
}

// Streaming response
export const StreamingResponse: Story = {
	decorators: [
		(Story) => {
			const mockState = {
				welcomeViewCompleted: true,
				showWelcome: false,
				clineMessages: mockStreamingMessages,
				taskHistory: mockTaskHistory,
				apiConfiguration: mockApiConfiguration,
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
				story: "Shows a streaming response in progress, demonstrating real-time AI response rendering.",
			},
		},
	},
}

// Long conversation
export const LongConversation: Story = {
	decorators: [
		(Story) => {
			const longMessages: ClineMessage[] = [
				{
					ts: Date.now() - 1800000, // 30 minutes ago
					type: "say",
					say: "task",
					text: "Help me build a complete e-commerce application with React, Node.js, and MongoDB",
				},
				{
					ts: Date.now() - 1780000,
					type: "say",
					say: "text",
					text: "I'll help you build a complete e-commerce application. Let's start by setting up the project structure and implementing the core features step by step.",
				},
				{
					ts: Date.now() - 1760000,
					type: "say",
					say: "tool",
					text: JSON.stringify({
						tool: "newFileCreated",
						path: "package.json",
						content: `{
  "name": "ecommerce-app",
  "version": "1.0.0",
  "description": "Full-stack e-commerce application",
  "main": "server.js",
  "scripts": {
    "dev": "concurrently \\"npm run server\\" \\"npm run client\\"",
    "server": "nodemon server.js",
    "client": "cd client && npm start"
  }
}`,
					}),
				},
				{
					ts: Date.now() - 1740000,
					type: "say",
					say: "text",
					text: "Great! I've set up the initial package.json. Now let's create the backend server with Express and MongoDB integration.",
				},
				{
					ts: Date.now() - 1720000,
					type: "say",
					say: "tool",
					text: JSON.stringify({
						tool: "newFileCreated",
						path: "server.js",
						content: `const express = require('express')
const mongoose = require('mongoose')
const cors = require('cors')
const productRoutes = require('./routes/products')
const userRoutes = require('./routes/users')
const orderRoutes = require('./routes/orders')

const app = express()
const PORT = process.env.PORT || 5000

// Middleware
app.use(cors())
app.use(express.json())

// Routes
app.use('/api/products', productRoutes)
app.use('/api/users', userRoutes)
app.use('/api/orders', orderRoutes)

// MongoDB connection
mongoose.connect('mongodb://localhost:27017/ecommerce', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`)
})`,
					}),
				},
				{
					ts: Date.now() - 1700000,
					type: "say",
					say: "text",
					text: "Perfect! The backend server is set up. Now let's create the product model and routes for handling product operations.",
				},
				{
					ts: Date.now() - 1680000,
					type: "say",
					say: "tool",
					text: JSON.stringify({
						tool: "newFileCreated",
						path: "models/Product.js",
						content: `const mongoose = require('mongoose')

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  category: {
    type: String,
    required: true
  },
  stock: {
    type: Number,
    required: true,
    min: 0
  },
  images: [{
    type: String
  }],
  ratings: {
    average: {
      type: Number,
      default: 0
    },
    count: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true
})

module.exports = mongoose.model('Product', productSchema)`,
					}),
				},
				{
					ts: Date.now() - 1660000,
					type: "say",
					say: "text",
					text: "Excellent! The Product model is ready with all necessary fields. Now let's create the React frontend with a modern component structure.",
				},
				{
					ts: Date.now() - 1640000,
					type: "say",
					say: "command",
					text: "cd client && npx create-react-app . --template typescript",
				},
				{
					ts: Date.now() - 1620000,
					type: "say",
					say: "command_output",
					text: "Creating a new React app in /path/to/project/client...\n\nInstalling packages. This might take a couple of minutes.\nInstalling react, react-dom, and react-scripts with cra-template-typescript...\n\nSuccess! Created client at /path/to/project/client",
				},
				{
					ts: Date.now() - 1600000,
					type: "say",
					say: "text",
					text: "Great! The React frontend is set up with TypeScript. Now let's create the main components for our e-commerce application.",
				},
			]

			const mockState = {
				welcomeViewCompleted: true,
				showWelcome: false,
				clineMessages: longMessages,
				taskHistory: mockTaskHistory,
				apiConfiguration: mockApiConfiguration,
			}

			return (
				<StorybookProvider mockState={mockState}>
					<div className={sidebarViewClassNames}>
						<Story />
					</div>
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "A longer conversation showing multiple tool uses, file creation, and command execution in a complex development task.",
			},
		},
	},
}

// Error state
export const ErrorState: Story = {
	decorators: [
		(Story) => {
			const errorMessages: ClineMessage[] = [
				{
					ts: Date.now() - 300000,
					type: "say",
					say: "task",
					text: "Help me fix the build errors in my React application",
				},
				{
					ts: Date.now() - 280000,
					type: "say",
					say: "text",
					text: "I'll help you fix the build errors. Let me first examine the current state of your application.",
				},
				{
					ts: Date.now() - 260000,
					type: "say",
					say: "command",
					text: "npm run build",
				},
				{
					ts: Date.now() - 240000,
					type: "say",
					say: "error",
					text: "Build failed with the following errors:\n\nTypeScript error in src/components/UserProfile.tsx(15,23):\nProperty 'username' does not exist on type 'User'.\n\nTypeScript error in src/utils/api.ts(42,15):\nArgument of type 'string | undefined' is not assignable to parameter of type 'string'.",
				},
				{
					ts: Date.now() - 220000,
					type: "say",
					say: "text",
					text: "I can see there are TypeScript errors in your code. Let me examine the files and fix these issues.",
				},
				{
					ts: Date.now() - 200000,
					type: "say",
					say: "tool",
					text: JSON.stringify({
						tool: "readFile",
						path: "src/components/UserProfile.tsx",
					}),
				},
				{
					ts: Date.now() - 180000,
					type: "say",
					say: "text",
					text: "I found the issue. The User type doesn't have a 'username' property. Let me fix this by updating the component to use the correct property name.",
				},
			]

			const mockState = {
				welcomeViewCompleted: true,
				showWelcome: false,
				clineMessages: errorMessages,
				taskHistory: mockTaskHistory,
				apiConfiguration: mockApiConfiguration,
			}

			return (
				<StorybookProvider mockState={mockState}>
					<div className={sidebarViewClassNames}>
						<Story />
					</div>
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "Shows how Cline handles and displays error messages, helping users understand and resolve issues.",
			},
		},
	},
}

// Auto-approval enabled
export const AutoApprovalEnabled: Story = {
	decorators: [
		(Story) => {
			const mockState = {
				welcomeViewCompleted: true,
				showWelcome: false,
				clineMessages: mockActiveMessages,
				taskHistory: mockTaskHistory,
				apiConfiguration: mockApiConfiguration,
				autoApprovalSettings: {
					...DEFAULT_AUTO_APPROVAL_SETTINGS,
					enabled: true,
					maxRequestsPerTask: 10,
					maxRequestsPerHour: 50,
				},
			}

			return (
				<StorybookProvider mockState={mockState}>
					<div className={sidebarViewClassNames}>
						<Story />
					</div>
				</StorybookProvider>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "Shows the interface with auto-approval enabled, allowing Cline to execute certain actions automatically without user confirmation.",
			},
		},
	},
}

// Plan mode
export const PlanMode: Story = {
	decorators: [
		(Story) => {
			const planModeMessages: ClineMessage[] = [
				{
					ts: Date.now() - 300000,
					type: "say",
					say: "task",
					text: "Help me refactor my React application to use TypeScript and improve performance",
				},
				{
					ts: Date.now() - 280000,
					type: "say",
					say: "text",
					text: "I'll help you refactor your React application to use TypeScript and improve performance. Let me create a detailed plan for this migration.",
				},
				{
					ts: Date.now() - 260000,
					type: "ask",
					ask: "plan_mode_respond",
					text: JSON.stringify({
						response:
							"Here's my comprehensive plan for refactoring your React application:\n\n## Phase 1: TypeScript Migration\n1. **Setup TypeScript configuration**\n   - Install TypeScript and related dependencies\n   - Configure tsconfig.json with strict settings\n   - Set up ESLint with TypeScript rules\n\n2. **Convert JavaScript files to TypeScript**\n   - Start with utility functions and constants\n   - Convert React components one by one\n   - Add proper type definitions for props and state\n\n## Phase 2: Performance Optimization\n1. **Code splitting and lazy loading**\n   - Implement React.lazy() for route-based splitting\n   - Add Suspense boundaries\n\n2. **Memoization and optimization**\n   - Use React.memo for expensive components\n   - Implement useMemo and useCallback where appropriate\n   - Optimize re-renders with proper dependency arrays\n\n## Phase 3: Bundle Optimization\n1. **Webpack optimization**\n   - Configure tree shaking\n   - Optimize chunk splitting\n   - Implement proper caching strategies\n\nWould you like me to proceed with this plan, or would you like to modify any part of it?",
					}),
				},
			]

			const mockState = {
				welcomeViewCompleted: true,
				showWelcome: false,
				clineMessages: planModeMessages,
				taskHistory: mockTaskHistory,
				apiConfiguration: mockApiConfiguration,
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
				story: "Shows Cline in Plan mode, where it focuses on creating detailed plans and discussing approaches before implementation.",
			},
		},
	},
}

// Browser automation
export const BrowserAutomation: Story = {
	decorators: [
		(Story) => {
			const browserMessages: ClineMessage[] = [
				{
					ts: Date.now() - 300000,
					type: "say",
					say: "task",
					text: "Help me test the login functionality on my web application",
				},
				{
					ts: Date.now() - 280000,
					type: "say",
					say: "text",
					text: "I'll help you test the login functionality. Let me launch a browser and navigate to your application.",
				},
				{
					ts: Date.now() - 260000,
					type: "say",
					say: "browser_action_launch",
					text: JSON.stringify({
						action: "launch",
						url: "http://localhost:3000/login",
					}),
				},
				{
					ts: Date.now() - 240000,
					type: "say",
					say: "browser_action_result",
					text: JSON.stringify({
						screenshot:
							"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
						currentUrl: "http://localhost:3000/login",
						logs: "Page loaded successfully",
					}),
				},
				{
					ts: Date.now() - 220000,
					type: "say",
					say: "text",
					text: "Great! The browser has launched and navigated to your login page. I can see the login form is displayed. Now let me test the login functionality by filling in the form.",
				},
				{
					ts: Date.now() - 200000,
					type: "say",
					say: "browser_action",
					text: JSON.stringify({
						action: "click",
						coordinate: "400,200",
					}),
				},
				{
					ts: Date.now() - 180000,
					type: "say",
					say: "browser_action",
					text: JSON.stringify({
						action: "type",
						text: "test@example.com",
					}),
				},
			]

			const mockState = {
				welcomeViewCompleted: true,
				showWelcome: false,
				clineMessages: browserMessages,
				taskHistory: mockTaskHistory,
				apiConfiguration: mockApiConfiguration,
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
				story: "Shows Cline performing browser automation tasks, including launching browsers, clicking elements, and testing web applications.",
			},
		},
	},
}
