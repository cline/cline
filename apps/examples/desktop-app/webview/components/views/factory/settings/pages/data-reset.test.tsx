// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	FactoryProjects,
	FactoryResetResult,
	FactoryStorage,
} from "@/lib/factory-settings-client";
import { FactorySettingsUnavailable } from "@/lib/factory-settings-client";
import { searchSettings } from "../nav";
import { SETTINGS_PAGES } from "../registry";
import { click, deadRows, renderSettingsPage, resource } from "../test-utils";
import { settingsPage } from "./data-reset";

const storage: FactoryStorage = {
	dataDir: "/Users/me/.cline/data/db",
	worktreesDir: "/Users/me/.cline/worktrees",
	artifactsDir: "/a",
	logsDir: "/l",
	worktrees: { count: 3, bytes: 1, finishedCount: 1, finishedBytes: 1 },
	artifactsBytes: 1,
	logsBytes: 1,
};

const projects: FactoryProjects = {
	userGuidanceChanged: [],
	projects: [30, 8].map((archived, index) => ({
		workspaceRoot: `/work/p${index}`,
		name: `p${index}`,
		cards: { open: 1, archived },
		stages: { file: "absent", total: 0, inUse: 0, awaiting: 0 },
		verification: "none",
		guidance: { roles: [], changed: [] },
		taskFiles: 0,
	})),
};

const counts: Record<string, FactoryResetResult> = {
	stage_trust: { what: "stage_trust", stages: 3, projects: 2 },
	verification_trust: { what: "verification_trust", projects: 2 },
	user_guidance: { what: "user_guidance", roles: ["builder", "reviewer"] },
	settings: { what: "settings", concurrency: 2, dailyCostUsd: 50 },
};

const reset = vi.fn(
	async ({ what, dryRun }: { what: string; dryRun?: boolean }) => ({
		...counts[what],
		what,
		dryRun: Boolean(dryRun),
	}),
) as never;

async function render(client = {}) {
	return renderSettingsPage(settingsPage, {
		client: { getStorage: async () => storage, reset, ...client },
		shell: { projectsSummary: resource(projects) },
	});
}

afterEach(() => {
	document.body.innerHTML = "";
	vi.clearAllMocks();
});

const dialog = () =>
	document.querySelector<HTMLElement>("[data-settings-dialog]");

describe("Data & reset page", () => {
	it("reads where the data lives only on Copy path, then shows it as selectable text, and no Finder button", async () => {
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
		const getStorage = vi.fn(async () => storage);
		const page = await render({ getStorage });
		// The Hub measures storage to report the folder: not on open.
		expect(getStorage).not.toHaveBeenCalled();
		expect(page.row("factoryData")?.querySelector("code")).toBeNull();
		expect(page.buttons(/Finder/)).toHaveLength(0);
		await click(page.buttons("Copy path")[0]);
		expect(getStorage).toHaveBeenCalledTimes(1);
		const path = page.row("factoryData")?.querySelector("code");
		expect(path?.textContent).toBe(storage.dataDir);
		expect(path?.className).toContain("select-all");
		expect(writeText).toHaveBeenCalledWith(storage.dataDir);
		expect(page.row("factoryData")?.textContent).toContain("Path copied.");
		// No card export command exists, so there is no Export row.
		expect(page.row("exportCards")).toBeNull();
		expect(deadRows(page.container)).toEqual([]);
		await page.unmount();
	});

	it("counts archived cards and opens the archive", async () => {
		const page = await render();
		expect(page.row("archivedCards")?.textContent).toContain(
			"38 archived cards stay searchable on the board.",
		);
		await click(page.buttons("Open archive")[0]);
		expect(page.shell.openArchive).toHaveBeenCalledTimes(1);
		await page.unmount();
	});

	it("degrades the data row when storage can't be read", async () => {
		const page = await render({
			getStorage: async () => {
				throw new FactorySettingsUnavailable("factory_get_storage", "build");
			},
		});
		await click(page.buttons("Copy path")[0]);
		expect(page.row("factoryData")).toBeNull();
		expect(page.text()).toContain(
			"Factory data location: not available in this build.",
		);
		await page.unmount();
	});

	it.each([
		[
			"Forget stage approvals…",
			"Forget stage approvals?",
			"Forget approvals",
			"forgetStageApprovals",
			"stage_trust",
			"3 stages in 2 projects will need your approval again.",
			"Forgot 3 stage approvals in 2 projects.",
		],
		[
			"Forget test setup approvals…",
			"Forget test setup approvals?",
			"Forget approvals",
			"forgetTestSetupApprovals",
			"verification_trust",
			"Test setup approvals in 2 projects will be forgotten.",
			"Forgot test setup approvals in 2 projects.",
		],
		[
			"Clear your guidance…",
			"Clear your guidance?",
			"Clear guidance",
			"clearGuidance",
			"user_guidance",
			"Your guidance for 2 roles will be removed: Builder, Code reviewer.",
			"Cleared your guidance for 2 roles.",
		],
		[
			"Reset Factory settings…",
			"Reset Factory settings?",
			"Reset settings",
			"resetSettings",
			"settings",
			"Hands-off becomes the default workflow; limits return to 2 at once and $50 a day.",
			"Factory settings are back to their defaults.",
		],
	])("%s confirms with the dry-run count, then resets once", async (label, question, verbLabel, row, what, count, done) => {
		const page = await render();
		const before = (reset as unknown as ReturnType<typeof vi.fn>).mock.calls
			.length;
		await click(page.row(row)?.querySelector("button"));
		expect(page.row(row)?.querySelector("button")?.textContent).toBe(label);
		const calls = (reset as unknown as ReturnType<typeof vi.fn>).mock.calls;
		// Opening the confirmation only counts.
		expect(calls.slice(before)).toEqual([[{ what, dryRun: true }]]);
		expect(dialog()?.querySelector("h2")?.textContent).toBe(question);
		expect(dialog()?.textContent).toContain(count);
		expect(dialog()?.textContent).toContain(
			"No cards or repository files are deleted.",
		);
		expect(document.activeElement?.textContent).toBe("Cancel");
		const verb = [...(dialog()?.querySelectorAll("button") ?? [])].at(-1);
		expect(verb?.textContent).toBe(verbLabel);
		await click(verb);
		expect(calls.slice(before)).toEqual([[{ what, dryRun: true }], [{ what }]]);
		expect(dialog()).toBeNull();
		expect(page.row(row)?.textContent).toContain(done);
		expect(page.shell.saved).toHaveBeenCalled();
		if (what === "settings") {
			expect(page.shell.workflow.presets.reload).toHaveBeenCalled();
			// The Limits page reads the reset values, not the ones from before.
			expect(page.shell.limits.reload).toHaveBeenCalled();
		} else expect(page.shell.projectsSummary.reload).toHaveBeenCalled();
		await page.unmount();
	});

	it("titles each danger row with its object and gives it one red, verb + object button", async () => {
		const page = await render();
		const zone = page.container.querySelector("[data-danger-zone]");
		const rows = [...(zone?.querySelectorAll("[data-setting]") ?? [])];
		expect(
			rows.map((row) => row.querySelector('[id$="-title"]')?.textContent),
		).toEqual([
			"Stage approvals",
			"Test setup approvals",
			"Your guidance",
			"Factory settings",
		]);
		const buttons = rows.map((row) => row.querySelectorAll("button"));
		expect(buttons.map((list) => list.length)).toEqual([1, 1, 1, 1]);
		const labels = buttons.map((list) => list[0]?.textContent ?? "");
		expect(new Set(labels).size).toBe(4);
		for (const [index, label] of labels.entries()) {
			expect(label).toMatch(/^\w+ \w.*…$/);
			const button = buttons[index]?.[0];
			expect(button?.className).toContain("text-error-text");
			expect(button?.className).not.toMatch(/(^|\s)border-destructive/);
		}
		await page.unmount();
	});

	it("finds both approval rows when searching for forget", () => {
		const entry = SETTINGS_PAGES.find(
			(page) => page.Page === settingsPage.Page,
		);
		const rows = searchSettings(entry ? [entry] : [], "forget").map(
			(hit) => hit.row,
		);
		expect(rows).toEqual(["forgetStageApprovals", "forgetTestSetupApprovals"]);
	});

	it("Cancel resets nothing", async () => {
		const page = await render();
		await click(page.row("clearGuidance")?.querySelector("button"));
		await click(page.buttons("Cancel")[0]);
		expect(dialog()).toBeNull();
		expect(
			(reset as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
				([args]) => !(args as { dryRun?: boolean }).dryRun,
			),
		).toEqual([]);
		await page.unmount();
	});

	it("keeps the verb disabled when the count fails", async () => {
		const page = await render({
			reset: async ({ dryRun }: { dryRun?: boolean }) => {
				if (dryRun) throw new Error("Factory could not reset: busy");
				return counts.settings;
			},
		});
		// The probe failed with an error (not unavailable): the zone stays.
		await click(page.row("resetSettings")?.querySelector("button"));
		expect(dialog()?.textContent).toContain("Factory could not reset: busy");
		const verb = [...(dialog()?.querySelectorAll("button") ?? [])].at(-1);
		expect(verb?.textContent).toBe("Reset settings");
		expect(verb?.hasAttribute("disabled")).toBe(true);
		await page.unmount();
	});

	it("shows one unavailable line for the danger zone when reset is missing", async () => {
		const page = await render({
			reset: async () => {
				throw new FactorySettingsUnavailable("factory_reset", "hub");
			},
		});
		expect(page.row("forgetStageApprovals")).toBeNull();
		expect(page.text()).toContain("Reset actions: update Cline to use these.");
		expect(deadRows(page.container)).toEqual([]);
		await page.unmount();
	});
});
