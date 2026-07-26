import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { expect } from "@playwright/test"
import { E2E_WORKSPACE_TYPES, e2e } from "./utils/helpers"

// File edits are performed by the SDK's `editor` tool executor, which writes
// the file directly (Node fs) after the tool call is approved. It does not
// stream the edit into the real document, so the preview is read-only and the
// SDK executor applies the edit directly after explicit user approval. This
// test asserts that the review row blocks the write until Save is clicked.
e2e.describe("File Edit Approval", () => {
	E2E_WORKSPACE_TYPES.forEach(({ title, workspaceType }) => {
		e2e.extend({
			workspaceType,
		})(title, async ({ helper, sidebar, workspaceDir }) => {
			// The mock editor tool call targets "test.ts" relative to the session
			// cwd, which is the first workspace folder in both single-root and
			// multi-root workspaces (fixtures/workspace). The fixture file is
			// checked into git, so restore it after the (real) edit.
			const editedFilePath = path.join(workspaceDir, "test.ts")
			let originalFileContent: string | undefined

			try {
				originalFileContent = readFileSync(editedFilePath, "utf-8")

				await helper.signin(sidebar)

				// Submit a file edit request.
				// structured `editor` tool call (path: test.ts, old/new text).
				const inputbox = sidebar.getByTestId("chat-input")
				await expect(inputbox).toBeVisible()
				await inputbox.fill("edit_request")
				await sidebar.getByTestId("send-button").click({ delay: 50 })

				// The ask row and manual approval controls must be shown before
				// the SDK is allowed to apply the edit.
				await sidebar.waitForSelector('span:has-text("Bedrock Coder wants to edit this file:")')
				await expect(sidebar.getByText("test.ts").first()).toBeVisible()
				await expect(sidebar.getByRole("button", { name: "Reject" })).toBeVisible()
				const saveButton = sidebar.getByRole("button", { name: "Save", exact: true })
				await expect(saveButton).toBeVisible()
				expect(readFileSync(editedFilePath, "utf-8")).toBe(originalFileContent)
				await saveButton.click()

				// The SDK executes the editor tool and sends the tool result back to
				// the (mock) model, which replies with turn-ending completion text.
				await expect(sidebar.getByText("I successfully replaced")).toBeVisible({ timeout: 30_000 })

				// The edit was actually applied to the file on disk.
				expect(readFileSync(editedFilePath, "utf-8")).toContain('export const name = "bedrockCoder"')
			} finally {
				// Skip the restore when the initial read failed — there is
				// nothing to restore and the read error is the real failure.
				if (originalFileContent !== undefined) {
					writeFileSync(editedFilePath, originalFileContent, "utf-8")
				}
			}
		})
	})
})
