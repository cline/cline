// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, deadRows, fakeShell, renderSettingsPage } from "../test-utils";
import type { SettingsShell } from "../types";
import { settingsPage } from "./automation";

vi.mock("@/components/ui/select", async () =>
	(await import("../test-utils")).nativeSelectModule(),
);

/** The shell's limits as the Hub reported them, with or without the field. */
function limitsWith(duplicateCheck?: boolean): SettingsShell["limits"] {
	const { limits } = fakeShell();
	return {
		...limits,
		limits: {
			supported: true,
			concurrency: 2,
			...(duplicateCheck === undefined ? {} : { duplicateCheck }),
		},
	} as SettingsShell["limits"];
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("Automation: Check for duplicates when work is filed", () => {
	it("reads the Hub's value and saves a change through the limits command", async () => {
		const page = await renderSettingsPage(settingsPage, {
			client: {
				setLimits: async () => ({
					supported: true,
					concurrency: 2,
					duplicateCheck: false,
				}),
			},
			shell: { limits: limitsWith(true) },
		});
		const control = page.container.querySelector<HTMLInputElement>(
			'[data-setting="duplicateCheck"] [role="switch"]',
		);
		expect(page.row("duplicateCheck")?.textContent).toContain(
			"Check for duplicates when work is filed",
		);
		expect(control?.checked).toBe(true);
		await click(control);
		expect(page.shell.client.setLimits).toHaveBeenCalledWith({
			duplicateCheck: false,
		});
		expect(control?.checked).toBe(false);
		expect(page.shell.saved).toHaveBeenCalled();
		expect(deadRows(page.container)).toEqual([]);
		await page.unmount();
	});

	it("puts the switch back when the save fails", async () => {
		const page = await renderSettingsPage(settingsPage, {
			client: {
				setLimits: async () => {
					throw new Error("Factory could not change it");
				},
			},
			shell: { limits: limitsWith(false) },
		});
		const control = page.container.querySelector<HTMLInputElement>(
			'[data-setting="duplicateCheck"] [role="switch"]',
		);
		expect(control?.checked).toBe(false);
		await click(control);
		expect(control?.checked).toBe(false);
		expect(page.row("duplicateCheck")?.textContent).toContain(
			"Factory could not change it",
		);
		await page.unmount();
	});

	it("degrades to one line when the Hub's reply has no duplicateCheck", async () => {
		const page = await renderSettingsPage(settingsPage, {
			shell: { limits: limitsWith(undefined) },
		});
		expect(page.row("duplicateCheck")).toBeNull();
		expect(page.text()).toContain(
			"Duplicate check: update Cline to change this.",
		);
		expect(deadRows(page.container)).toEqual([]);
		await page.unmount();
	});
});
