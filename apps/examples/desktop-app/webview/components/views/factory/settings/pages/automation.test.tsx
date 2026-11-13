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

describe("Automation: rows", () => {
	it("never repeats a group heading as a row title", async () => {
		const page = await renderSettingsPage(settingsPage, {
			shell: { limits: limitsWith(true) },
		});
		const headings = [...page.container.querySelectorAll("h3")].map((heading) =>
			heading.textContent?.trim(),
		);
		const titles = [...page.container.querySelectorAll('[id$="-title"]')].map(
			(title) => title.textContent?.trim(),
		);
		expect(headings.length).toBeGreaterThan(0);
		expect(titles.filter((title) => headings.includes(title))).toEqual([]);
		await page.unmount();
	});

	it("toggles a switch from its row title", async () => {
		const page = await renderSettingsPage(settingsPage);
		const title = page.container.querySelector<HTMLLabelElement>(
			"#watchPullRequest-title",
		);
		expect(title?.tagName).toBe("LABEL");
		expect(title?.textContent).toBe("Keep the PR passing");
		await click(title);
		expect(page.shell.workflow.commit).toHaveBeenCalledWith(
			expect.objectContaining({ watchPullRequest: false }),
			"watchPullRequest",
		);
		await page.unmount();
	});
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

describe("Automation: Split large work into parts", () => {
	it("reads the Hub's value and saves a change through the limits command", async () => {
		const { limits } = fakeShell();
		const page = await renderSettingsPage(settingsPage, {
			client: {
				setLimits: async () => ({
					supported: true,
					concurrency: 2,
					splitLargeWork: false,
				}),
			},
			shell: {
				limits: {
					...limits,
					limits: { supported: true, concurrency: 2, splitLargeWork: true },
				} as SettingsShell["limits"],
			},
		});
		const control = page.container.querySelector<HTMLInputElement>(
			'[data-setting="splitLargeWork"] [role="switch"]',
		);
		expect(page.row("splitLargeWork")?.textContent).toContain(
			"Split large work into parts",
		);
		expect(control?.checked).toBe(true);
		await click(control);
		expect(page.shell.client.setLimits).toHaveBeenCalledWith({
			splitLargeWork: false,
		});
		expect(control?.checked).toBe(false);
		expect(deadRows(page.container)).toEqual([]);
		await page.unmount();
	});
});
