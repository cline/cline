import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { expect } from "@playwright/test"
import { E2E_WORKSPACE_TYPES, e2e } from "./utils/helpers"

// File edits are performed by the SDK's `editor` tool executor, which writes
// the file directly (Node fs) after the tool call is approved. It does not
// stream the edit into the real document, so the preview is read-only and the
// SDK executor applies the edit directly. This test asserts the default
// auto-approval flow: ask row appears without manual approval buttons, the file
// is modified on disk, and the turn-ending completion text appears.
e2e.describe("File Edit Auto-Approval", () => {
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

				// Submit a file edit request. The mock server responds with a
				// structured `editor` tool call (path: test.ts, old/new text).
				const inputbox = sidebar.getByTestId("chat-input")
				await expect(inputbox).toBeVisible()
				await inputbox.fill("edit_request")
				await sidebar.getByTestId("send-button").click({ delay: 50 })

				// File edits are auto-approved by default. The ask row appears with
				// the file path, but no manual approval buttons are shown.
				await sidebar.waitForSelector('span:has-text("Cline wants to edit this file:")')
				await expect(sidebar.getByText("test.ts").first()).toBeVisible()
				await expect(sidebar.getByRole("button", { name: "Reject" })).not.toBeVisible()
				await expect(sidebar.getByRole("button", { name: "Save", exact: true })).not.toBeVisible()

				// The SDK executes the editor tool and sends the tool result back to
				// the (mock) model, which replies with turn-ending completion text.
				await expect(sidebar.getByText("I successfully replaced")).toBeVisible({ timeout: 30_000 })

				// The edit was actually applied to the file on disk.
				expect(readFileSync(editedFilePath, "utf-8")).toContain('export const name = "cline"')
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
