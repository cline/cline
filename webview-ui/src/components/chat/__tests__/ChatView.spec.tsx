// npx vitest run src/components/chat/__tests__/ChatView.spec.tsx

import React from "react"
import { render, waitFor, act } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"

import ChatView, { ChatViewProps } from "../ChatView"

// Define minimal types needed for testing
interface ClineMessage {
	type: "say" | "ask"
	say?: string
	ask?: string
	ts: number
	text?: string
	partial?: boolean
}

interface ExtensionState {
	version: string
	clineMessages: ClineMessage[]
	taskHistory: any[]
	shouldShowAnnouncement: boolean
	allowedCommands: string[]
	alwaysAllowExecute: boolean
	[key: string]: any
}

// Mock vscode API
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock use-sound hook
const mockPlayFunction = vi.fn()
vi.mock("use-sound", () => ({
	default: vi.fn().mockImplementation(() => {
		return [mockPlayFunction]
	}),
}))

// Mock components that use ESM dependencies
vi.mock("../BrowserSessionRow", () => ({
	default: function MockBrowserSessionRow({ messages }: { messages: ClineMessage[] }) {
		return <div data-testid="browser-session">{JSON.stringify(messages)}</div>
	},
}))

vi.mock("../ChatRow", () => ({
	default: function MockChatRow({ message }: { message: ClineMessage }) {
		return <div data-testid="chat-row">{JSON.stringify(message)}</div>
	},
}))

vi.mock("../AutoApproveMenu", () => ({
	default: () => null,
}))

// Mock VersionIndicator - returns null by default to prevent rendering in tests
vi.mock("../../common/VersionIndicator", () => ({
	default: vi.fn(() => null),
}))

// Get the mock function after the module is mocked
const mockVersionIndicator = vi.mocked(
	// @ts-expect-error - accessing mocked module
	(await import("../../common/VersionIndicator")).default,
)

vi.mock("../Announcement", () => ({
	default: function MockAnnouncement({ hideAnnouncement }: { hideAnnouncement: () => void }) {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const React = require("react")
		return React.createElement(
			"div",
			{ "data-testid": "announcement-modal" },
			React.createElement("div", null, "What's New"),
			React.createElement("button", { onClick: hideAnnouncement }, "Close"),
		)
	},
}))

// Mock RooCloudCTA component
vi.mock("@src/components/welcome/RooCloudCTA", () => ({
	default: function MockRooCloudCTA() {
		return (
			<div data-testid="roo-cloud-cta">
				<div>rooCloudCTA.title</div>
				<div>rooCloudCTA.description</div>
				<div>rooCloudCTA.joinWaitlist</div>
			</div>
		)
	},
}))

// Mock QueuedMessages component
vi.mock("../QueuedMessages", () => ({
	default: function MockQueuedMessages({
		messages = [],
		onRemoveMessage,
	}: {
		messages?: Array<{ id: string; text: string; images?: string[] }>
		onRemoveMessage?: (id: string) => void
	}) {
		if (!messages || messages.length === 0) {
			return null
		}
		return (
			<div data-testid="queued-messages">
				{messages.map((msg) => (
					<div key={msg.id}>
						<span>{msg.text}</span>
						<button aria-label="Remove message" onClick={() => onRemoveMessage?.(msg.id)}>
							Remove
						</button>
					</div>
				))}
			</div>
		)
	},
}))

// Mock RooTips component
vi.mock("@src/components/welcome/RooTips", () => ({
	default: function MockRooTips() {
		return <div data-testid="roo-tips">Tips content</div>
	},
}))

// Mock RooHero component
vi.mock("@src/components/welcome/RooHero", () => ({
	default: function MockRooHero() {
		return <div data-testid="roo-hero">Hero content</div>
	},
}))

// Mock TelemetryBanner component
vi.mock("../common/TelemetryBanner", () => ({
	default: function MockTelemetryBanner() {
		return null // Don't render anything to avoid interference
	},
}))

// Mock i18n
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: any) => {
			if (key === "chat:versionIndicator.ariaLabel" && options?.version) {
				return `Version ${options.version}`
			}
			return key
		},
	}),
	initReactI18next: {
		type: "3rdParty",
		init: () => {},
	},
	Trans: ({ i18nKey, children }: { i18nKey: string; children?: React.ReactNode }) => {
		return <>{children || i18nKey}</>
	},
}))

interface ChatTextAreaProps {
	onSend: (value: string) => void
	inputValue?: string
	sendingDisabled?: boolean
	placeholderText?: string
	selectedImages?: string[]
	shouldDisableImages?: boolean
}

const mockInputRef = React.createRef<HTMLInputElement>()
const mockFocus = vi.fn()

vi.mock("../ChatTextArea", () => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const mockReact = require("react")

	return {
		default: mockReact.forwardRef(function MockChatTextArea(
			props: ChatTextAreaProps,
			ref: React.ForwardedRef<{ focus: () => void }>,
		) {
			// Use useImperativeHandle to expose the mock focus method
			React.useImperativeHandle(ref, () => ({
				focus: mockFocus,
			}))

			return (
				<div data-testid="chat-textarea">
					<input
						ref={mockInputRef}
						type="text"
						onChange={(e) => {
							// With message queueing, onSend is always called (it handles queueing internally)
							props.onSend(e.target.value)
						}}
						data-sending-disabled={props.sendingDisabled}
					/>
				</div>
			)
		}),
	}
})

// Mock VSCode components
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: function MockVSCodeButton({
		children,
		onClick,
		appearance,
	}: {
		children: React.ReactNode
		onClick?: () => void
		appearance?: string
	}) {
		return (
			<button onClick={onClick} data-appearance={appearance}>
				{children}
			</button>
		)
	},
	VSCodeTextField: function MockVSCodeTextField({
		value,
		onInput,
		placeholder,
	}: {
		value?: string
		onInput?: (e: { target: { value: string } }) => void
		placeholder?: string
	}) {
		return (
			<input
				type="text"
				value={value}
				onChange={(e) => onInput?.({ target: { value: e.target.value } })}
				placeholder={placeholder}
			/>
		)
	},
	VSCodeLink: function MockVSCodeLink({ children, href }: { children: React.ReactNode; href?: string }) {
		return <a href={href}>{children}</a>
	},
}))

// Mock window.postMessage to trigger state hydration
const mockPostMessage = (state: Partial<ExtensionState>) => {
	window.postMessage(
		{
			type: "state",
			state: {
				version: "1.0.0",
				clineMessages: [],
				taskHistory: [],
				shouldShowAnnouncement: false,
				allowedCommands: [],
				alwaysAllowExecute: false,
				cloudIsAuthenticated: false,
				telemetrySetting: "enabled",
				...state,
			},
		},
		"*",
	)
}

const defaultProps: ChatViewProps = {
	isHidden: false,
	showAnnouncement: false,
	hideAnnouncement: () => {},
}

const queryClient = new QueryClient()

const renderChatView = (props: Partial<ChatViewProps> = {}) => {
	return render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>
				<ChatView {...defaultProps} {...props} />
			</QueryClientProvider>
		</ExtensionStateContextProvider>,
	)
}

describe("ChatView - Auto Approval Tests", () => {
	beforeEach(() => vi.clearAllMocks())

	it("does not auto-approve any actions when autoApprovalEnabled is false", () => {
		renderChatView()

		// First hydrate state with initial task
		mockPostMessage({
			autoApprovalEnabled: false,
			alwaysAllowBrowser: true,
			alwaysAllowReadOnly: true,
			alwaysAllowWrite: true,
			alwaysAllowExecute: true,
			allowedCommands: ["npm test"],
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
			],
		})

		// Test various types of actions that should not be auto-approved
		const testCases = [
			{
				ask: "browser_action_launch",
				text: JSON.stringify({ action: "launch", url: "http://example.com" }),
			},
			{
				ask: "tool",
				text: JSON.stringify({ tool: "readFile", path: "test.txt" }),
			},
			{
				ask: "tool",
				text: JSON.stringify({ tool: "editedExistingFile", path: "test.txt" }),
			},
			{
				ask: "command",
				text: "npm test",
			},
		]

		testCases.forEach((testCase) => {
			mockPostMessage({
				autoApprovalEnabled: false,
				alwaysAllowBrowser: true,
				alwaysAllowReadOnly: true,
				alwaysAllowWrite: true,
				alwaysAllowExecute: true,
				allowedCommands: ["npm test"],
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
					{
						type: "ask",
						ask: testCase.ask as any,
						ts: Date.now(),
						text: testCase.text,
					},
				],
			})

			// Should not auto-approve when autoApprovalEnabled is false
			expect(vscode.postMessage).not.toHaveBeenCalledWith({
				type: "askResponse",
				askResponse: "yesButtonClicked",
			})
		})
	})

	it("auto-approves browser actions when alwaysAllowBrowser is enabled", async () => {
		renderChatView()

		// First hydrate state with initial task
		mockPostMessage({
			autoApprovalEnabled: true,
			alwaysAllowBrowser: true,
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
			],
		})

		// Clear any initial calls
		vi.mocked(vscode.postMessage).mockClear()

		// Add browser action
		mockPostMessage({
			autoApprovalEnabled: true,
			alwaysAllowBrowser: true,
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "browser_action_launch",
					ts: Date.now(),
					text: JSON.stringify({ action: "launch", url: "http://example.com" }),
				},
			],
		})

		// Wait for auto-approval to happen
		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "askResponse",
				askResponse: "yesButtonClicked",
			})
		})
	})

	it("auto-approves read-only tools when alwaysAllowReadOnly is enabled", async () => {
		renderChatView()

		// First hydrate state with initial task
		mockPostMessage({
			autoApprovalEnabled: true,
			alwaysAllowReadOnly: true,
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
			],
		})

		// Clear any initial calls
		vi.mocked(vscode.postMessage).mockClear()

		// Add read-only tool request
		mockPostMessage({
			autoApprovalEnabled: true,
			alwaysAllowReadOnly: true,
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "tool",
					ts: Date.now(),
					text: JSON.stringify({ tool: "readFile", path: "test.txt" }),
				},
			],
		})

		// Wait for auto-approval to happen
		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "askResponse",
				askResponse: "yesButtonClicked",
			})
		})
	})

	describe("Write Tool Auto-Approval Tests", () => {
		it("auto-approves write tools when alwaysAllowWrite is enabled and message is a tool request", async () => {
			renderChatView()

			// First hydrate state with initial task
			mockPostMessage({
				autoApprovalEnabled: true,
				alwaysAllowWrite: true,
				writeDelayMs: 100, // Short delay for testing
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
				],
			})

			// Clear any initial calls
			vi.mocked(vscode.postMessage).mockClear()

			// Add write tool request
			mockPostMessage({
				autoApprovalEnabled: true,
				alwaysAllowWrite: true,
				writeDelayMs: 100, // Short delay for testing
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
					{
						type: "ask",
						ask: "tool",
						ts: Date.now(),
						text: JSON.stringify({ tool: "editedExistingFile", path: "test.txt" }),
						partial: false,
					},
				],
			})

			// Wait for auto-approval to happen (with delay for write tools)
			await waitFor(
				() => {
					expect(vscode.postMessage).toHaveBeenCalledWith({
						type: "askResponse",
						askResponse: "yesButtonClicked",
					})
				},
				{ timeout: 1000 },
			)
		})

		it("does not auto-approve write operations when alwaysAllowWrite is enabled but message is not a tool request", () => {
			renderChatView()

			// First hydrate state with initial task
			mockPostMessage({
				autoApprovalEnabled: true,
				alwaysAllowWrite: true,
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
				],
			})

			// Clear any initial calls
			vi.mocked(vscode.postMessage).mockClear()

			// Add non-tool write request
			mockPostMessage({
				autoApprovalEnabled: true,
				alwaysAllowWrite: true,
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
					{
						type: "ask",
						ask: "write_to_file",
						ts: Date.now(),
						text: "Writing to test.txt",
					},
				],
			})

			// Should not auto-approve non-tool write operations
			expect(vscode.postMessage).not.toHaveBeenCalledWith({
				type: "askResponse",
				askResponse: "yesButtonClicked",
			})
		})
	})

	it("auto-approves allowed commands when alwaysAllowExecute is enabled", async () => {
		renderChatView()

		// First hydrate state with initial task
		mockPostMessage({
			autoApprovalEnabled: true,
			alwaysAllowExecute: true,
			allowedCommands: ["npm test", "npm run build"],
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
			],
		})

		// Clear any initial calls
		vi.mocked(vscode.postMessage).mockClear()

		// Add allowed command
		mockPostMessage({
			autoApprovalEnabled: true,
			alwaysAllowExecute: true,
			allowedCommands: ["npm test", "npm run build"],
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "command",
					ts: Date.now(),
					text: "npm test",
				},
			],
		})

		// Wait for auto-approval to happen
		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "askResponse",
				askResponse: "yesButtonClicked",
			})
		})
	})

	it("does not auto-approve disallowed commands even when alwaysAllowExecute is enabled", () => {
		renderChatView()

		// First hydrate state with initial task
		mockPostMessage({
			autoApprovalEnabled: true,
			alwaysAllowExecute: true,
			allowedCommands: ["npm test"],
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
			],
		})

		// Clear any initial calls
		vi.mocked(vscode.postMessage).mockClear()

		// Add disallowed command
		mockPostMessage({
			autoApprovalEnabled: true,
			alwaysAllowExecute: true,
			allowedCommands: ["npm test"],
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "command",
					ts: Date.now(),
					text: "rm -rf /",
				},
			],
		})

		// Should not auto-approve disallowed command
		expect(vscode.postMessage).not.toHaveBeenCalledWith({
			type: "askResponse",
			askResponse: "yesButtonClicked",
		})
	})

	describe("Command Chaining Tests", () => {
		it("auto-approves chained commands when all parts are allowed", async () => {
			renderChatView()

			// First hydrate state with initial task
			mockPostMessage({
				autoApprovalEnabled: true,
				alwaysAllowExecute: true,
				allowedCommands: ["npm test", "npm run build", "echo"],
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
				],
			})

			// Clear any initial calls
			vi.mocked(vscode.postMessage).mockClear()

			// Test various chained commands
			const chainedCommands = [
				"npm test && npm run build",
				"npm test || echo 'test failed'",
				"npm test; npm run build",
			]

			for (const command of chainedCommands) {
				vi.mocked(vscode.postMessage).mockClear()

				mockPostMessage({
					autoApprovalEnabled: true,
					alwaysAllowExecute: true,
					allowedCommands: ["npm test", "npm run build", "echo"],
					clineMessages: [
						{
							type: "say",
							say: "task",
							ts: Date.now() - 2000,
							text: "Initial task",
						},
						{
							type: "ask",
							ask: "command",
							ts: Date.now(),
							text: command,
						},
					],
				})

				// Wait for auto-approval to happen
				await waitFor(() => {
					expect(vscode.postMessage).toHaveBeenCalledWith({
						type: "askResponse",
						askResponse: "yesButtonClicked",
					})
				})
			}
		})

		it("does not auto-approve chained commands when any part is disallowed", () => {
			renderChatView()

			// First hydrate state with initial task
			mockPostMessage({
				autoApprovalEnabled: true,
				alwaysAllowExecute: true,
				allowedCommands: ["npm test", "echo"],
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
				],
			})

			// Clear any initial calls
			vi.mocked(vscode.postMessage).mockClear()

			// Add chained command with disallowed part
			mockPostMessage({
				autoApprovalEnabled: true,
				alwaysAllowExecute: true,
				allowedCommands: ["npm test", "echo"],
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
					{
						type: "ask",
						ask: "command",
						ts: Date.now(),
						text: "npm test && rm -rf /",
					},
				],
			})

			// Should not auto-approve chained command with disallowed part
			expect(vscode.postMessage).not.toHaveBeenCalledWith({
				type: "askResponse",
				askResponse: "yesButtonClicked",
			})
		})

		it("handles complex PowerShell command chains correctly", async () => {
			renderChatView()

			// First hydrate state with initial task
			mockPostMessage({
				autoApprovalEnabled: true,
				alwaysAllowExecute: true,
				allowedCommands: ["Get-Process", "Where-Object", "Select-Object"],
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
				],
			})

			// Clear any initial calls
			vi.mocked(vscode.postMessage).mockClear()

			// Add PowerShell piped command
			mockPostMessage({
				autoApprovalEnabled: true,
				alwaysAllowExecute: true,
				allowedCommands: ["Get-Process", "Where-Object", "Select-Object"],
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
					{
						type: "ask",
						ask: "command",
						ts: Date.now(),
						text: "Get-Process | Where-Object {$_.CPU -gt 10} | Select-Object Name, CPU",
					},
				],
			})

			// Wait for auto-approval to happen
			await waitFor(() => {
				expect(vscode.postMessage).toHaveBeenCalledWith({
					type: "askResponse",
					askResponse: "yesButtonClicked",
				})
			})
		})
	})
})

describe("ChatView - Sound Playing Tests", () => {
	beforeEach(() => vi.clearAllMocks())

	it("does not play sound for auto-approved browser actions", () => {
		renderChatView()

		// First hydrate state with initial task
		mockPostMessage({
			autoApprovalEnabled: true,
			alwaysAllowBrowser: true,
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
			],
		})

		// Clear any initial calls
		mockPlayFunction.mockClear()

		// Add browser action that will be auto-approved
		mockPostMessage({
			autoApprovalEnabled: true,
			alwaysAllowBrowser: true,
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "browser_action_launch",
					ts: Date.now(),
					text: JSON.stringify({ action: "launch", url: "http://example.com" }),
				},
			],
		})

		// Should not play sound for auto-approved action
		expect(mockPlayFunction).not.toHaveBeenCalled()
	})

	it("plays notification sound for non-auto-approved browser actions", async () => {
		renderChatView()

		// First hydrate state with initial task
		mockPostMessage({
			autoApprovalEnabled: true,
			alwaysAllowBrowser: false, // Browser actions not auto-approved
			soundEnabled: true, // Enable sound
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
			],
		})

		// Clear any initial calls
		mockPlayFunction.mockClear()

		// Add browser action that won't be auto-approved
		mockPostMessage({
			autoApprovalEnabled: true,
			alwaysAllowBrowser: false,
			soundEnabled: true, // Enable sound
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "browser_action_launch",
					ts: Date.now(),
					text: JSON.stringify({ action: "launch", url: "http://example.com" }),
					partial: false, // Ensure it's not partial
				},
			],
		})

		// Wait for sound to be played
		await waitFor(() => {
			expect(mockPlayFunction).toHaveBeenCalled()
		})
	})

	it("plays celebration sound for completion results", async () => {
		renderChatView()

		// First hydrate state with initial task
		mockPostMessage({
			soundEnabled: true, // Enable sound
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
			],
		})

		// Clear any initial calls
		mockPlayFunction.mockClear()

		// Add completion result
		mockPostMessage({
			soundEnabled: true, // Enable sound
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "completion_result",
					ts: Date.now(),
					text: "Task completed successfully",
					partial: false, // Ensure it's not partial
				},
			],
		})

		// Wait for sound to be played
		await waitFor(() => {
			expect(mockPlayFunction).toHaveBeenCalled()
		})
	})

	it("plays progress_loop sound for api failures", async () => {
		renderChatView()

		// First hydrate state with initial task
		mockPostMessage({
			soundEnabled: true, // Enable sound
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
			],
		})

		// Clear any initial calls
		mockPlayFunction.mockClear()

		// Add API failure
		mockPostMessage({
			soundEnabled: true, // Enable sound
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "api_req_failed",
					ts: Date.now(),
					text: "API request failed",
					partial: false, // Ensure it's not partial
				},
			],
		})

		// Wait for sound to be played
		await waitFor(() => {
			expect(mockPlayFunction).toHaveBeenCalled()
		})
	})

	it("does not play sound when resuming a task from history", () => {
		renderChatView()

		// Clear any initial calls
		mockPlayFunction.mockClear()

		// Hydrate state with a task that has a resumeTaskId (indicating it's resumed from history)
		mockPostMessage({
			resumeTaskId: "task-123",
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Resumed task",
				},
				{
					type: "ask",
					ask: "tool",
					ts: Date.now(),
					text: JSON.stringify({ tool: "readFile", path: "test.txt" }),
				},
			],
		})

		// Should not play sound when resuming from history
		expect(mockPlayFunction).not.toHaveBeenCalled()
	})

	it("does not play sound when resuming a completed task from history", () => {
		renderChatView()

		// Clear any initial calls
		mockPlayFunction.mockClear()

		// Hydrate state with a completed task that has a resumeTaskId
		mockPostMessage({
			resumeTaskId: "task-123",
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Resumed task",
				},
				{
					type: "ask",
					ask: "completion_result",
					ts: Date.now(),
					text: "Task completed",
				},
			],
		})

		// Should not play sound for completion when resuming from history
		expect(mockPlayFunction).not.toHaveBeenCalled()
	})
})

describe("ChatView - Focus Grabbing Tests", () => {
	beforeEach(() => vi.clearAllMocks())

	it("does not grab focus when follow-up question presented", async () => {
		const { getByTestId } = renderChatView()

		// First hydrate state with initial task
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
			],
		})

		// Clear any initial calls
		mockFocus.mockClear()

		// Add follow-up question
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "followup",
					ts: Date.now(),
					text: "Should I continue?",
				},
			],
		})

		// Wait a bit to ensure any focus operations would have occurred
		await waitFor(() => {
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
		})

		// Should not grab focus for follow-up questions
		expect(mockFocus).not.toHaveBeenCalled()
	})
})

describe("ChatView - Version Indicator Tests", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// Reset the mock to return null by default
		mockVersionIndicator.mockReturnValue(null)
	})

	it("displays version indicator button", () => {
		// Mock VersionIndicator to return a button
		mockVersionIndicator.mockReturnValue(
			React.createElement("button", {
				"data-testid": "version-indicator",
				"aria-label": "Version 1.0.0",
				className: "version-indicator-button",
			}),
		)

		const { getByTestId } = renderChatView()

		// Hydrate state with no active task
		mockPostMessage({
			version: "1.0.0",
			clineMessages: [],
		})

		// Should display version indicator
		expect(getByTestId("version-indicator")).toBeInTheDocument()
	})

	it("opens announcement modal when version indicator is clicked", async () => {
		// Mock VersionIndicator to return a button with onClick
		mockVersionIndicator.mockImplementation(({ onClick }: { onClick?: () => void }) =>
			React.createElement("button", {
				"data-testid": "version-indicator",
				onClick,
			}),
		)

		const { getByTestId, queryByTestId } = renderChatView({ showAnnouncement: false })

		// Hydrate state
		mockPostMessage({
			version: "1.0.0",
			clineMessages: [],
		})

		// Wait for component to render
		await waitFor(() => {
			expect(getByTestId("version-indicator")).toBeInTheDocument()
		})

		// Click version indicator
		const versionIndicator = getByTestId("version-indicator")
		act(() => {
			versionIndicator.click()
		})

		// Wait for announcement modal to appear
		await waitFor(() => {
			expect(queryByTestId("announcement-modal")).toBeInTheDocument()
		})
	})

	it("version indicator has correct styling classes", () => {
		// Mock VersionIndicator to return a button with specific classes
		mockVersionIndicator.mockReturnValue(
			React.createElement("button", {
				"data-testid": "version-indicator",
				className: "version-indicator-button absolute top-2 right-2",
			}),
		)

		const { getByTestId } = renderChatView()

		// Hydrate state
		mockPostMessage({
			version: "1.0.0",
			clineMessages: [],
		})

		const versionIndicator = getByTestId("version-indicator")
		expect(versionIndicator.className).toContain("version-indicator-button")
		expect(versionIndicator.className).toContain("absolute")
		expect(versionIndicator.className).toContain("top-2")
		expect(versionIndicator.className).toContain("right-2")
	})

	it("version indicator has proper accessibility attributes", () => {
		// Mock VersionIndicator to return a button with aria-label
		mockVersionIndicator.mockReturnValue(
			React.createElement("button", {
				"data-testid": "version-indicator",
				"aria-label": "Version 1.0.0",
				role: "button",
			}),
		)

		const { getByTestId } = renderChatView()

		// Hydrate state
		mockPostMessage({
			version: "1.0.0",
			clineMessages: [],
		})

		const versionIndicator = getByTestId("version-indicator")
		expect(versionIndicator.getAttribute("aria-label")).toBe("Version 1.0.0")
		expect(versionIndicator.getAttribute("role")).toBe("button")
	})

	it("does not display version indicator when there is an active task", () => {
		// Mock VersionIndicator to return null (simulating hidden state)
		mockVersionIndicator.mockReturnValue(null)

		const { queryByTestId } = renderChatView()

		// Hydrate state with active task
		mockPostMessage({
			version: "1.0.0",
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now(),
					text: "Active task",
				},
			],
		})

		// Should not display version indicator during active task
		expect(queryByTestId("version-indicator")).not.toBeInTheDocument()
	})

	it("displays version indicator only on welcome screen (no task)", () => {
		// Mock VersionIndicator to return a button
		mockVersionIndicator.mockReturnValue(React.createElement("button", { "data-testid": "version-indicator" }))

		const { queryByTestId } = renderChatView()

		// Hydrate state with no active task
		mockPostMessage({
			version: "1.0.0",
			clineMessages: [],
		})

		// Should display version indicator on welcome screen
		expect(queryByTestId("version-indicator")).toBeInTheDocument()
	})
})

describe("ChatView - RooCloudCTA Display Tests", () => {
	beforeEach(() => vi.clearAllMocks())

	it("does not show RooCloudCTA when user is authenticated to Cloud", () => {
		const { queryByTestId } = renderChatView()

		// Hydrate state with user authenticated to cloud
		mockPostMessage({
			cloudIsAuthenticated: true,
			taskHistory: [
				{ id: "1", ts: Date.now() - 3000 },
				{ id: "2", ts: Date.now() - 2000 },
				{ id: "3", ts: Date.now() - 1000 },
				{ id: "4", ts: Date.now() },
			],
			clineMessages: [], // No active task
		})

		// Should not show RooCloudCTA when authenticated
		expect(queryByTestId("roo-cloud-cta")).not.toBeInTheDocument()
	})

	it("does not show RooCloudCTA when user has only run 3 tasks in their history", () => {
		const { queryByTestId } = renderChatView()

		// Hydrate state with user not authenticated but only 3 tasks
		mockPostMessage({
			cloudIsAuthenticated: false,
			taskHistory: [
				{ id: "1", ts: Date.now() - 2000 },
				{ id: "2", ts: Date.now() - 1000 },
				{ id: "3", ts: Date.now() },
			],
			clineMessages: [], // No active task
		})

		// Should not show RooCloudCTA with less than 4 tasks
		expect(queryByTestId("roo-cloud-cta")).not.toBeInTheDocument()
	})

	it("shows RooCloudCTA when user is not authenticated and has run 4 or more tasks", async () => {
		const { getByTestId } = renderChatView()

		// Hydrate state with user not authenticated and 4 tasks
		mockPostMessage({
			cloudIsAuthenticated: false,
			taskHistory: [
				{ id: "1", ts: Date.now() - 3000 },
				{ id: "2", ts: Date.now() - 2000 },
				{ id: "3", ts: Date.now() - 1000 },
				{ id: "4", ts: Date.now() },
			],
			clineMessages: [], // No active task
		})

		// Wait for component to render and show RooCloudCTA
		await waitFor(() => {
			expect(getByTestId("roo-cloud-cta")).toBeInTheDocument()
		})
	})

	it("shows RooCloudCTA when user is not authenticated and has run 5 tasks", async () => {
		const { getByTestId } = renderChatView()

		// Hydrate state with user not authenticated and 5 tasks
		mockPostMessage({
			cloudIsAuthenticated: false,
			taskHistory: [
				{ id: "1", ts: Date.now() - 4000 },
				{ id: "2", ts: Date.now() - 3000 },
				{ id: "3", ts: Date.now() - 2000 },
				{ id: "4", ts: Date.now() - 1000 },
				{ id: "5", ts: Date.now() },
			],
			clineMessages: [], // No active task
		})

		// Wait for component to render and show RooCloudCTA
		await waitFor(() => {
			expect(getByTestId("roo-cloud-cta")).toBeInTheDocument()
		})
	})

	it("does not show RooCloudCTA when there is an active task (regardless of auth status)", async () => {
		const { queryByTestId } = renderChatView()

		// Hydrate state with active task
		mockPostMessage({
			cloudIsAuthenticated: false,
			taskHistory: [
				{ id: "1", ts: Date.now() - 3000 },
				{ id: "2", ts: Date.now() - 2000 },
				{ id: "3", ts: Date.now() - 1000 },
				{ id: "4", ts: Date.now() },
			],
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now(),
					text: "Active task",
				},
			],
		})

		// Wait for component to render with active task
		await waitFor(() => {
			// Should not show RooCloudCTA during active task
			expect(queryByTestId("roo-cloud-cta")).not.toBeInTheDocument()
			// Should not show RooTips either since the entire welcome screen is hidden during active tasks
			expect(queryByTestId("roo-tips")).not.toBeInTheDocument()
			// Should not show RooHero either since the entire welcome screen is hidden during active tasks
			expect(queryByTestId("roo-hero")).not.toBeInTheDocument()
		})
	})

	it("shows RooTips when user is authenticated (instead of RooCloudCTA)", () => {
		const { queryByTestId, getByTestId } = renderChatView()

		// Hydrate state with user authenticated to cloud
		mockPostMessage({
			cloudIsAuthenticated: true,
			taskHistory: [
				{ id: "1", ts: Date.now() - 3000 },
				{ id: "2", ts: Date.now() - 2000 },
				{ id: "3", ts: Date.now() - 1000 },
				{ id: "4", ts: Date.now() },
			],
			clineMessages: [], // No active task
		})

		// Should not show RooCloudCTA but should show RooTips
		expect(queryByTestId("roo-cloud-cta")).not.toBeInTheDocument()
		expect(getByTestId("roo-tips")).toBeInTheDocument()
	})

	it("shows RooTips when user has fewer than 4 tasks (instead of RooCloudCTA)", () => {
		const { queryByTestId, getByTestId } = renderChatView()

		// Hydrate state with user not authenticated but fewer than 4 tasks
		mockPostMessage({
			cloudIsAuthenticated: false,
			taskHistory: [
				{ id: "1", ts: Date.now() - 2000 },
				{ id: "2", ts: Date.now() - 1000 },
				{ id: "3", ts: Date.now() },
			],
			clineMessages: [], // No active task
		})

		// Should not show RooCloudCTA but should show RooTips
		expect(queryByTestId("roo-cloud-cta")).not.toBeInTheDocument()
		expect(getByTestId("roo-tips")).toBeInTheDocument()
	})
})

describe("ChatView - Message Queueing Tests", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// Reset the mock to clear any initial calls
		vi.mocked(vscode.postMessage).mockClear()
	})

	it("shows sending is disabled when task is active", async () => {
		const { getByTestId } = renderChatView()

		// Hydrate state with active task that should disable sending
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 1000,
					text: "Task in progress",
				},
				{
					type: "ask",
					ask: "tool",
					ts: Date.now(),
					text: JSON.stringify({ tool: "readFile", path: "test.txt" }),
					partial: true, // Partial messages disable sending
				},
			],
		})

		// Wait for state to be updated and check that sending is disabled
		await waitFor(() => {
			const chatTextArea = getByTestId("chat-textarea")
			const input = chatTextArea.querySelector("input")!
			expect(input.getAttribute("data-sending-disabled")).toBe("true")
		})
	})

	it("shows sending is enabled when no task is active", async () => {
		const { getByTestId } = renderChatView()

		// Hydrate state with completed task
		mockPostMessage({
			clineMessages: [
				{
					type: "ask",
					ask: "completion_result",
					ts: Date.now(),
					text: "Task completed",
					partial: false,
				},
			],
		})

		// Wait for state to be updated
		await waitFor(() => {
			expect(getByTestId("chat-textarea")).toBeInTheDocument()
		})

		// Check that sending is enabled
		const chatTextArea = getByTestId("chat-textarea")
		const input = chatTextArea.querySelector("input")!
		expect(input.getAttribute("data-sending-disabled")).toBe("false")
	})
})
