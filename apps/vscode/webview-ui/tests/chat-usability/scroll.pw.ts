import { expect, test } from "@playwright/test"

test("long plan: bounded copy, readable latest prompt, code scroll, selection and clipboard", async ({
	page,
	context,
}, testInfo) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"])
	await page.goto("/tests/chat-usability/")
	const scroller = page.locator('[data-virtuoso-scroller="true"]')
	await expect(page.getByRole("button", { name: "Copy response" })).toBeVisible()
	await scroller.evaluate((el) => {
		const pre = el.querySelector("pre")!
		el.scrollTop += pre.getBoundingClientRect().top - el.getBoundingClientRect().top + 400
	})
	const copy = page.getByRole("button", { name: "Copy response" })
	await expect.poll(async () => (await copy.boundingBox())!.y - (await scroller.boundingBox())!.y).toBeLessThan(30)
	const preview = page.getByRole("region", { name: "Latest submitted prompt" })
	await expect(preview).toContainText("Latest submitted prompt")
	await page.getByRole("button", { name: "Expand prompt" }).click()
	await expect(page.getByRole("button", { name: "Collapse prompt" })).toHaveAttribute("aria-expanded", "true")
	const pinBox = (await preview.boundingBox())!
	const scrollBox = (await scroller.boundingBox())!
	expect(pinBox.height).toBeLessThan(165)
	expect(pinBox.y + pinBox.height).toBeLessThanOrEqual(scrollBox.y)
	await page.screenshot({ path: testInfo.outputPath("expanded-prompt-copy.png") })
	await copy.click()
	await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("```text")
	expect(await page.evaluate(() => navigator.clipboard.readText())).not.toContain("Started:")
	const pre = page.locator("pre").first()
	await pre.evaluate((el) => {
		el.scrollLeft = 300
	})
	expect(await pre.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
	const codeCopy = page.getByRole("button", { name: "Copy code" }).first()
	await expect(codeCopy).toBeInViewport()
	const codeBox = (await codeCopy.boundingBox())!
	const responseBox = (await copy.boundingBox())!
	expect(codeBox.y).toBeGreaterThanOrEqual(responseBox.y + responseBox.height)
	await page.mouse.move(scrollBox.x + 30, scrollBox.y + 150)
	await page.mouse.down()
	await page.mouse.move(scrollBox.x + 190, scrollBox.y + 190, { steps: 5 })
	await page.mouse.up()
	expect(await page.evaluate(() => window.getSelection()?.toString().length)).toBeGreaterThan(0)
	await codeCopy.click()
	await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("line_0:")
	expect(await page.evaluate(() => navigator.clipboard.readText())).not.toContain("```")
	await page.getByRole("button", { name: "Collapse prompt" }).click()
	await page.getByRole("button", { name: "Jump to original" }).click()
	await expect(preview).toHaveCount(0)
	await scroller.evaluate((el) => {
		el.scrollTop = el.scrollHeight
	})
	await expect(copy).toBeInViewport()
	await page.evaluate(() => navigator.clipboard.writeText(""))
	await copy.focus()
	await page.keyboard.press("Enter")
	await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("```text")
	await page.getByRole("button", { name: "After plan", exact: true }).click()
	await scroller.evaluate((el) => {
		el.scrollTop = el.scrollHeight
	})
	const firstResponse = page.locator('[data-message-ts="1700000000002"]')
	await expect(firstResponse.getByRole("button", { name: "Copy response" })).not.toBeInViewport()
})

test("initial prompt, newest attachment-only submission, task switch and user-only time toggle", async ({ page }) => {
	await page.goto("/tests/chat-usability/")
	await page.getByRole("button", { name: "Initial only", exact: true }).click()
	const preview = page.getByRole("region", { name: "Latest submitted prompt" })
	await expect(preview).toContainText("Initial synthetic task")
	const scroller = page.locator('[data-virtuoso-scroller="true"]')
	await scroller.evaluate((el) => {
		el.scrollTop = 1600
	})
	await expect(page.getByRole("button", { name: "Copy response" })).toBeInViewport()
	await page.getByRole("button", { name: "Attachments", exact: true }).click()
	await scroller.evaluate((el) => {
		el.scrollTop = el.scrollHeight
	})
	await expect(preview).toContainText("[Attachments]")
	await page.getByRole("button", { name: "User times", exact: true }).click()
	await expect(page.locator("time").filter({ hasText: "Submitted:" })).toHaveCount(0)
	await expect(page.locator("time").filter({ hasText: "Started:" }).first()).toBeAttached()
	await expect(page.locator("time").filter({ hasText: "Finished:" }).first()).toBeAttached()
	await page.getByRole("button", { name: "Switch task", exact: true }).click()
	await expect(preview).toContainText("Other task")
	await expect(preview).not.toContainText("Latest submitted prompt")
})
