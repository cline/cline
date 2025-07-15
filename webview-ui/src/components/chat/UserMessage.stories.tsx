import type { Meta, StoryObj } from "@storybook/react-vite"
import React from "react"
import UserMessage from "./UserMessage"
import { ExtensionStateProviderMock, ExtensionStateMock } from "@/context/ExtensionStateContext"

const meta: Meta<typeof UserMessage> = {
	title: "Chat/UserMessage",
	component: UserMessage,
	parameters: {
		layout: "padded",
		docs: {
			description: {
				component: `
The UserMessage component displays user messages in the chat interface with editing and checkpoint restore capabilities.

**Features:**
- **Editable Messages**: Click to edit message text with auto-resizing textarea
- **Checkpoint Restore**: Restore chat or workspace to previous states when editing
- **File Attachments**: Display thumbnails for attached images and files
- **Keyboard Shortcuts**: 
  - Escape: Cancel editing
  - Enter: Restore chat and send edited message
  - Cmd/Ctrl+Enter: Restore all (chat + workspace) and send edited message
- **Focus Management**: Proper handling of focus states and blur events
- **Text Highlighting**: Supports text highlighting and formatting
- **Error Handling**: Graceful handling of checkpoint tracker errors

**Restore Types:**
- **Restore Chat**: Restores just the conversation history to the checkpoint
- **Restore All**: Restores both conversation and workspace files to the checkpoint

**Use Cases:**
- Displaying user messages in chat conversations
- Editing and resending messages with checkpoint restoration
- Showing attached files and images with messages
- Managing conversation history and workspace state

**Interaction Flow:**
1. Click message to enter edit mode
2. Modify text as needed
3. Use restore buttons or keyboard shortcuts to apply changes
4. System restores to checkpoint and sends edited message
        `,
			},
		},
	},
	decorators: [
		(Story) => {
			return (
				<ExtensionStateProviderMock value={ExtensionStateMock}>
					<div style={{ maxWidth: "600px", margin: "0 auto", padding: "16px" }}>
						<Story />
					</div>
				</ExtensionStateProviderMock>
			)
		},
	],
	argTypes: {
		text: {
			control: "text",
			description: "The message text content",
		},
		images: {
			control: "object",
			description: "Array of image file paths or URLs",
		},
		files: {
			control: "object",
			description: "Array of file paths",
		},
		messageTs: {
			control: "number",
			description: "Timestamp for the message (used for checkpoint restore)",
		},
		sendMessageFromChatRow: {
			action: "sendMessageFromChatRow",
			description: "Callback function when message is resent after editing",
		},
	},
}

export default meta
type Story = StoryObj<typeof UserMessage>

// Basic text message
export const BasicText: Story = {
	args: {
		text: "Create a simple todo app with HTML, CSS, and JavaScript",
		messageTs: Date.now(),
		sendMessageFromChatRow: (text: string, images: string[], files: string[]) => {
			console.log("Resending message:", { text, images, files })
		},
	},
	parameters: {
		docs: {
			description: {
				story: "A basic user message with just text content. Click to edit and see the restore options.",
			},
		},
	},
}

// Message with images
export const WithImages: Story = {
	args: {
		text: "Please analyze these screenshots and help me fix the layout issues",
		images: ["/path/to/screenshot1.png", "/path/to/screenshot2.png", "/path/to/design-mockup.jpg"],
		messageTs: Date.now(),
		sendMessageFromChatRow: (text: string, images: string[], files: string[]) => {
			console.log("Resending message:", { text, images, files })
		},
	},
	parameters: {
		docs: {
			description: {
				story: "User message with attached images. Shows thumbnail display below the message text.",
			},
		},
	},
}

// Message with files
export const WithFiles: Story = {
	args: {
		text: "Review these configuration files and suggest improvements",
		files: ["/path/to/package.json", "/path/to/tsconfig.json", "/path/to/webpack.config.js", "/path/to/README.md"],
		messageTs: Date.now(),
		sendMessageFromChatRow: (text: string, images: string[], files: string[]) => {
			console.log("Resending message:", { text, images, files })
		},
	},
	parameters: {
		docs: {
			description: {
				story: "User message with attached files. File thumbnails are displayed with appropriate icons.",
			},
		},
	},
}

// Message with both images and files
export const WithImagesAndFiles: Story = {
	args: {
		text: "Here's the current state of the project with some design mockups and the source files",
		images: ["/path/to/current-state.png", "/path/to/desired-design.jpg"],
		files: ["/path/to/src/App.tsx", "/path/to/src/components/Header.tsx", "/path/to/styles/main.css"],
		messageTs: Date.now(),
		sendMessageFromChatRow: (text: string, images: string[], files: string[]) => {
			console.log("Resending message:", { text, images, files })
		},
	},
	parameters: {
		docs: {
			description: {
				story: "User message with both images and files attached, demonstrating the full attachment display.",
			},
		},
	},
}

// Long text message
export const LongText: Story = {
	args: {
		text: `I need help creating a comprehensive web application with the following requirements:

1. User authentication system with login/logout functionality
2. Dashboard with data visualization charts
3. CRUD operations for managing user profiles
4. Real-time notifications using WebSockets
5. Responsive design that works on mobile and desktop
6. Integration with external APIs for data fetching
7. Proper error handling and loading states
8. Unit tests for all components
9. Documentation for the API endpoints
10. Deployment configuration for production

The application should be built using React with TypeScript, and I'd like to use modern best practices for state management, routing, and styling. Please provide a detailed implementation plan and help me get started with the project structure.`,
		messageTs: Date.now(),
		sendMessageFromChatRow: (text: string, images: string[], files: string[]) => {
			console.log("Resending message:", { text, images, files })
		},
	},
	parameters: {
		docs: {
			description: {
				story: "A longer user message demonstrating text wrapping and the editing experience with more content.",
			},
		},
	},
}

// Empty message
export const EmptyMessage: Story = {
	args: {
		text: "",
		messageTs: Date.now(),
		sendMessageFromChatRow: (text: string, images: string[], files: string[]) => {
			console.log("Resending message:", { text, images, files })
		},
	},
	parameters: {
		docs: {
			description: {
				story: "Handles empty message text gracefully. Still allows editing to add content.",
			},
		},
	},
}

// Message with special characters and formatting
export const WithSpecialCharacters: Story = {
	args: {
		text: `Here's some code with special characters:

const greeting = "Hello, World! 👋";
const math = 2 + 2 = 4;
const symbols = !@#$%^&*()_+-=[]{}|;':",./<>?

And some Unicode: 🚀 ✨ 💻 🎉 ⚡ 🔥`,
		messageTs: Date.now(),
		sendMessageFromChatRow: (text: string, images: string[], files: string[]) => {
			console.log("Resending message:", { text, images, files })
		},
	},
	parameters: {
		docs: {
			description: {
				story: "Message containing special characters, code snippets, and Unicode emojis.",
			},
		},
	},
}

// Message with checkpoint tracker error
export const WithCheckpointError: Story = {
	args: {
		text: "This message demonstrates the state when checkpoint tracking has an error",
		messageTs: Date.now(),
		sendMessageFromChatRow: (text: string, images: string[], files: string[]) => {
			console.log("Resending message:", { text, images, files })
		},
	},
	decorators: [
		(Story) => {
			const mockState = {
				...ExtensionStateMock,
				checkpointTrackerErrorMessage: "Git repository not found. Checkpoint functionality is disabled.",
			}

			return (
				<ExtensionStateProviderMock value={mockState}>
					<div style={{ maxWidth: "600px", margin: "0 auto", padding: "16px" }}>
						<Story />
					</div>
				</ExtensionStateProviderMock>
			)
		},
	],
	parameters: {
		docs: {
			description: {
				story: "Message state when checkpoint tracker has an error. Only 'Restore Chat' button is available, and Cmd+Enter shortcut is disabled.",
			},
		},
	},
}

// Simulated editing state
export const EditingState: Story = {
	args: {
		text: "Click this message to see the editing interface",
		messageTs: Date.now(),
		sendMessageFromChatRow: (text: string, images: string[], files: string[]) => {
			console.log("Resending message:", { text, images, files })
		},
	},
	decorators: [
		(Story) => {
			// Custom wrapper to demonstrate editing state
			const EditingDemo = () => {
				const [isEditing, setIsEditing] = React.useState(false)
				const [editedText, setEditedText] = React.useState("Click this message to see the editing interface")

				return (
					<div style={{ maxWidth: "600px", margin: "0 auto", padding: "16px" }}>
						<div
							style={{
								backgroundColor: isEditing ? "unset" : "var(--vscode-badge-background)",
								color: "var(--vscode-badge-foreground)",
								borderRadius: "3px",
								padding: "9px",
								whiteSpace: "pre-line",
								wordWrap: "break-word",
								cursor: isEditing ? "default" : "pointer",
							}}
							onClick={() => !isEditing && setIsEditing(true)}>
							{isEditing ? (
								<>
									<textarea
										value={editedText}
										onChange={(e) => setEditedText(e.target.value)}
										autoFocus
										placeholder="Edit your message..."
										aria-label="Edit message text"
										title="Edit message text"
										style={{
											width: "100%",
											backgroundColor: "var(--vscode-input-background)",
											color: "var(--vscode-input-foreground)",
											borderColor: "var(--vscode-input-border)",
											border: "1px solid",
											borderRadius: "2px",
											padding: "6px",
											fontFamily: "inherit",
											fontSize: "inherit",
											lineHeight: "inherit",
											boxSizing: "border-box",
											resize: "none",
											minHeight: "60px",
										}}
									/>
									<div style={{ display: "flex", gap: "8px", marginTop: "8px", justifyContent: "flex-end" }}>
										<button
											onClick={(e) => {
												e.stopPropagation()
												console.log("Restore All clicked")
												setIsEditing(false)
											}}
											style={{
												backgroundColor:
													"var(--vscode-button-secondaryBackground, var(--vscode-descriptionForeground))",
												color: "var(--vscode-button-secondaryForeground, var(--vscode-foreground))",
												border: "none",
												padding: "4px 8px",
												borderRadius: "2px",
												fontSize: "9px",
												cursor: "pointer",
											}}>
											Restore All
										</button>
										<button
											onClick={(e) => {
												e.stopPropagation()
												console.log("Restore Chat clicked")
												setIsEditing(false)
											}}
											style={{
												backgroundColor: "var(--vscode-button-background)",
												color: "var(--vscode-button-foreground)",
												border: "none",
												padding: "4px 8px",
												borderRadius: "2px",
												fontSize: "9px",
												cursor: "pointer",
											}}>
											Restore Chat
										</button>
									</div>
								</>
							) : (
								<span className="ph-no-capture" style={{ display: "block" }}>
									{editedText}
								</span>
							)}
						</div>
					</div>
				)
			}

			return <EditingDemo />
		},
	],
	parameters: {
		docs: {
			description: {
				story: "Interactive demonstration of the editing state with restore buttons. Click the message to enter edit mode.",
			},
		},
	},
}

// Message without timestamp (no checkpoint functionality)
export const WithoutTimestamp: Story = {
	args: {
		text: "This message has no timestamp, so checkpoint restore functionality is not available",
		// messageTs is undefined
		sendMessageFromChatRow: (text: string, images: string[], files: string[]) => {
			console.log("Resending message:", { text, images, files })
		},
	},
	parameters: {
		docs: {
			description: {
				story: "Message without a timestamp. Editing is still possible but checkpoint restore buttons won't function.",
			},
		},
	},
}

// Message with line breaks and formatting
export const WithLineBreaks: Story = {
	args: {
		text: `This message contains multiple lines:

Line 1: Introduction
Line 2: Details about the request
Line 3: Additional context

And some formatting:
- Bullet point 1
- Bullet point 2
- Bullet point 3

Final paragraph with conclusion.`,
		messageTs: Date.now(),
		sendMessageFromChatRow: (text: string, images: string[], files: string[]) => {
			console.log("Resending message:", { text, images, files })
		},
	},
	parameters: {
		docs: {
			description: {
				story: "Message with line breaks and basic formatting to demonstrate text rendering with whitespace preservation.",
			},
		},
	},
}

// Comprehensive example with all features
export const ComprehensiveExample: Story = {
	args: {
		text: `Please help me implement a new feature for the dashboard:

Requirements:
1. Add a new chart component for sales data
2. Include filtering options by date range
3. Make it responsive for mobile devices

I've attached the current dashboard screenshot and the design mockup for reference.`,
		images: ["/path/to/current-dashboard.png", "/path/to/new-design-mockup.jpg"],
		files: ["/path/to/src/Dashboard.tsx", "/path/to/src/components/Chart.tsx", "/path/to/styles/dashboard.css"],
		messageTs: Date.now(),
		sendMessageFromChatRow: (text: string, images: string[], files: string[]) => {
			console.log("Resending message:", { text, images, files })
		},
	},
	parameters: {
		docs: {
			description: {
				story: "Comprehensive example showing a realistic user message with text, images, and files - demonstrating all component features together.",
			},
		},
	},
}
