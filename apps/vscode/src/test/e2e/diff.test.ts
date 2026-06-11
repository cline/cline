import { expect } from "@playwright/test"
import { E2E_WORKSPACE_TYPES, e2e } from "./utils/helpers"

e2e.describe("Diff Editor", () => {
	E2E_WORKSPACE_TYPES.forEach(({ title, workspaceType }) => {
		e2e.extend({
			workspaceType,
		})(title, async ({ helper, sidebar }) => {
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

			// Submit a file edit request
			await sidebar.getByTestId("chat-input").click()
			await sidebar.getByTestId("chat-input").fill("edit_request")
			await sidebar.getByTestId("send-button").click({ delay: 50 })

			// Wait for the sidebar to load the file edit request
			await sidebar.waitForSelector('span:has-text("Cline wants to edit this file:")')

			// The SDK-backed path renders a pending edit approval before the user saves it.
			await expect(sidebar.getByText(/\/test\.ts/)).toBeVisible()
			await expect(sidebar.getByRole("button", { name: "Save" })).toBeVisible()
			await expect(sidebar.getByRole("button", { name: "Reject" })).toBeVisible()
		})
	})
})
