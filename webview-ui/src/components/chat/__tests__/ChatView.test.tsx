// npx jest src/components/chat/__tests__/ChatView.test.tsx

import React from "react"
import { render, waitFor, act } from "@testing-library/react"
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
jest.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: jest.fn(),
	},
}))

// Mock components that use ESM dependencies
jest.mock("../BrowserSessionRow", () => ({
	__esModule: true,
	default: function MockBrowserSessionRow({ messages }: { messages: ClineMessage[] }) {
		return <div data-testid="browser-session">{JSON.stringify(messages)}</div>
	},
}))

jest.mock("../ChatRow", () => ({
	__esModule: true,
	default: function MockChatRow({ message }: { message: ClineMessage }) {
		return <div data-testid="chat-row">{JSON.stringify(message)}</div>
	},
}))

jest.mock("../AutoApproveMenu", () => ({
	__esModule: true,
	default: () => null,
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
const mockFocus = jest.fn()

jest.mock("../ChatTextArea", () => {
	const mockReact = require("react")
	return {
		__esModule: true,
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
					<input ref={mockInputRef} type="text" onChange={(e) => props.onSend(e.target.value)} />
				</div>
			)
		}),
	}
})

// Mock VSCode components
jest.mock("@vscode/webview-ui-toolkit/react", () => ({
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
	beforeEach(() => jest.clearAllMocks())

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
						ask: testCase.ask,
						ts: Date.now(),
						text: testCase.text,
						partial: false,
					},
				],
			})

			// Verify no auto-approval message was sent
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

		// Then send the browser action ask message
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
					partial: false,
				},
			],
		})

		// Wait for the auto-approval message
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

		// Then send the read-only tool ask message
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
					partial: false,
				},
			],
		})

		// Wait for the auto-approval message
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
				writeDelayMs: 0,
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
				],
			})

			// Then send the write tool ask message
			mockPostMessage({
				autoApprovalEnabled: true,
				alwaysAllowWrite: true,
				writeDelayMs: 0,
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

			// Wait for the auto-approval message
			await waitFor(() => {
				expect(vscode.postMessage).toHaveBeenCalledWith({
					type: "askResponse",
					askResponse: "yesButtonClicked",
				})
			})
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

			// Then send a non-tool write operation message
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
						ask: "write_operation",
						ts: Date.now(),
						text: JSON.stringify({ path: "test.txt", content: "test content" }),
						partial: false,
					},
				],
			})

			// Verify no auto-approval message was sent
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

		// Then send the command ask message
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
					text: "npm test",
					partial: false,
				},
			],
		})

		// Wait for the auto-approval message
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

		// Then send the disallowed command ask message
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
					partial: false,
				},
			],
		})

		// Verify no auto-approval message was sent
		expect(vscode.postMessage).not.toHaveBeenCalledWith({
			type: "askResponse",
			askResponse: "yesButtonClicked",
		})
	})

	describe("Command Chaining Tests", () => {
		it("auto-approves chained commands when all parts are allowed", async () => {
			renderChatView()

			// Test various allowed command chaining scenarios
			const allowedChainedCommands = [
				"npm test && npm run build",
				"npm test; npm run build",
				"npm test || npm run build",
				"npm test | npm run build",
				// Add test for quoted pipes which should be treated as part of the command, not as a chain operator
				'echo "hello | world"',
				'npm test "param with | inside" && npm run build',
				// PowerShell command with Select-String
				'npm test 2>&1 | Select-String -NotMatch "node_modules" | Select-String "FAIL|Error"',
			]

			for (const command of allowedChainedCommands) {
				jest.clearAllMocks()

				// First hydrate state with initial task
				mockPostMessage({
					autoApprovalEnabled: true,
					alwaysAllowExecute: true,
					allowedCommands: ["npm test", "npm run build", "echo", "Select-String"],
					clineMessages: [
						{
							type: "say",
							say: "task",
							ts: Date.now() - 2000,
							text: "Initial task",
						},
					],
				})

				// Then send the chained command ask message
				mockPostMessage({
					autoApprovalEnabled: true,
					alwaysAllowExecute: true,
					allowedCommands: ["npm test", "npm run build", "echo", "Select-String"],
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
							partial: false,
						},
					],
				})

				// Wait for the auto-approval message
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

			// Test various command chaining scenarios with disallowed parts
			const disallowedChainedCommands = [
				"npm test && rm -rf /",
				"npm test; rm -rf /",
				"npm test || rm -rf /",
				"npm test | rm -rf /",
				// Test subshell execution using $() and backticks
				"npm test $(echo dangerous)",
				"npm test `echo dangerous`",
				// Test unquoted pipes with disallowed commands
				"npm test | rm -rf /",
				// Test PowerShell command with disallowed parts
				'npm test 2>&1 | Select-String -NotMatch "node_modules" | rm -rf /',
			]

			disallowedChainedCommands.forEach((command) => {
				// First hydrate state with initial task
				mockPostMessage({
					alwaysAllowExecute: true,
					allowedCommands: ["npm test", "Select-String"],
					clineMessages: [
						{
							type: "say",
							say: "task",
							ts: Date.now() - 2000,
							text: "Initial task",
						},
					],
				})

				// Then send the chained command ask message
				mockPostMessage({
					autoApprovalEnabled: true,
					alwaysAllowExecute: true,
					allowedCommands: ["npm test", "Select-String"],
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
							partial: false,
						},
					],
				})

				// Verify no auto-approval message was sent for chained commands with disallowed parts
				expect(vscode.postMessage).not.toHaveBeenCalledWith({
					type: "askResponse",
					askResponse: "yesButtonClicked",
				})
			})
		})

		it("handles complex PowerShell command chains correctly", async () => {
			renderChatView()

			// Test PowerShell specific command chains
			const powershellCommands = {
				allowed: [
					'npm test 2>&1 | Select-String -NotMatch "node_modules"',
					'npm test 2>&1 | Select-String "FAIL|Error"',
					'npm test 2>&1 | Select-String -NotMatch "node_modules" | Select-String "FAIL|Error"',
				],
				disallowed: [
					'npm test 2>&1 | Select-String -NotMatch "node_modules" | rm -rf /',
					'npm test 2>&1 | Select-String "FAIL|Error" && del /F /Q *',
					'npm test 2>&1 | Select-String -NotMatch "node_modules" | Remove-Item -Recurse',
				],
			}

			// Test allowed PowerShell commands
			for (const command of powershellCommands.allowed) {
				jest.clearAllMocks()

				mockPostMessage({
					autoApprovalEnabled: true,
					alwaysAllowExecute: true,
					allowedCommands: ["npm test", "Select-String"],
					clineMessages: [
						{
							type: "say",
							say: "task",
							ts: Date.now() - 2000,
							text: "Initial task",
						},
					],
				})

				mockPostMessage({
					autoApprovalEnabled: true,
					alwaysAllowExecute: true,
					allowedCommands: ["npm test", "Select-String"],
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
							partial: false,
						},
					],
				})

				await waitFor(() => {
					expect(vscode.postMessage).toHaveBeenCalledWith({
						type: "askResponse",
						askResponse: "yesButtonClicked",
					})
				})
			}

			// Test disallowed PowerShell commands
			for (const command of powershellCommands.disallowed) {
				jest.clearAllMocks()

				mockPostMessage({
					autoApprovalEnabled: true,
					alwaysAllowExecute: true,
					allowedCommands: ["npm test", "Select-String"],
					clineMessages: [
						{
							type: "say",
							say: "task",
							ts: Date.now() - 2000,
							text: "Initial task",
						},
					],
				})

				mockPostMessage({
					autoApprovalEnabled: true,
					alwaysAllowExecute: true,
					allowedCommands: ["npm test", "Select-String"],
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
							partial: false,
						},
					],
				})

				expect(vscode.postMessage).not.toHaveBeenCalledWith({
					type: "askResponse",
					askResponse: "yesButtonClicked",
				})
			}
		})
	})
})

describe("ChatView - Sound Playing Tests", () => {
	beforeEach(() => jest.clearAllMocks())

	it("does not play sound for auto-approved browser actions", async () => {
		renderChatView()

		// First hydrate state with initial task and streaming
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
					type: "say",
					say: "api_req_started",
					ts: Date.now() - 1000,
					text: JSON.stringify({}),
					partial: true,
				},
			],
		})

		// Then send the browser action ask message (streaming finished)
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
					partial: false,
				},
			],
		})

		// Verify no sound was played
		expect(vscode.postMessage).not.toHaveBeenCalledWith({
			type: "playSound",
			audioType: expect.any(String),
		})
	})

	it("plays notification sound for non-auto-approved browser actions", async () => {
		renderChatView()

		// First hydrate state with initial task and streaming
		mockPostMessage({
			autoApprovalEnabled: true,
			alwaysAllowBrowser: false,
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "say",
					say: "api_req_started",
					ts: Date.now() - 1000,
					text: JSON.stringify({}),
					partial: true,
				},
			],
		})

		// Then send the browser action ask message (streaming finished)
		mockPostMessage({
			autoApprovalEnabled: true,
			alwaysAllowBrowser: false,
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
					partial: false,
				},
			],
		})

		// Verify notification sound was played
		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "playSound",
				audioType: "notification",
			})
		})
	})

	it("plays celebration sound for completion results", async () => {
		renderChatView()

		// First hydrate state with initial task and streaming
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "say",
					say: "api_req_started",
					ts: Date.now() - 1000,
					text: JSON.stringify({}),
					partial: true,
				},
			],
		})

		// Then send the completion result message (streaming finished)
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
					ask: "completion_result",
					ts: Date.now(),
					text: "Task completed successfully",
					partial: false,
				},
			],
		})

		// Verify celebration sound was played
		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "playSound",
				audioType: "celebration",
			})
		})
	})

	it("plays progress_loop sound for api failures", async () => {
		renderChatView()

		// First hydrate state with initial task and streaming
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now() - 2000,
					text: "Initial task",
				},
				{
					type: "say",
					say: "api_req_started",
					ts: Date.now() - 1000,
					text: JSON.stringify({}),
					partial: true,
				},
			],
		})

		// Then send the api failure message (streaming finished)
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
					ask: "api_req_failed",
					ts: Date.now(),
					text: "API request failed",
					partial: false,
				},
			],
		})

		// Verify progress_loop sound was played
		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "playSound",
				audioType: "progress_loop",
			})
		})
	})
})

describe("ChatView - Focus Grabbing Tests", () => {
	beforeEach(() => jest.clearAllMocks())

	it("does not grab focus when follow-up question presented", async () => {
		const sleep = async (timeout: number) => {
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, timeout))
			})
		}

		renderChatView()

		// First hydrate state with initial task and streaming
		mockPostMessage({
			autoApprovalEnabled: true,
			alwaysAllowBrowser: true,
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now(),
					text: "Initial task",
				},
				{
					type: "say",
					say: "api_req_started",
					ts: Date.now(),
					text: JSON.stringify({}),
					partial: true,
				},
			],
		})

		// process messages
		await sleep(0)
		// wait for focus updates (can take 50msecs)
		await sleep(100)

		const FOCUS_CALLS_ON_INIT = 2
		expect(mockFocus).toHaveBeenCalledTimes(FOCUS_CALLS_ON_INIT)

		// Finish task, and send the followup ask message (streaming unfinished)
		mockPostMessage({
			autoApprovalEnabled: true,
			alwaysAllowBrowser: true,
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now(),
					text: "Initial task",
				},
				{
					type: "ask",
					ask: "followup",
					ts: Date.now(),
					text: JSON.stringify({}),
					partial: true,
				},
			],
		})

		// allow messages to be processed
		await sleep(0)

		// Finish the followup ask message (streaming finished)
		mockPostMessage({
			autoApprovalEnabled: true,
			alwaysAllowBrowser: true,
			clineMessages: [
				{
					type: "ask",
					ask: "followup",
					ts: Date.now(),
					text: JSON.stringify({}),
				},
			],
		})

		// allow messages to be processed
		await sleep(0)

		// wait for focus updates (can take 50msecs)
		await sleep(100)

		// focus() should not have been called again
		expect(mockFocus).toHaveBeenCalledTimes(FOCUS_CALLS_ON_INIT)
	})
})
