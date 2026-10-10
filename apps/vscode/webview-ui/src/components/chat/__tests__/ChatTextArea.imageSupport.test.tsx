/**
 * ChatTextArea – Image support feedback tests
 * --------------------------------------------------
 * Verifies that visible feedback is shown when the user pastes or drops
 * an image and the selected model does not support images.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach } from "vitest"

// --- Mocks ---

const mockSetSelectedImages = vi.fn()
const mockSupportsImages = { value: true }

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mode: "act",
		apiConfiguration: {},
		openRouterModels: {},
		platform: "mac",
		localWorkflowToggles: {},
		globalWorkflowToggles: {},
		remoteWorkflowToggles: {},
		remoteConfigSettings: {},
		navigateToSettingsModelPicker: vi.fn(),
		mcpServers: [],
	}),
}))

vi.mock("@/components/settings/utils/providerUtils", () => ({
	normalizeApiConfiguration: () => ({
		selectedModelInfo: { supportsImages: mockSupportsImages.value },
		selectedProvider: "anthropic",
		selectedModelId: "claude-sonnet-4-20250514",
	}),
	getModeSpecificFields: () => ({}),
}))

vi.mock("@/context/PlatformContext", () => ({
	usePlatform: () => ({
		togglePlanActKeys: "Meta+Shift+a",
	}),
}))

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: {
		searchFiles: vi.fn().mockResolvedValue({ results: [] }),
		searchCommits: vi.fn().mockResolvedValue({ commits: [] }),
		getRelativePaths: vi.fn().mockResolvedValue({ paths: [] }),
	},
	StateServiceClient: {
		togglePlanActModeProto: vi.fn().mockResolvedValue({ value: false }),
	},
}))

vi.mock("@/utils/hooks", () => ({
	useMetaKeyDetection: () => [false, "⌘"],
	useShortcut: vi.fn(),
}))

vi.mock("@/utils/platformUtils", () => ({
	isSafari: false,
}))

// Mock styled-components to avoid issues with .withConfig
vi.mock("styled-components", async (importOriginal) => {
	const actual = await importOriginal<typeof import("styled-components")>()
	return {
		...actual,
		default: actual.default,
	}
})

// Mock the sub-components that aren't relevant to these tests
vi.mock("../ServersToggleModal", () => ({
	default: () => <div data-testid="servers-toggle-modal" />,
}))

vi.mock("../../cline-rules/ClineRulesToggleModal", () => ({
	default: () => <div data-testid="cline-rules-toggle-modal" />,
}))

vi.mock("@/components/common/Thumbnails", () => ({
	default: () => <div data-testid="thumbnails" />,
}))

vi.mock("@/components/chat/ContextMenu", () => ({
	default: () => <div data-testid="context-menu" />,
}))

vi.mock("@/components/chat/SlashCommandMenu", () => ({
	default: () => <div data-testid="slash-command-menu" />,
}))

vi.mock("@/components/ui/tooltip", () => ({
	Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))

vi.mock("react-textarea-autosize", () => ({
	default: ({ ref, ...props }: any) => <textarea {...props} />,
}))

import ChatTextArea from "../ChatTextArea"

// Helper to create a DataTransfer-like object with image items
function createImageClipboardData() {
	const file = new File(["fake-image-data"], "test.png", { type: "image/png" })
	const item = {
		kind: "file",
		type: "image/png",
		getAsFile: () => file,
	}
	return {
		items: [item],
		getData: () => "",
		types: ["Files"],
		files: [file],
	}
}

function createImageDropData() {
	const file = new File(["fake-image-data"], "test.png", { type: "image/png" })
	return {
		items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
		getData: () => "",
		types: ["Files"],
		files: [file],
	}
}

const defaultProps = {
	inputValue: "",
	activeQuote: null,
	setInputValue: vi.fn(),
	sendingDisabled: false,
	placeholderText: "Type a message...",
	selectedFiles: [] as string[],
	selectedImages: [] as string[],
	setSelectedImages: mockSetSelectedImages,
	setSelectedFiles: vi.fn(),
	onSend: vi.fn(),
	onSelectFilesAndImages: vi.fn(),
	shouldDisableFilesAndImages: false,
	onHeightChange: vi.fn(),
	onFocusChange: vi.fn(),
}

describe("ChatTextArea – Image support feedback", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockSupportsImages.value = true
	})

	it("shows 'model does not support images' error when pasting an image with supportsImages=false", async () => {
		mockSupportsImages.value = false

		render(<ChatTextArea {...defaultProps} />)

		const textarea = screen.getByTestId("chat-input")
		const clipboardData = createImageClipboardData()

		const pasteEvent = new Event("paste", { bubbles: true, cancelable: true })
		Object.defineProperty(pasteEvent, "clipboardData", { value: clipboardData })

		fireEvent(textarea, pasteEvent)

		await waitFor(() => {
			expect(screen.getByText("The selected model does not support images")).toBeInTheDocument()
		})

		// Should NOT call setSelectedImages
		expect(mockSetSelectedImages).not.toHaveBeenCalled()
	})

	it("prevents default on paste when supportsImages=false and image is pasted", async () => {
		mockSupportsImages.value = false

		render(<ChatTextArea {...defaultProps} />)

		const textarea = screen.getByTestId("chat-input")
		const clipboardData = createImageClipboardData()

		const pasteEvent = new Event("paste", { bubbles: true, cancelable: true })
		Object.defineProperty(pasteEvent, "clipboardData", { value: clipboardData })

		fireEvent(textarea, pasteEvent)

		// The event should have been prevented (default prevented)
		expect(pasteEvent.defaultPrevented).toBe(true)
	})

	it("shows 'model does not support images' error when dropping an image with supportsImages=false", async () => {
		mockSupportsImages.value = false

		render(<ChatTextArea {...defaultProps} />)

		const container = screen.getByTestId("chat-input").closest(".relative")!
		const dropData = createImageDropData()

		fireEvent.drop(container, { dataTransfer: dropData })

		await waitFor(() => {
			expect(screen.getByText("The selected model does not support images")).toBeInTheDocument()
		})

		// Should NOT call setSelectedImages
		expect(mockSetSelectedImages).not.toHaveBeenCalled()
	})

	it("adds image normally when pasting with supportsImages=true", async () => {
		mockSupportsImages.value = true

		render(<ChatTextArea {...defaultProps} />)

		const textarea = screen.getByTestId("chat-input")
		const file = new File(["fake-image-data"], "test.png", { type: "image/png" })

		// Mock FileReader
		const mockFileReader = {
			readAsDataURL: vi.fn(),
			onloadend: null as any,
			result: "data:image/png;base64,fakedata",
			error: null,
		}
		vi.spyOn(window, "FileReader").mockImplementation(() => mockFileReader as any)

		// Mock Image for dimension check
		const mockImage = {
			onload: null as any,
			onerror: null as any,
			src: "",
			naturalWidth: 100,
			naturalHeight: 100,
		}
		vi.spyOn(window, "Image").mockImplementation(() => mockImage as any)

		const clipboardData = {
			items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
			getData: () => "",
		}

		const pasteEvent = new Event("paste", { bubbles: true, cancelable: true })
		Object.defineProperty(pasteEvent, "clipboardData", { value: clipboardData })

		fireEvent(textarea, pasteEvent)

		// Trigger FileReader callback
		if (mockFileReader.readAsDataURL.mock.calls.length > 0) {
			mockFileReader.onloadend()
		}

		// Trigger Image onload
		await waitFor(() => {
			if (mockImage.onload) {
				mockImage.onload()
			}
		})

		// Should call setSelectedImages since model supports images
		await waitFor(() => {
			expect(mockSetSelectedImages).toHaveBeenCalled()
		})

		// Should NOT show the error message
		expect(screen.queryByText("The selected model does not support images")).not.toBeInTheDocument()

		vi.restoreAllMocks()
	})

	it("shows 'Files other than images are currently disabled' for non-image file drops", async () => {
		mockSupportsImages.value = true

		render(<ChatTextArea {...defaultProps} />)

		const container = screen.getByTestId("chat-input").closest(".relative")!

		// Simulate dragging a non-image file
		const dragData = {
			items: [{ kind: "file", type: "application/pdf", getAsFile: () => new File([""], "doc.pdf", { type: "application/pdf" }) }],
			getData: () => "",
			types: ["Files"],
			files: [],
		}

		fireEvent.dragEnter(container, { dataTransfer: dragData })

		await waitFor(() => {
			expect(screen.getByText("Files other than images are currently disabled")).toBeInTheDocument()
		})
	})
})
