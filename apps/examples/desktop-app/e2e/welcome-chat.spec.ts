import { expect, test } from "@playwright/test";
import {
	latestWhatsNew,
	WHATS_NEW_STORAGE_KEY,
} from "../webview/lib/whats-new";

test("shows the welcome chat view", async ({ page }) => {
	await page.addInitScript(
		({ whatsNewId, whatsNewStorageKey }) => {
			window.localStorage.setItem(
				"cline.code.onboarding.v1",
				JSON.stringify({ completedAt: new Date().toISOString() }),
			);
			if (whatsNewId)
				window.localStorage.setItem(whatsNewStorageKey, whatsNewId);
		},
		{
			whatsNewId: latestWhatsNew()?.id,
			whatsNewStorageKey: WHATS_NEW_STORAGE_KEY,
		},
	);
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

	const providerOptions = page.getByRole("option");
	await expect(providerOptions).not.toHaveCount(0);
	await expect(
		page.getByRole("option", {
			name: /^Cline(?: Usage-Billing)?$/,
			exact: true,
		}),
	).toBeVisible();
});
