import { expect } from "@playwright/test"
import { e2e, signin } from "./utils/helpers"

e2e("Chat - can send messages and switch between modes", async ({ page, sidebar }) => {
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
	await expect(sidebar.getByText("API Request Failed")).toBeVisible()

	await expect(inputbox).toBeVisible()

	await expect(sidebar.getByRole("button", { name: "Retry" })).toBeVisible()
	await expect(sidebar.getByRole("button", { name: "Start New Task" })).toBeVisible()

	// Starting a new task should clear the current chat view and show the recent tasks
	await sidebar.getByRole("button", { name: "Start New Task" }).click()
	await expect(sidebar.getByText("API Request Failed")).not.toBeVisible()
	await expect(sidebar.getByText("Recent Tasks")).toBeVisible()
	await expect(sidebar.getByText("Hello, Cline!")).toBeVisible()

	// Makes sure the act and plan switches are working correctly
	// Aria-checked state should be true for Act and false for Plan
	const actButton = sidebar.getByRole("switch", { name: "Act" })
	const planButton = sidebar.getByRole("switch", { name: "Plan" })

	await expect(actButton).toBeChecked()
	await expect(planButton).not.toBeChecked()

	await actButton.click()
	await expect(actButton).not.toBeChecked()
	await expect(planButton).toBeChecked()

	await sidebar.getByTestId("chat-input").fill("Plan mode submission")
	await sidebar.getByTestId("send-button").click()

	await expect(sidebar.getByText("API Request Failed")).toBeVisible()
})
