import React from "react"
import { render } from "@/utils/test-utils"
import { describe, it, expect, beforeEach, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { ChatRowContent } from "../ChatRow"

// Mock i18n
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"chat:slashCommand.wantsToRun": "Roo wants to run slash command:",
				"chat:slashCommand.didRun": "Roo ran slash command:",
			}
			return translations[key] || key
		},
	}),
	Trans: ({ i18nKey, children }: { i18nKey: string; children?: React.ReactNode }) => {
		return <>{children || i18nKey}</>
	},
	initReactI18next: {
		type: "3rdParty",
		init: () => {},
	},
}))

// Mock VSCodeBadge
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeBadge: ({ children, ...props }: { children: React.ReactNode }) => <span {...props}>{children}</span>,
}))

const queryClient = new QueryClient()

const renderChatRowWithProviders = (message: any, isExpanded = false) => {
	return render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>
				<ChatRowContent
					message={message}
					isExpanded={isExpanded}
					isLast={false}
					isStreaming={false}
					onToggleExpand={mockOnToggleExpand}
					onSuggestionClick={mockOnSuggestionClick}
					onBatchFileResponse={mockOnBatchFileResponse}
					onFollowUpUnmount={mockOnFollowUpUnmount}
					isFollowUpAnswered={false}
				/>
			</QueryClientProvider>
		</ExtensionStateContextProvider>,
	)
}

const mockOnToggleExpand = vi.fn()
const mockOnSuggestionClick = vi.fn()
const mockOnBatchFileResponse = vi.fn()
const mockOnFollowUpUnmount = vi.fn()

describe("ChatRow - runSlashCommand tool", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should display runSlashCommand ask message with command only", () => {
		const message: any = {
			type: "ask",
			ask: "tool",
			ts: Date.now(),
			text: JSON.stringify({
				tool: "runSlashCommand",
				command: "init",
			}),
			partial: false,
		}

		const { getByText } = renderChatRowWithProviders(message)

		expect(getByText("Roo wants to run slash command:")).toBeInTheDocument()
		expect(getByText("/init")).toBeInTheDocument()
	})

	it("should display runSlashCommand ask message with command and args", () => {
		const message: any = {
			type: "ask",
			ask: "tool",
			ts: Date.now(),
			text: JSON.stringify({
				tool: "runSlashCommand",
				command: "test",
				args: "focus on unit tests",
				description: "Run project tests",
				source: "project",
			}),
			partial: false,
		}

		const { getByText } = renderChatRowWithProviders(message, true) // Pass true to expand

		expect(getByText("Roo wants to run slash command:")).toBeInTheDocument()
		expect(getByText("/test")).toBeInTheDocument()
		expect(getByText("Arguments:")).toBeInTheDocument()
		expect(getByText("focus on unit tests")).toBeInTheDocument()
		expect(getByText("Run project tests")).toBeInTheDocument()
		expect(getByText("project")).toBeInTheDocument()
	})

	it("should display runSlashCommand say message", () => {
		const message: any = {
			type: "say",
			say: "tool",
			ts: Date.now(),
			text: JSON.stringify({
				tool: "runSlashCommand",
				command: "deploy",
				source: "global",
			}),
			partial: false,
		}

		const { getByText } = renderChatRowWithProviders(message)

		expect(getByText("Roo ran slash command:")).toBeInTheDocument()
		expect(getByText("/deploy")).toBeInTheDocument()
		expect(getByText("global")).toBeInTheDocument()
	})
})
