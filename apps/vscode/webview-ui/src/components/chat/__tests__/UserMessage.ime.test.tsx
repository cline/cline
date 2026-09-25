/**
 * UserMessage – IME composition Enter test
 * --------------------------------------------------
 * Confirm that sendMessageFromChatRow is not called
 * even if you confirm the IME conversion (Enter) in message re-edit mode.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const navigateToSettings = vi.fn()

vi.mock("@/context/ExtensionStateContext", () => ({
	__esModule: true,
	useExtensionState: () => ({
		state: {},
		dispatch: vi.fn(),
		navigateToSettings,
	}),
}))

vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		editMessageAndRegenerate: vi.fn(),
	},
}))

import { TaskServiceClient } from "@/services/grpc-client"
import UserMessage from "../UserMessage"

describe("UserMessage – IME composition handling", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.stubGlobal(
			"ResizeObserver",
			class ResizeObserver {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		)
		vi.mocked(TaskServiceClient.editMessageAndRegenerate).mockResolvedValue({})
	})

	it("does NOT send when IME composition Enter is pressed while editing", () => {
		const sendMessageFromChatRow = vi.fn()

		const { getByText } = render(
			<UserMessage images={[]} messageTs={Date.now()} sendMessageFromChatRow={sendMessageFromChatRow} text="変換テスト" />,
		)

		const editable = getByText("変換テスト") as HTMLElement
		editable.setAttribute("contenteditable", "true")
		editable.focus()

		fireEvent.compositionStart(editable)
		fireEvent.keyDown(editable, {
			key: "Enter",
			keyCode: 13,
			nativeEvent: { isComposing: true },
		})
		fireEvent.compositionEnd(editable)

		expect(sendMessageFromChatRow).not.toHaveBeenCalled()
	})

	it("cancels inline editing on Escape without bubbling to global task shortcuts", () => {
		const onWindowKeyDown = vi.fn()
		window.addEventListener("keydown", onWindowKeyDown)

		try {
			render(<UserMessage images={[]} messageTs={Date.now()} text="Original prompt" />)

			fireEvent.click(screen.getByText("Original prompt"))

			const textbox = screen.getByRole("textbox")
			fireEvent.change(textbox, { target: { value: "Edited prompt" } })

			fireEvent.keyDown(textbox, { key: "Escape" })

			expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
			expect(screen.getByText("Original prompt")).toBeInTheDocument()
			expect(onWindowKeyDown).not.toHaveBeenCalled()
		} finally {
			window.removeEventListener("keydown", onWindowKeyDown)
		}
	})

	it("labels reset actions and preserves their restore behavior", async () => {
		const user = userEvent.setup()
		render(
			<UserMessage
				files={["src/app.ts"]}
				images={["image.png"]}
				messageTs={123}
				text="Update this"
				workspaceRestoreAvailability={{ available: true }}
			/>,
		)

		await user.click(screen.getByText("Update this"))

		expect(screen.getByRole("button", { name: "Reset Chat" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Reset Code" })).toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "Reset Chat" }))
		await waitFor(() => expect(TaskServiceClient.editMessageAndRegenerate).toHaveBeenCalledTimes(1))
		expect(TaskServiceClient.editMessageAndRegenerate).toHaveBeenLastCalledWith(
			expect.objectContaining({
				messageTs: 123,
				text: "Update this",
				images: ["image.png"],
				files: ["src/app.ts"],
				restoreWorkspace: false,
			}),
		)

		await user.click(screen.getByText("Update this"))
		await user.click(screen.getByRole("button", { name: "Reset Code" }))
		await waitFor(() => expect(TaskServiceClient.editMessageAndRegenerate).toHaveBeenCalledTimes(2))
		expect(TaskServiceClient.editMessageAndRegenerate).toHaveBeenLastCalledWith(
			expect.objectContaining({
				messageTs: 123,
				text: "Update this",
				images: ["image.png"],
				files: ["src/app.ts"],
				restoreWorkspace: true,
			}),
		)
	})

	it("keeps Reset Chat enabled and disables Reset Code when checkpoints were off", async () => {
		const user = userEvent.setup()
		render(
			<UserMessage
				messageTs={123}
				text="Update this"
				workspaceRestoreAvailability={{ available: false, reason: "checkpoints_disabled" }}
			/>,
		)

		await user.click(screen.getByText("Update this"))

		expect(screen.getByRole("button", { name: "Reset Chat" })).toBeEnabled()
		const resetCode = screen.getByRole("button", { name: "Reset Code" })
		expect(resetCode).toBeDisabled()
		await user.hover(resetCode.parentElement as HTMLElement)
		expect(await screen.findByText(/No checkpoint is available for this message/)).toBeInTheDocument()
		await user.click(screen.getByText("Settings"))
		expect(navigateToSettings).toHaveBeenCalledWith("features")
	})

	it("explains when checkpoint creation was enabled but no checkpoint exists", async () => {
		const user = userEvent.setup()
		render(
			<UserMessage
				messageTs={123}
				text="Update this"
				workspaceRestoreAvailability={{ available: false, reason: "checkpoint_unavailable" }}
			/>,
		)

		await user.click(screen.getByText("Update this"))
		const resetCode = screen.getByRole("button", { name: "Reset Code" })
		expect(resetCode).toBeDisabled()
		await user.hover(resetCode.parentElement as HTMLElement)
		expect(await screen.findByText("No workspace checkpoint was created for this message.")).toBeInTheDocument()
	})

	it("removes an image before regenerating an edited message", async () => {
		const user = userEvent.setup()
		render(<UserMessage images={["image.png"]} messageTs={123} text="Update this" />)

		await user.click(screen.getByText("Update this"))
		const thumbnail = screen.getByAltText("Thumbnail image-1")
		fireEvent.mouseEnter(thumbnail.parentElement as HTMLElement)
		const removeButton = thumbnail.parentElement?.querySelector(".codicon-close")?.parentElement
		expect(removeButton).not.toBeNull()
		await user.click(removeButton as HTMLElement)

		expect(screen.queryByAltText("Thumbnail image-1")).not.toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "Reset Chat" }))
		await waitFor(() => expect(TaskServiceClient.editMessageAndRegenerate).toHaveBeenCalledTimes(1))
		expect(TaskServiceClient.editMessageAndRegenerate).toHaveBeenCalledWith(expect.objectContaining({ images: [] }))
	})
})
