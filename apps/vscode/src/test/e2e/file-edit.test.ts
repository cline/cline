import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { expect } from "@playwright/test"
import { E2E_WORKSPACE_TYPES, e2e } from "./utils/helpers"

// File edits are performed by the SDK's `editor` tool executor, which writes
// the file directly (Node fs) after the user approves the tool call — it does
// not stream the edit through DiffViewProvider, so no diff editor tab (e.g.
// "test.ts: Original ↔ Cline's Changes") opens. This test asserts the
// approval flow: approval ask row → Save → file modified on disk →
// turn-ending completion text.
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

				// Submit a file edit request. The mock server responds with a
				// structured `editor` tool call (path: test.ts, old/new text).
				const inputbox = sidebar.getByTestId("chat-input")
				await expect(inputbox).toBeVisible()
				await inputbox.fill("edit_request")
				await sidebar.getByTestId("send-button").click({ delay: 50 })

				// The edit tool requires approval (edit tools are never auto-approved
				// by default) — the ask row appears with the file path and diff.
				await sidebar.waitForSelector('span:has-text("Cline wants to edit this file:")')
				await expect(sidebar.getByText("test.ts").first()).toBeVisible()
				await expect(sidebar.getByRole("button", { name: "Reject" })).toBeVisible()

				// Approve the edit ("Save" is the primary button for file-edit asks).
				await sidebar.getByRole("button", { name: "Save", exact: true }).click({ delay: 50 })

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
