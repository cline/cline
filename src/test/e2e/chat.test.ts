import { expect } from "@playwright/test"
import { e2e, signin } from "./utils/helpers"

e2e("Chat", async ({ page, sidebar }) => {
	// Sign in
	await signin(sidebar)

	// Submit a message
	const inputbox = sidebar.getByTestId("chat-input")
	await expect(inputbox).toBeVisible()
	await inputbox.fill("Hello, Cline!")
	await expect(inputbox).toHaveValue("Hello, Cline!")
	await sidebar.getByTestId("send-button").click({ delay: 100 })
	await expect(inputbox).toHaveValue("")

	// Loading State initially
	await expect(sidebar.getByText("API Request...")).toBeVisible()

	// The request should eventually fail
	await expect(sidebar.getByText("API Streaming Failed")).toBeVisible()

	await expect(inputbox).toBeVisible()

	await expect(sidebar.getByRole("button", { name: "Retry" })).toBeVisible()
	await expect(sidebar.getByRole("button", { name: "Start New Task" })).toBeVisible()

	// Starting a new task should clear the current chat view and show the recent tasks
	await sidebar.getByRole("button", { name: "Start New Task" }).click()
	await expect(sidebar.getByText("API Streaming Failed")).not.toBeVisible()
	await expect(sidebar.getByText("Recent Tasks")).toBeVisible()
	await expect(sidebar.getByText("Hello, Cline!")).toBeVisible()
})
