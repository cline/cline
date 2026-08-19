import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

e2e("Chat - can send messages and switch between modes", async ({ helper, sidebar }) => {
	// Sign in
	await helper.signin(sidebar)

	// Submit a message
	const inputbox = sidebar.getByTestId("chat-input")
	await expect(inputbox).toBeVisible()
	await inputbox.fill("Hello, Cline!")
	await expect(inputbox).toHaveValue("Hello, Cline!")
	await sidebar.getByTestId("send-button").click()
	await expect(inputbox).toHaveValue("")

	// Wait for the (mock) agent turn to finish before navigating away — the task
	// is persisted to SDK session history when the turn completes, so clicking
	// "New Task" mid-turn races the history write and "Recent" may not show.
	await expect(sidebar.getByText("mock Cline API response")).toBeVisible()

	// Starting a new task should clear the current chat view and show the recent tasks
	await sidebar.getByRole("button", { name: "New Task", exact: true }).first().click()
	await expect(sidebar.getByText("Recent")).toBeVisible()
	await expect(sidebar.getByText("Hello, Cline!")).toBeVisible()

	// Makes sure the Plan/Act mode switch is working correctly. Querying by role
	// and accessible name keeps the switch semantics under test, not just the state.
	const modeSwitch = sidebar.getByRole("switch", { name: "Act mode" })

	// Act mode is active by default, so the switch reads as checked.
	await expect(modeSwitch).toHaveAttribute("aria-checked", "true")

	// Focus check comes first: toggling refocuses the composer and would race it.
	await modeSwitch.focus()
	await expect(modeSwitch).toBeFocused()

	// Space and Enter both toggle the mode.
	await modeSwitch.press("Space")
	await expect(modeSwitch).toHaveAttribute("aria-checked", "false")

	// Toggling hands focus back to the composer, so wait for that before pressing
	// again: otherwise the refocus can land between press()'s focus and its keydown.
	await expect(inputbox).toBeFocused()
	await modeSwitch.press("Enter")
	await expect(modeSwitch).toHaveAttribute("aria-checked", "true")

	// A pointer click toggles it too, leaving Plan mode active.
	await modeSwitch.click()
	await expect(modeSwitch).toHaveAttribute("aria-checked", "false")

	// === slash commands preserve following text ===
	await expect(inputbox).toHaveValue("")
	// Type partial slash command to trigger menu
	await inputbox.fill("/newt")

	// Wait for menu to be visible and click on menu item
	await inputbox.focus()
	await sidebar.getByText("newtask", { exact: false }).click()
	await expect(inputbox).toHaveValue("/newtask ")

	// Add following text to verify it works correctly
	await inputbox.pressSequentially("following text should be preserved")
	await expect(inputbox).toHaveValue("/newtask following text should be preserved")

	// === @ mentions preserve following text ===
	await inputbox.fill("")
	await expect(inputbox).toHaveValue("")

	// Type partial @ mention to trigger menu
	await inputbox.fill("@prob")

	// Wait for menu to be visible and click on menu item
	await sidebar.getByText("Problems", { exact: false }).first().click()
	await expect(inputbox).toHaveValue("@problems ")

	// Add following text to verify it works correctly
	await inputbox.pressSequentially("following text should be preserved")
	await expect(inputbox).toHaveValue("@problems following text should be preserved")
})
