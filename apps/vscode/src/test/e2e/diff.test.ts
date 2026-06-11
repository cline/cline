import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { expect } from "@playwright/test"
import { E2E_WORKSPACE_TYPES, e2e } from "./utils/helpers"

// NOTE ON BEHAVIORAL DIFFERENCE FROM THE CLASSIC EXTENSION:
// Under the SDK runtime, file edits are performed by the SDK's `editor` tool
// executor, which writes the file directly (Node fs) after the user approves
// the tool call — it does NOT stream the edit through DiffViewProvider, so no
// "test.ts: Original ↔ Cline's Changes" diff tab opens. This test asserts the
// SDK edit flow instead: approval ask row → Save → file modified on disk →
// turn-ending completion text.
e2e.describe("Diff Editor", () => {
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

				const inputbox = sidebar.getByTestId("chat-input")
				await expect(inputbox).toBeVisible()

				await inputbox.fill("[diff.test.ts] Hello, Cline!")
				await expect(inputbox).toHaveValue("[diff.test.ts] Hello, Cline!")
				await sidebar.getByTestId("send-button").click()
				await expect(inputbox).toHaveValue("")

				// Wait for the (mock) agent turn to finish before navigating away —
				// the task is persisted to SDK session history when the turn completes,
				// and the mock server delays this response by 500ms.
				await expect(sidebar.getByText("mock Cline API response")).toBeVisible()

				// Back to home page with history. The turn ends in "awaiting_followup"
				// (the mock response has no attempt_completion), so the footer shows no
				// "Start New Task" button — use the header "New Task" button instead,
				// same as chat.test.ts.
				await sidebar.getByRole("button", { name: "New Task", exact: true }).first().click()
				await expect(sidebar.getByText("Recent")).toBeVisible()
				await expect(sidebar.getByText("Hello, Cline!")).toBeVisible() // History with the previous sent message

				// Submit a file edit request. The mock server responds with a
				// structured `editor` tool call (path: test.ts, old/new text).
				await sidebar.getByTestId("chat-input").click()
				await sidebar.getByTestId("chat-input").fill("edit_request")
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
