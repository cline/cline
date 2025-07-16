// npx vitest run src/components/chat/__tests__/ChatView.auto-approve-new.spec.tsx

import { render, waitFor } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"

import ChatView, { ChatViewProps } from "../ChatView"

// Mock vscode API
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock all problematic dependencies
vi.mock("rehype-highlight", () => ({
	default: () => () => {},
}))

vi.mock("hast-util-to-text", () => ({
	default: () => "",
}))

// Mock components that use ESM dependencies
vi.mock("../BrowserSessionRow", () => ({
	default: function MockBrowserSessionRow({ messages }: { messages: any[] }) {
		return <div data-testid="browser-session">{JSON.stringify(messages)}</div>
	},
}))

vi.mock("../ChatRow", () => ({
	default: function MockChatRow({ message }: { message: any }) {
		return <div data-testid="chat-row">{JSON.stringify(message)}</div>
	},
}))

vi.mock("../TaskHeader", () => ({
	default: function MockTaskHeader({ task }: { task: any }) {
		return <div data-testid="task-header">{JSON.stringify(task)}</div>
	},
}))

vi.mock("../AutoApproveMenu", () => ({
	default: () => null,
}))

vi.mock("@src/components/common/CodeBlock", () => ({
	default: () => null,
	CODE_BLOCK_BG_COLOR: "rgb(30, 30, 30)",
}))

vi.mock("@src/components/common/CodeAccordion", () => ({
	default: () => null,
}))

vi.mock("@src/components/chat/ContextMenu", () => ({
	default: () => null,
}))

// Mock window.postMessage to trigger state hydration
const mockPostMessage = (state: any) => {
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
				autoApprovalEnabled: true,
				...state,
			},
		},
		"*",
	)
}

const queryClient = new QueryClient()

const defaultProps: ChatViewProps = {
	isHidden: false,
	showAnnouncement: false,
	hideAnnouncement: () => {},
}

const renderChatView = (props: Partial<ChatViewProps> = {}) => {
	return render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>
				<ChatView {...defaultProps} {...props} />
			</QueryClientProvider>
		</ExtensionStateContextProvider>,
	)
}

describe("ChatView - New Auto Approval Logic Tests", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("Master auto-approval with no sub-options enabled", () => {
		it("should NOT auto-approve when autoApprovalEnabled is true but no sub-options are enabled", async () => {
			renderChatView()

			// First hydrate state with initial task
			mockPostMessage({
				autoApprovalEnabled: true, // Master is enabled
				alwaysAllowReadOnly: false, // But no sub-options are enabled
				alwaysAllowWrite: false,
				alwaysAllowExecute: false,
				alwaysAllowBrowser: false,
				alwaysAllowModeSwitch: false,
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
				],
			})

			// Then send a read tool ask message
			mockPostMessage({
				autoApprovalEnabled: true,
				alwaysAllowReadOnly: false,
				alwaysAllowWrite: false,
				alwaysAllowExecute: false,
				alwaysAllowBrowser: false,
				alwaysAllowModeSwitch: false,
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

			// Wait and verify no auto-approval message was sent
			await new Promise((resolve) => setTimeout(resolve, 100))
			expect(vscode.postMessage).not.toHaveBeenCalledWith({
				type: "askResponse",
				askResponse: "yesButtonClicked",
			})
		})

		it("should NOT auto-approve write operations when only master is enabled", async () => {
			renderChatView()

			// First hydrate state with initial task
			mockPostMessage({
				autoApprovalEnabled: true, // Master is enabled
				alwaysAllowReadOnly: false,
				alwaysAllowWrite: false, // Write is not enabled
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

			// Then send a write tool ask message
			mockPostMessage({
				autoApprovalEnabled: true,
				alwaysAllowReadOnly: false,
				alwaysAllowWrite: false,
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

			// Wait and verify no auto-approval message was sent
			await new Promise((resolve) => setTimeout(resolve, 100))
			expect(vscode.postMessage).not.toHaveBeenCalledWith({
				type: "askResponse",
				askResponse: "yesButtonClicked",
			})
		})

		it("should NOT auto-approve browser actions when only master is enabled", async () => {
			renderChatView()

			// First hydrate state with initial task
			mockPostMessage({
				autoApprovalEnabled: true, // Master is enabled
				alwaysAllowBrowser: false, // Browser is not enabled
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
				],
			})

			// Then send a browser action ask message
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

			// Wait and verify no auto-approval message was sent
			await new Promise((resolve) => setTimeout(resolve, 100))
			expect(vscode.postMessage).not.toHaveBeenCalledWith({
				type: "askResponse",
				askResponse: "yesButtonClicked",
			})
		})
	})

	describe("Correct auto-approval with sub-options enabled", () => {
		it("should auto-approve when master and at least one sub-option are enabled", async () => {
			renderChatView()

			// First hydrate state with initial task
			mockPostMessage({
				autoApprovalEnabled: true,
				alwaysAllowReadOnly: true, // At least one sub-option is enabled
				alwaysAllowWrite: false,
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
				],
			})

			// Then send a read tool ask message
			mockPostMessage({
				autoApprovalEnabled: true,
				alwaysAllowReadOnly: true,
				alwaysAllowWrite: false,
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

		it("should auto-approve when multiple sub-options are enabled", async () => {
			renderChatView()

			// First hydrate state with initial task
			mockPostMessage({
				autoApprovalEnabled: true,
				alwaysAllowReadOnly: true, // Multiple sub-options enabled
				alwaysAllowWrite: true,
				alwaysAllowExecute: true,
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

			// Then send a write tool ask message
			mockPostMessage({
				autoApprovalEnabled: true,
				alwaysAllowReadOnly: true,
				alwaysAllowWrite: true,
				alwaysAllowExecute: true,
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
	})

	describe("Edge cases", () => {
		it("should handle state transitions correctly", async () => {
			renderChatView()

			// Start with auto-approval properly configured
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

			// Then transition to a state where no sub-options are enabled
			mockPostMessage({
				autoApprovalEnabled: true, // Master still true
				alwaysAllowReadOnly: false, // All sub-options now false
				alwaysAllowWrite: false,
				alwaysAllowExecute: false,
				alwaysAllowBrowser: false,
				alwaysAllowModeSwitch: false,
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

			// Wait and verify no auto-approval message was sent
			await new Promise((resolve) => setTimeout(resolve, 100))
			expect(vscode.postMessage).not.toHaveBeenCalledWith({
				type: "askResponse",
				askResponse: "yesButtonClicked",
			})
		})

		it("should respect the hasEnabledOptions check in isAutoApproved", async () => {
			renderChatView()

			// Configure state where master is true but effective approval should be false
			mockPostMessage({
				autoApprovalEnabled: true,
				alwaysAllowReadOnly: false,
				alwaysAllowReadOnlyOutsideWorkspace: false,
				alwaysAllowWrite: false,
				alwaysAllowWriteOutsideWorkspace: false,
				alwaysAllowExecute: false,
				alwaysAllowBrowser: false,
				alwaysAllowModeSwitch: false,
				clineMessages: [
					{
						type: "say",
						say: "task",
						ts: Date.now() - 2000,
						text: "Initial task",
					},
				],
			})

			// Try various tool types - none should auto-approve
			const toolRequests = [
				{ tool: "readFile", path: "test.txt" },
				{ tool: "editedExistingFile", path: "test.txt" },
				{ tool: "executeCommand", command: "ls" },
				{ tool: "switchMode", mode: "architect" },
			]

			for (const toolRequest of toolRequests) {
				vi.clearAllMocks()

				mockPostMessage({
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: false,
					alwaysAllowWrite: false,
					alwaysAllowExecute: false,
					alwaysAllowBrowser: false,
					alwaysAllowModeSwitch: false,
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
							text: JSON.stringify(toolRequest),
							partial: false,
						},
					],
				})

				// Wait and verify no auto-approval for any tool type
				await new Promise((resolve) => setTimeout(resolve, 100))
				expect(vscode.postMessage).not.toHaveBeenCalledWith({
					type: "askResponse",
					askResponse: "yesButtonClicked",
				})
			}
		})
	})
})
