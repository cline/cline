import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

e2e("Chat - accepts input and switches between modes", async ({ sidebar }) => {
	const inputbox = sidebar.getByTestId("chat-input")
	await expect(inputbox).toBeVisible()

	// Makes sure the act and plan switches are working correctly.
	const actButton = sidebar.getByRole("switch", { name: "Act" })
	const planButton = sidebar.getByRole("switch", { name: "Plan" })

	await expect(actButton).toHaveAttribute("aria-checked", "true")
	await expect(planButton).not.toHaveAttribute("aria-checked", "true")

	await planButton.click()
	await expect(planButton).toHaveAttribute("aria-checked", "true")
	await expect(actButton).not.toHaveAttribute("aria-checked", "true")

	// Slash commands preserve following text.
	await expect(inputbox).toHaveValue("")
	await inputbox.fill("/newt")
	await inputbox.focus()
	await sidebar.getByText("newtask", { exact: false }).click()
	await expect(inputbox).toHaveValue("/newtask ")

	await inputbox.pressSequentially("following text should be preserved")
	await expect(inputbox).toHaveValue("/newtask following text should be preserved")

	// Mentions preserve following text.
	await inputbox.fill("")
	await inputbox.fill("@prob")
	await sidebar.getByText("Problems", { exact: false }).first().click()
	await expect(inputbox).toHaveValue("@problems ")

	await inputbox.pressSequentially("following text should be preserved")
	await expect(inputbox).toHaveValue("@problems following text should be preserved")
})
