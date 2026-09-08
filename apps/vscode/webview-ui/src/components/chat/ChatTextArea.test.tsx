import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ChatTextArea from "./ChatTextArea"

const mocks = vi.hoisted(() => ({
	supportsImages: true as boolean | undefined,
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mode: "act",
		apiConfiguration: {},
		openRouterModels: {},
		platform: "darwin",
		localWorkflowToggles: {},
		globalWorkflowToggles: {},
		remoteWorkflowToggles: {},
		remoteConfigSettings: undefined,
		navigateToSettingsModelPicker: vi.fn(),
		mcpServers: [],
	}),
}))

vi.mock("@/context/PlatformContext", () => ({
	usePlatform: () => ({ togglePlanActKeys: "Meta+Shift+a" }),
}))

vi.mock("@/hooks/useNormalizedApiConfiguration", () => ({
	useNormalizedApiConfiguration: () => ({
		selectedProvider: "anthropic",
		selectedModelId: "test-model",
		selectedModelInfo: { supportsImages: mocks.supportsImages },
	}),
}))

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: {
		searchCommits: vi.fn(async () => ({ commits: [] })),
		searchFiles: vi.fn(async () => ({ results: [] })),
		getRelativePaths: vi.fn(async () => ({ paths: [] })),
	},
	StateServiceClient: {
		togglePlanActModeProto: vi.fn(async () => ({})),
	},
}))

vi.mock("../cline-rules/ClineRulesToggleModal", () => ({ default: () => null }))
vi.mock("./ServersToggleModal", () => ({ default: () => null }))

const WARNING = /does not support images/

function renderTextArea() {
	const setSelectedImages = vi.fn()
	render(
		<ChatTextArea
			activeQuote={null}
			inputValue=""
			onSelectFilesAndImages={vi.fn()}
			onSend={vi.fn()}
			placeholderText="Type a message"
			selectedFiles={[]}
			selectedImages={[]}
			sendingDisabled={false}
			setInputValue={vi.fn()}
			setSelectedFiles={vi.fn()}
			setSelectedImages={setSelectedImages}
			shouldDisableFilesAndImages={false}
		/>,
	)
	return { textarea: screen.getByPlaceholderText("Type a message"), setSelectedImages }
}

function pngFile() {
	return new File(["png"], "screenshot.png", { type: "image/png" })
}

function pasteImage(target: HTMLElement) {
	const file = pngFile()
	fireEvent.paste(target, {
		clipboardData: {
			items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
			getData: () => "",
		},
	})
}

function dropImage(target: HTMLElement) {
	fireEvent.drop(target, {
		dataTransfer: {
			files: [pngFile()],
			items: [],
			types: ["Files"],
			getData: () => "",
		},
	})
}

describe("ChatTextArea image attachments vs. model capability", () => {
	beforeEach(() => {
		mocks.supportsImages = true
	})

	it("refuses a pasted image and explains why when the model is text-only", () => {
		mocks.supportsImages = false
		const { textarea, setSelectedImages } = renderTextArea()

		pasteImage(textarea)

		expect(screen.getByText(WARNING)).toBeInTheDocument()
		expect(setSelectedImages).not.toHaveBeenCalled()
	})

	it("refuses a dropped image and explains why when the model is text-only", () => {
		mocks.supportsImages = false
		const { textarea, setSelectedImages } = renderTextArea()

		dropImage(textarea)

		expect(screen.getByText(WARNING)).toBeInTheDocument()
		expect(setSelectedImages).not.toHaveBeenCalled()
	})

	it("does not warn when the model supports images", () => {
		const { textarea } = renderTextArea()

		pasteImage(textarea)
		dropImage(textarea)

		expect(screen.queryByText(WARNING)).not.toBeInTheDocument()
	})

	it("fails open when the model's image support is unknown", () => {
		mocks.supportsImages = undefined
		const { textarea } = renderTextArea()

		pasteImage(textarea)

		expect(screen.queryByText(WARNING)).not.toBeInTheDocument()
	})
})
