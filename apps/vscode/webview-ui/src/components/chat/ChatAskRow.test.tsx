/**
 * ChatAskRow – ask-type row renderer (V12 方案5 extraction) smoke tests.
 * Verifies the extracted ask branch still renders followup questions and
 * plan-mode responses with their options.
 */

import type { ClineMessage } from "@shared/ExtensionMessage"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import ChatAskRow from "./ChatAskRow"

vi.mock("@/components/chat/OptionsButtons", () => ({
	OptionsButtons: ({ options, isActive, selected }: any) => (
		<div data-active={String(isActive)} data-selected={selected ?? ""} data-testid="options">
			{(options ?? []).join("|")}
		</div>
	),
}))

vi.mock("@/components/common/CopyButton", () => ({
	WithCopyButton: ({ textToCopy, children }: any) => (
		<div data-testid="copy" data-text={textToCopy ?? ""}>
			{children}
		</div>
	),
}))

vi.mock("./MarkdownRow", () => ({
	MarkdownRow: ({ markdown }: any) => <div data-testid="markdown">{markdown}</div>,
}))

vi.mock("./PlanCompletionOutputRow", () => ({
	default: ({ text }: any) => <div data-testid="plan-output">{text}</div>,
}))

vi.mock("./ErrorRow", () => ({
	default: () => <div data-testid="error-row" />,
}))

vi.mock("./NewTaskPreview", () => ({
	default: () => <div data-testid="new-task-preview" />,
}))

vi.mock("./ReportBugPreview", () => ({
	default: () => <div data-testid="report-bug-preview" />,
}))

vi.mock("./CompletionOutputRow", () => ({
	CompletionOutputRow: () => <div data-testid="completion-row" />,
}))

vi.mock("./QuoteButton", () => ({
	default: () => <div data-testid="quote-button" />,
}))

const baseProps = {
	contentRef: { current: null } as React.RefObject<HTMLDivElement>,
	handleMouseUp: vi.fn(),
	handleQuoteClick: vi.fn(),
	icon: null,
	inputValue: "",
	isLast: false,
	quoteButtonState: { visible: false, top: 0, left: 0, selectedText: "" },
	title: null,
}

function askMessage(ask: ClineMessage["ask"], text: string): ClineMessage {
	return { ts: 1, type: "ask", ask, text, partial: false }
}

describe("ChatAskRow (V12 方案5 extraction)", () => {
	it("renders a followup question with options", () => {
		const msg = askMessage(
			"followup",
			JSON.stringify({ question: "Which option?", options: ["A", "B"], selected: undefined }),
		)
		render(<ChatAskRow {...baseProps} isLast lastModifiedMessage={msg} message={msg} />)
		expect(screen.getByTestId("markdown")).toHaveTextContent("Which option?")
		expect(screen.getByTestId("options")).toHaveTextContent("A|B")
	})

	it("renders a plan_mode_respond response", () => {
		const msg = askMessage("plan_mode_respond", JSON.stringify({ response: "Here is my plan" }))
		render(<ChatAskRow {...baseProps} isLast lastModifiedMessage={msg} message={msg} />)
		expect(screen.getByTestId("plan-output")).toHaveTextContent("Here is my plan")
	})

	it("renders a new_task preview", () => {
		const msg = askMessage("new_task", "Build a widget")
		render(<ChatAskRow {...baseProps} message={msg} />)
		expect(screen.getByTestId("new-task-preview")).toBeInTheDocument()
	})

	it("renders a mistake_limit_reached error row", () => {
		const msg = askMessage("mistake_limit_reached", "{}")
		render(<ChatAskRow {...baseProps} message={msg} />)
		expect(screen.getByTestId("error-row")).toBeInTheDocument()
	})
})
