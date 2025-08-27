// npx vitest run src/components/chat/__tests__/ChatView.keyboard-fix.spec.tsx

import React from "react"
import { render, fireEvent } from "@/utils/test-utils"
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

// Mock use-sound hook
vi.mock("use-sound", () => ({
	default: vi.fn().mockImplementation(() => {
		return [vi.fn()]
	}),
}))

// Mock components
vi.mock("../BrowserSessionRow", () => ({
	default: () => null,
}))

vi.mock("../ChatRow", () => ({
	default: () => null,
}))

vi.mock("../AutoApproveMenu", () => ({
	default: () => null,
}))

vi.mock("../../common/VersionIndicator", () => ({
	default: () => null,
}))

vi.mock("@src/components/modals/Announcement", () => ({
	default: () => null,
}))

vi.mock("@src/components/welcome/RooCloudCTA", () => ({
	default: () => null,
}))

vi.mock("@src/components/welcome/RooTips", () => ({
	default: () => null,
}))

vi.mock("@src/components/welcome/RooHero", () => ({
	default: () => null,
}))

vi.mock("../common/TelemetryBanner", () => ({
	default: () => null,
}))

// Mock i18n
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
	initReactI18next: {
		type: "3rdParty",
		init: () => {},
	},
	Trans: ({ i18nKey }: { i18nKey: string }) => <>{i18nKey}</>,
}))

vi.mock("../ChatTextArea", () => {
	const ChatTextAreaComponent = React.forwardRef(function MockChatTextArea(
		_props: any,
		ref: React.ForwardedRef<{ focus: () => void }>,
	) {
		React.useImperativeHandle(ref, () => ({
			focus: vi.fn(),
		}))
		return <div data-testid="chat-textarea" />
	})

	return {
		default: ChatTextAreaComponent,
		ChatTextArea: ChatTextAreaComponent, // Export as named export too
	}
})

// Mock VSCode components
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
	VSCodeLink: ({ children, href }: any) => <a href={href}>{children}</a>,
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
				cloudIsAuthenticated: false,
				telemetrySetting: "enabled",
				mode: "code",
				customModes: [],
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

describe("ChatView - Keyboard Shortcut Fix for Dvorak", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("uses event.key instead of event.code for keyboard shortcuts", async () => {
		renderChatView()

		// Hydrate state
		mockPostMessage({
			mode: "code",
			customModes: [],
		})

		// Wait for component to be ready
		await new Promise((resolve) => setTimeout(resolve, 100))

		// Clear any initial calls
		vi.clearAllMocks()

		// Test 1: Period key should trigger mode switch
		fireEvent.keyDown(window, {
			key: ".",
			code: "Period",
			ctrlKey: true,
			metaKey: false,
			shiftKey: false,
		})

		// Wait for event to be processed
		await new Promise((resolve) => setTimeout(resolve, 50))

		// Check if mode switch was triggered
		const callsAfterPeriod = (vscode.postMessage as any).mock.calls
		const modeSwitchAfterPeriod = callsAfterPeriod.some((call: any[]) => call[0]?.type === "mode")
		expect(modeSwitchAfterPeriod).toBe(true)

		// Clear mocks
		vi.clearAllMocks()

		// Test 2: V key on physical Period key (Dvorak) should NOT trigger mode switch
		fireEvent.keyDown(window, {
			key: "v",
			code: "Period", // Physical key is Period, but produces 'v'
			ctrlKey: true,
			metaKey: false,
			shiftKey: false,
		})

		// Wait for event to be processed
		await new Promise((resolve) => setTimeout(resolve, 50))

		// Check that NO mode switch was triggered
		const callsAfterV = (vscode.postMessage as any).mock.calls
		const modeSwitchAfterV = callsAfterV.some((call: any[]) => call[0]?.type === "mode")
		expect(modeSwitchAfterV).toBe(false)
	})

	it("prevents default behavior when mode switch is triggered", () => {
		renderChatView()

		// Hydrate state
		mockPostMessage({
			mode: "code",
			customModes: [],
		})

		// Create a keyboard event with preventDefault spy
		const event = new KeyboardEvent("keydown", {
			key: ".",
			code: "Period",
			ctrlKey: true,
			metaKey: false,
			shiftKey: false,
			bubbles: true,
			cancelable: true,
		})

		const preventDefaultSpy = vi.spyOn(event, "preventDefault")

		// Dispatch the event
		window.dispatchEvent(event)

		// Verify preventDefault was called
		expect(preventDefaultSpy).toHaveBeenCalled()
	})

	it("works with Cmd key on Mac", async () => {
		renderChatView()

		// Hydrate state
		mockPostMessage({
			mode: "code",
			customModes: [],
		})

		// Wait for component to be ready
		await new Promise((resolve) => setTimeout(resolve, 100))

		// Clear any initial calls
		vi.clearAllMocks()

		// Test with Cmd key (Mac)
		fireEvent.keyDown(window, {
			key: ".",
			code: "Period",
			ctrlKey: false,
			metaKey: true, // Cmd key on Mac
			shiftKey: false,
		})

		// Wait for event to be processed
		await new Promise((resolve) => setTimeout(resolve, 50))

		// Check if mode switch was triggered
		const calls = (vscode.postMessage as any).mock.calls
		const modeSwitch = calls.some((call: any[]) => call[0]?.type === "mode")
		expect(modeSwitch).toBe(true)
	})

	it("handles Shift modifier for previous mode", async () => {
		renderChatView()

		// Hydrate state
		mockPostMessage({
			mode: "code",
			customModes: [],
		})

		// Wait for component to be ready
		await new Promise((resolve) => setTimeout(resolve, 100))

		// Clear any initial calls
		vi.clearAllMocks()

		// Test with Shift modifier
		fireEvent.keyDown(window, {
			key: ".",
			code: "Period",
			ctrlKey: true,
			metaKey: false,
			shiftKey: true, // Should go to previous mode
		})

		// Wait for event to be processed
		await new Promise((resolve) => setTimeout(resolve, 50))

		// Check if mode switch was triggered
		const calls = (vscode.postMessage as any).mock.calls
		const modeSwitch = calls.some((call: any[]) => call[0]?.type === "mode")
		expect(modeSwitch).toBe(true)
	})
})
