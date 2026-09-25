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

	// Makes sure the act and plan switches are working correctly
	// Aria-checked state should be true for Act and false for Plan
	const actButton = sidebar.getByRole("switch", { name: "Act" })
	const planButton = sidebar.getByRole("switch", { name: "Plan" })

	// Act button should be active. It doesn't have c
	await expect(actButton).toHaveAttribute("aria-checked", "true")
	await expect(planButton).not.toHaveAttribute("aria-checked", "true")

	await planButton.click()
	await expect(planButton).toHaveAttribute("aria-checked", "true")
	await expect(actButton).not.toHaveAttribute("aria-checked", "true")

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

e2e.describe("Checkpoint settings", () => {
	e2e.describe.configure({ timeout: 180_000 })

	e2e("enabling during a turn applies before the next message", async ({ helper, page, sidebar }) => {
		await helper.signin(sidebar)

		const openSettings = async () => {
			await page.getByRole("button", { name: "Settings" }).first().click()
			await expect(sidebar.getByText("Settings", { exact: true })).toBeVisible()
			await sidebar.getByRole("tab").nth(1).click()
			await expect(sidebar.getByText("Feature Settings", { exact: true })).toBeVisible()
		}
		const checkpoints = sidebar.getByText("Checkpoints", { exact: true }).locator("..").getByRole("switch")
		const checkpointSetting = sidebar.locator("#checkpoints-setting")
		const inputbox = sidebar.getByTestId("chat-input")

		await openSettings()
		await expect(checkpoints).toBeChecked()
		await checkpoints.click()
		await expect(checkpoints).not.toBeChecked()
		await sidebar.getByRole("button", { name: "Done" }).click()

		await inputbox.fill("message without checkpoints")
		await sidebar.getByTestId("send-button").click()
		await expect(sidebar.getByText("mock Cline API response")).toBeVisible({ timeout: 30_000 })

		await inputbox.fill("follow-up without checkpoints")
		await sidebar.getByTestId("send-button").click()
		await expect(sidebar.getByText("mock Cline API response").last()).toBeVisible({ timeout: 30_000 })

		await sidebar
			.locator('[title="Edit and regenerate from here"]')
			.filter({ hasText: "follow-up without checkpoints" })
			.click()
		const resetCode = sidebar.getByRole("button", { name: "Reset Code" })
		await expect(resetCode).toHaveAttribute("aria-disabled", "true")
		await resetCode.focus()
		await resetCode.press("Enter")
		await sidebar.getByText("Settings", { exact: true }).click()
		await expect(sidebar.getByText("Feature Settings", { exact: true })).toBeVisible()
		await expect(sidebar.locator('[data-slot="popover-content"]')).not.toBeVisible()
		await expect(checkpoints).not.toBeChecked()
		await expect(checkpoints).toBeFocused()
		await expect(checkpointSetting).toHaveClass(/settings-target-highlight/)
		await sidebar.getByRole("button", { name: "Done" }).click()
		await sidebar.getByTestId("virtuoso-item-list").getByRole("button", { name: "Cancel" }).click()

		await inputbox.fill("checkpoint_rebuild_probe")
		await sidebar.getByTestId("send-button").click()
		await expect(sidebar.getByText("Checkpoint rebuild probe", { exact: false })).toBeVisible({ timeout: 30_000 })

		await openSettings()
		await checkpoints.click()
		await expect(checkpoints).toBeChecked()
		await sidebar.getByRole("button", { name: "Done" }).click()

		await inputbox.fill("follow-up after enabling checkpoints")
		await sidebar.getByTestId("send-button").click()
		await expect(sidebar.getByText("follow-up after enabling checkpoints")).toBeVisible({ timeout: 30_000 })
		await expect(sidebar.getByText("Checkpoint-enabled follow-up reached the rebuilt session.")).toBeVisible({
			timeout: 30_000,
		})

		await sidebar
			.locator('[title="Edit and regenerate from here"]')
			.filter({ hasText: "follow-up after enabling checkpoints" })
			.click()
		const checkpointedResetCode = sidebar.getByRole("button", { name: "Reset Code" })
		await expect(checkpointedResetCode).not.toHaveAttribute("aria-disabled")
		await expect(checkpointedResetCode).toBeEnabled()
	})
})
