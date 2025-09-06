import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

e2e("Chat - can send messages and switch between modes", async ({ helper, page, sidebar }) => {
	// Sign in
	await helper.signin(sidebar)

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

e2e("Chat - slash commands preserve following text", async ({ helper, page, sidebar }) => {
	// Sign in
	await helper.signin(sidebar)

	const inputbox = sidebar.getByTestId("chat-input")
	await expect(inputbox).toBeVisible()

	// Type partial slash command to trigger menu
	await inputbox.focus()
	await inputbox.type("/new")

	// Wait for menu to be visible and select first option with Tab
	await inputbox.press("Tab")
	await expect(inputbox).toHaveValue("/newtask ")

	// Add following text to verify it works correctly
	await inputbox.type("following text should be preserved")
	await expect(inputbox).toHaveValue("/newtask following text should be preserved")
})

e2e("Chat - @ mentions preserve following text", async ({ helper, page, sidebar }) => {
	// Sign in
	await helper.signin(sidebar)

	const inputbox = sidebar.getByTestId("chat-input")
	await expect(inputbox).toBeVisible()

	// Type partial @ mention to trigger menu
	await inputbox.focus()
	await inputbox.type("@prob")

	// Wait for menu to be visible and select first option with Tab
	await inputbox.press("Tab")
	await expect(inputbox).toHaveValue("@problems ")

	// Add following text to verify it works correctly
	await inputbox.type("following text should be preserved")
	await expect(inputbox).toHaveValue("@problems following text should be preserved")
})

e2e("Chat - partial slash command completion preserves text", async ({ helper, page, sidebar }) => {
	// Sign in
	await helper.signin(sidebar)

	const inputbox = sidebar.getByTestId("chat-input")
	await expect(inputbox).toBeVisible()

	// Type partial slash command and complete it
	await inputbox.focus()
	await inputbox.type("/new")

	// Complete the command with Tab
	await inputbox.press("Tab")
	await expect(inputbox).toHaveValue("/newtask ")

	// Add following text after completion
	await inputbox.type("some important text after")
	await expect(inputbox).toHaveValue("/newtask some important text after")
})

e2e("Chat - partial @ mention completion preserves text", async ({ helper, page, sidebar }) => {
	// Sign in
	await helper.signin(sidebar)

	const inputbox = sidebar.getByTestId("chat-input")
	await expect(inputbox).toBeVisible()

	// Type partial @ mention and complete it
	await inputbox.focus()
	await inputbox.type("@prob")

	// Complete the mention with Tab
	await inputbox.press("Tab")
	await expect(inputbox).toHaveValue("@problems ")

	// Add following text after completion
	await inputbox.type("important content follows")
	await expect(inputbox).toHaveValue("@problems important content follows")
})
