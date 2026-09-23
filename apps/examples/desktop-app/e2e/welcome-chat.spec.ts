import { expect, test } from "@playwright/test";

test("shows the welcome chat view", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"cline.code.onboarding.v1",
			JSON.stringify({ completedAt: new Date().toISOString() }),
		);
	});
	await page.goto("/");

	await expect(
		page.getByRole("heading", { name: "What would you like to build?" }),
	).toBeVisible();
	const promptInput = page.locator("textarea");
	await expect(promptInput).toBeVisible();
	await expect(promptInput).toBeFocused();

	const providerSelector = page.getByRole("button", { name: /^Provider:/ });
	await expect(providerSelector).toBeVisible();
	await providerSelector.click();
	await expect(
		page.getByRole("option", { name: /^Cline ?Pass$/, exact: true }),
	).toBeVisible();
});
