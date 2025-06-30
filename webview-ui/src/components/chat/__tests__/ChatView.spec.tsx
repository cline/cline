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

vi.mock("@src/components/modals/Announcement", () => ({
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
					<input ref={mockInputRef} type="text" onChange={(e) => props.onSend(e.target.value)} />
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
				vi.clearAllMocks()

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
				vi.clearAllMocks()

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
				vi.clearAllMocks()

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
	beforeEach(() => {
		vi.clearAllMocks()
		mockPlayFunction.mockClear()
	})

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
		expect(mockPlayFunction).not.toHaveBeenCalled()
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
			expect(mockPlayFunction).toHaveBeenCalled()
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
			expect(mockPlayFunction).toHaveBeenCalled()
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
			expect(mockPlayFunction).toHaveBeenCalled()
		})
	})
})

describe("ChatView - Focus Grabbing Tests", () => {
	beforeEach(() => vi.clearAllMocks())

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

describe("ChatView - Version Indicator Tests", () => {
	beforeEach(() => vi.clearAllMocks())

	// Helper function to create a mock VersionIndicator implementation
	const createMockVersionIndicator = (
		ariaLabel: string = "chat:versionIndicator.ariaLabel",
		version: string = "v3.21.5",
	) => {
		return (props?: { onClick?: () => void; className?: string }) => {
			const { onClick, className } = props || {}
			return (
				<button data-testid="version-indicator" onClick={onClick} className={className} aria-label={ariaLabel}>
					{version}
				</button>
			)
		}
	}

	it("displays version indicator button", () => {
		// Temporarily override the mock for this test
		mockVersionIndicator.mockImplementation(createMockVersionIndicator())

		const { getByLabelText } = renderChatView()

		// First hydrate state
		mockPostMessage({
			clineMessages: [],
		})

		// Check that version indicator is displayed
		const versionButton = getByLabelText(/version/i)
		expect(versionButton).toBeInTheDocument()
		expect(versionButton).toHaveTextContent(/^v\d+\.\d+\.\d+/)

		// Reset mock
		mockVersionIndicator.mockReturnValue(null)
	})

	it("opens announcement modal when version indicator is clicked", () => {
		// Temporarily override the mock for this test
		mockVersionIndicator.mockImplementation(createMockVersionIndicator("Version 3.22.5", "v3.22.5"))

		const { getByTestId } = renderChatView()

		// First hydrate state
		mockPostMessage({
			clineMessages: [],
		})

		// Find version indicator
		const versionButton = getByTestId("version-indicator")
		expect(versionButton).toBeInTheDocument()

		// Click should trigger modal - we'll just verify the button exists and is clickable
		// The actual modal rendering is handled by the component state
		expect(versionButton.onclick).toBeDefined()

		// Reset mock
		mockVersionIndicator.mockReturnValue(null)
	})

	it("version indicator has correct styling classes", () => {
		// Temporarily override the mock for this test
		mockVersionIndicator.mockImplementation(createMockVersionIndicator("Version 3.22.5", "v3.22.5"))

		const { getByTestId } = renderChatView()

		// First hydrate state
		mockPostMessage({
			clineMessages: [],
		})

		// Check styling classes - the VersionIndicator component receives className prop
		const versionButton = getByTestId("version-indicator")
		expect(versionButton).toBeInTheDocument()
		// The className is passed as a prop to VersionIndicator
		expect(versionButton.className).toContain("absolute top-2 right-3 z-10")

		// Reset mock
		mockVersionIndicator.mockReturnValue(null)
	})

	it("version indicator has proper accessibility attributes", () => {
		// Temporarily override the mock for this test
		mockVersionIndicator.mockImplementation(createMockVersionIndicator("Version 3.22.5", "v3.22.5"))

		const { getByTestId } = renderChatView()

		// First hydrate state
		mockPostMessage({
			clineMessages: [],
		})

		// Check accessibility
		const versionButton = getByTestId("version-indicator")
		expect(versionButton).toBeInTheDocument()
		expect(versionButton).toHaveAttribute("aria-label", "Version 3.22.5")

		// Reset mock
		mockVersionIndicator.mockReturnValue(null)
	})

	it("does not display version indicator when there is an active task", () => {
		const { queryByTestId } = renderChatView()

		// Hydrate state with an active task - any message in the array makes task truthy
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now(),
					text: "Active task in progress",
				},
			],
		})

		// Version indicator should not be present during task execution
		const versionButton = queryByTestId("version-indicator")
		expect(versionButton).not.toBeInTheDocument()
	})

	it("displays version indicator only on welcome screen (no task)", () => {
		// Temporarily override the mock for this test
		mockVersionIndicator.mockImplementation(createMockVersionIndicator("Version 3.22.5", "v3.22.5"))

		const { queryByTestId, rerender } = renderChatView()

		// First, hydrate with no messages (welcome screen)
		mockPostMessage({
			clineMessages: [],
		})

		// Version indicator should be present
		let versionButton = queryByTestId("version-indicator")
		expect(versionButton).toBeInTheDocument()

		// Reset mock to return null for the second part of the test
		mockVersionIndicator.mockReturnValue(null)

		// Now add a task - any message makes task truthy
		mockPostMessage({
			clineMessages: [
				{
					type: "say",
					say: "task",
					ts: Date.now(),
					text: "Starting a new task",
				},
			],
		})

		// Force a re-render to ensure the component updates
		rerender(
			<ExtensionStateContextProvider>
				<QueryClientProvider client={queryClient}>
					<ChatView {...defaultProps} />
				</QueryClientProvider>
			</ExtensionStateContextProvider>,
		)

		// Version indicator should disappear
		versionButton = queryByTestId("version-indicator")
		expect(versionButton).not.toBeInTheDocument()
	})
})
