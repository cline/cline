import { expect } from "@playwright/test"
import { E2E_WORKSPACE_TYPES, e2e } from "./utils/helpers"

// E2E: verify that dropping a non-image file shows an attachment thumbnail
e2e.describe("Chat - file drop shows attachment thumbnail", () => {
	E2E_WORKSPACE_TYPES.forEach(({ title, workspaceType }) => {
		e2e.extend({ workspaceType })(title, async ({ helper, sidebar }) => {
			// Sign in (BYOK flow)
			await helper.signin(sidebar)

			// Target the drop zone that has the onDrop handler
			const dropZone = sidebar.getByTestId("chat-dropzone")
			await expect(dropZone).toBeVisible()

			// Prepare a small text file payload
			const fileName = "sample-drop.txt"
			const fileMime = "text/plain"
			const fileContent = "Hello from e2e file drop!"

			// Create a DataTransfer with our File entirely within the frame context
			const dataTransfer = await sidebar.evaluateHandle(
				(params: { name: string; mime: string; content: string }) => {
					const { name, mime, content } = params
					const dt = new DataTransfer()
					const bytes = new TextEncoder().encode(content)
					const blob = new Blob([bytes], { type: mime })
					const file = new File([blob], name, { type: mime })
					dt.items.add(file)
					return dt
				},
				{ name: fileName, mime: fileMime, content: fileContent },
			)

			// Fire the drag/drop sequence on the drop zone with the same DataTransfer
			await dropZone.dispatchEvent("dragenter", { dataTransfer })
			await dropZone.dispatchEvent("dragover", { dataTransfer })
			await dropZone.dispatchEvent("drop", { dataTransfer })

			// Expect a file thumbnail to appear with the file name
			// Thumbnails render the file name in a small label beneath the file icon
			await expect(sidebar.getByText(fileName).first()).toBeVisible({ timeout: 7000 })

			// Also ensure at least one file icon is visible
			await expect(sidebar.locator(".codicon-file").first()).toBeVisible()
		})
	})
})
