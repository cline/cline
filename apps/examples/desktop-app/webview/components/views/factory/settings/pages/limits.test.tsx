// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderSettingsPage } from "../test-utils";
import { settingsPage } from "./limits";

vi.mock("@/components/ui/select", async () =>
	(await import("../test-utils")).nativeSelectModule(),
);

afterEach(() => {
	document.body.innerHTML = "";
});

describe("Limits & spending", () => {
	it("ends both cost rows at their field, with no suffix after the daily one", async () => {
		const page = await renderSettingsPage(settingsPage);
		for (const row of ["dailyCostUsd", "maxCostUsd"]) {
			const controls = page.row(row)?.lastElementChild;
			expect(controls?.lastElementChild?.querySelector("input")).not.toBeNull();
			expect(controls?.textContent).toBe("$");
		}
		await page.unmount();
	});

	it("names the built-in row apart from its group heading", async () => {
		const page = await renderSettingsPage(settingsPage);
		expect(
			page.container.querySelector("#builtInLimits-title")?.textContent,
		).toBe("Time and step limits");
		expect(
			[...page.container.querySelectorAll("h3")].map((h) => h.textContent),
		).toContain("Built-in limitscannot be changed");
		await page.unmount();
	});

	it("says what the built-in row shows and hides", async () => {
		const page = await renderSettingsPage(settingsPage);
		const toggle = page.row("builtInLimits")?.querySelector("button");
		expect(toggle?.textContent).toBe("Show the limits");
		await act(async () => toggle?.click());
		expect(toggle?.textContent).toBe("Hide the limits");
		await page.unmount();
	});
});
