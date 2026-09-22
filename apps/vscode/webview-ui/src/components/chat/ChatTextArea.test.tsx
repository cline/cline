import { PlanActMode } from "@shared/proto/cline/state"
import { act, createEvent, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import ChatTextArea from "./ChatTextArea"

const mocks = vi.hoisted(() => ({
	supportsImages: true as boolean | undefined,
	navigateToSettingsModelPicker: vi.fn(),
	mode: "act" as "plan" | "act",
	togglePlanActModeProto: vi.fn(async (_request: { mode?: string | number }) => ({ value: false })),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mode: mocks.mode,
		apiConfiguration: {},
		openRouterModels: {},
		platform: "darwin",
		localWorkflowToggles: {},
		globalWorkflowToggles: {},
		remoteWorkflowToggles: {},
		remoteConfigSettings: undefined,
		navigateToSettingsModelPicker: mocks.navigateToSettingsModelPicker,
		mcpServers: [],
	}),
}))

vi.mock("@/context/PlatformContext", () => ({
	usePlatform: () => ({ togglePlanActKeys: "Meta+Shift+a" }),
}))

vi.mock("@/hooks/useNormalizedApiConfiguration", () => ({
	useNormalizedApiConfiguration: () => ({
		selectedProvider: "anthropic",
		selectedModelId: "text-only-model",
		selectedModelInfo: { supportsImages: mocks.supportsImages },
	}),
}))

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: {
		searchCommits: vi.fn(async () => ({ commits: [] })),
		searchFiles: vi.fn(async () => ({ results: [] })),
		getRelativePaths: vi.fn(async () => ({ paths: [] })),
		openImage: vi.fn(async () => ({})),
		openFile: vi.fn(async () => ({})),
	},
	StateServiceClient: {
		togglePlanActModeProto: (request: { mode?: string | number }) => mocks.togglePlanActModeProto(request),
	},
}))

vi.mock("../cline-rules/ClineRulesToggleModal", () => ({ default: () => null }))
vi.mock("./ServersToggleModal", () => ({ default: () => null }))

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo="

beforeAll(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			disconnect() {}
			observe() {}
			unobserve() {}
		},
	)
})

/** The mode toggle shows a Radix tooltip on focus, which measures itself with a ResizeObserver. */
function focusElement(element: HTMLElement) {
	act(() => {
		element.focus()
	})
}

function renderTextArea(selectedImages: string[] = []) {
	const setSelectedImages = vi.fn()
	const createTextAreaElement = () => (
		<ChatTextArea
			activeQuote={null}
			inputValue=""
			onSelectFilesAndImages={vi.fn()}
			onSend={vi.fn()}
			placeholderText="Type a message"
			selectedFiles={[]}
			selectedImages={selectedImages}
			sendingDisabled={false}
			setInputValue={vi.fn()}
			setSelectedFiles={vi.fn()}
			setSelectedImages={setSelectedImages}
			shouldDisableFilesAndImages={false}
		/>
	)
	const view = render(createTextAreaElement())
	return {
		textarea: screen.getByPlaceholderText("Type a message"),
		setSelectedImages,
		rerender: () => view.rerender(createTextAreaElement()),
	}
}

function pasteImage(target: HTMLElement) {
	const file = new File(["png"], "screenshot.png", { type: "image/png" })
	return fireEvent.paste(target, {
		clipboardData: {
			items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
			getData: () => "",
		},
	})
}

describe("ChatTextArea image attachments vs. model capability", () => {
	beforeEach(() => {
		mocks.supportsImages = true
		mocks.navigateToSettingsModelPicker.mockReset()
	})

	it("still takes the image attach path on paste for a text-only model, without a refusal message", () => {
		mocks.supportsImages = false
		const { textarea } = renderTextArea()

		const notCanceled = pasteImage(textarea)

		expect(notCanceled).toBe(false) // preventDefault: the paste was handled as an image, not as text
		expect(screen.queryByText(/ignored/)).not.toBeInTheDocument()
	})

	it("badges attached images and offers a model switch when the model is text-only", () => {
		mocks.supportsImages = false
		renderTextArea([PNG_DATA_URL, PNG_DATA_URL])

		const notice = screen.getByTestId("images-unsupported-notice")
		expect(notice).toHaveTextContent("text-only-model doesn't support images, so the 2 attached images will be ignored.")
		expect(screen.getAllByTestId("image-unsupported-badge")).toHaveLength(2)

		// A native button, so keyboard users get Enter/Space activation without extra handlers.
		const chooseModel = screen.getByRole("button", { name: "Choose an image-capable model" })
		expect(chooseModel.tagName).toBe("BUTTON")
		fireEvent.click(chooseModel)
		expect(mocks.navigateToSettingsModelPicker).toHaveBeenCalledWith({ targetSection: "api-config" })
	})

	it("uses singular wording for one image", () => {
		mocks.supportsImages = false
		renderTextArea([PNG_DATA_URL])

		expect(screen.getByTestId("images-unsupported-notice")).toHaveTextContent("the attached image will be ignored")
		expect(screen.getByTestId("images-unsupported-notice")).toHaveTextContent("or remove it.")
	})

	it("shows nothing extra when the model supports images", () => {
		renderTextArea([PNG_DATA_URL])

		expect(screen.queryByTestId("images-unsupported-notice")).not.toBeInTheDocument()
		expect(screen.queryByTestId("image-unsupported-badge")).not.toBeInTheDocument()
	})

	it("fails open when the model's image support is unknown", () => {
		mocks.supportsImages = undefined
		renderTextArea([PNG_DATA_URL])

		expect(screen.queryByTestId("images-unsupported-notice")).not.toBeInTheDocument()
	})

	it("shows nothing for a text-only model while no images are attached", () => {
		mocks.supportsImages = false
		renderTextArea()

		expect(screen.queryByTestId("images-unsupported-notice")).not.toBeInTheDocument()
	})
})

describe("ChatTextArea Plan/Act mode toggle accessibility", () => {
	beforeEach(() => {
		mocks.mode = "act"
		mocks.togglePlanActModeProto.mockClear()
	})

	it("exposes Plan/Act as a radiogroup with roving tabindex", () => {
		renderTextArea()

		const group = screen.getByRole("radiogroup", { name: "Plan or Act mode" })
		expect(group).toBeInTheDocument()

		const plan = screen.getByRole("radio", { name: "Plan mode" })
		const act = screen.getByRole("radio", { name: "Act mode" })

		expect(plan).toHaveAttribute("aria-checked", "false")
		expect(act).toHaveAttribute("aria-checked", "true")

		expect(plan).toHaveAttribute("tabindex", "-1")
		expect(act).toHaveAttribute("tabindex", "0")
	})

	it("moves focus and selection with arrow keys, without scrolling the chat", () => {
		const { rerender } = renderTextArea()

		const plan = screen.getByRole("radio", { name: "Plan mode" })
		const act = screen.getByRole("radio", { name: "Act mode" })
		focusElement(act)
		expect(act).toHaveFocus()

		// Arrow keys move focus to the other option and select it.
		const leftArrow = createEvent.keyDown(act, { key: "ArrowLeft" })
		fireEvent(act, leftArrow)

		expect(plan).toHaveFocus()
		expect(leftArrow.defaultPrevented).toBe(true)
		expect(mocks.togglePlanActModeProto).toHaveBeenCalledTimes(1)
		expect(mocks.togglePlanActModeProto.mock.calls[0][0].mode).toBe(PlanActMode.PLAN)

		// The extension reports the new mode back, so the roving tabindex follows the selection.
		mocks.mode = "plan"
		rerender()
		expect(plan).toHaveAttribute("tabindex", "0")

		const rightArrow = createEvent.keyDown(plan, { key: "ArrowRight" })
		fireEvent(plan, rightArrow)

		expect(act).toHaveFocus()
		expect(rightArrow.defaultPrevented).toBe(true)
		expect(mocks.togglePlanActModeProto).toHaveBeenCalledTimes(2)
		expect(mocks.togglePlanActModeProto.mock.calls[1][0].mode).toBe(PlanActMode.ACT)
	})

	it("does not scroll or toggle when Space is pressed on the selected option", () => {
		renderTextArea()

		const act = screen.getByRole("radio", { name: "Act mode" })
		focusElement(act)

		const spacePressed = createEvent.keyDown(act, { key: " " })
		fireEvent(act, spacePressed)

		expect(spacePressed.defaultPrevented).toBe(true)
		expect(mocks.togglePlanActModeProto).not.toHaveBeenCalled()
	})

	it("activates the focused option with Space and Enter, and ignores clicks on the selected option", () => {
		renderTextArea()

		const plan = screen.getByRole("radio", { name: "Plan mode" })
		const act = screen.getByRole("radio", { name: "Act mode" })

		fireEvent.click(act)
		expect(mocks.togglePlanActModeProto).not.toHaveBeenCalled()

		focusElement(plan)
		const spacePressed = createEvent.keyDown(plan, { key: " " })
		fireEvent(plan, spacePressed)

		expect(spacePressed.defaultPrevented).toBe(true)
		expect(mocks.togglePlanActModeProto).toHaveBeenCalledTimes(1)
		expect(mocks.togglePlanActModeProto.mock.calls[0][0].mode).toBe(PlanActMode.PLAN)

		const enterPressed = createEvent.keyDown(plan, { key: "Enter" })
		fireEvent(plan, enterPressed)

		expect(enterPressed.defaultPrevented).toBe(true)
		expect(mocks.togglePlanActModeProto).toHaveBeenCalledTimes(2)
	})

	it("follows the current mode with aria-checked and the roving tabindex", () => {
		const { rerender } = renderTextArea()

		mocks.mode = "plan"
		rerender()

		const plan = screen.getByRole("radio", { name: "Plan mode" })
		const act = screen.getByRole("radio", { name: "Act mode" })

		expect(plan).toHaveAttribute("aria-checked", "true")
		expect(plan).toHaveAttribute("tabindex", "0")
		expect(act).toHaveAttribute("aria-checked", "false")
		expect(act).toHaveAttribute("tabindex", "-1")
	})

	it("keeps a single tab stop and lets Tab leave the group", async () => {
		const user = userEvent.setup()
		renderTextArea()

		const plan = screen.getByRole("radio", { name: "Plan mode" })
		const act = screen.getByRole("radio", { name: "Act mode" })

		focusElement(act)
		expect(act).toHaveFocus()

		await user.tab()

		expect(document.activeElement).not.toBe(act)
		expect(document.activeElement).not.toBe(plan)
	})
})
