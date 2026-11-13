// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	FactoryProjectSummary,
	FactoryProjects,
	FactoryResetWhat,
} from "@/lib/factory-settings-client";
import { FactorySettingsUnavailable } from "@/lib/factory-settings-client";
import { click, deadRows, renderSettingsPage, resource } from "../test-utils";
import { settingsPage } from "./projects";

vi.mock("@/components/ui/select", async () =>
	(await import("../test-utils")).nativeSelectModule(),
);

const cline: FactoryProjectSummary = {
	workspaceRoot: "/Users/me/code/cline",
	name: "cline",
	remote: "https://github.com/cline/cline.git",
	defaultBranch: "main",
	cards: { open: 12, archived: 4 },
	stages: { file: "present", total: 2, inUse: 1, awaiting: 1 },
	verification: "proposed",
	guidance: { roles: ["builder", "reviewer"], changed: ["builder"] },
	taskFiles: 4,
};
const api: FactoryProjectSummary = {
	workspaceRoot: "/Users/me/code/acme-api",
	name: "acme-api",
	remote: "git@github.com:acme/api.git",
	defaultBranch: "main",
	cards: { open: 3, archived: 9 },
	stages: { file: "present", total: 1, inUse: 1, awaiting: 0 },
	verification: "in_use",
	guidance: { roles: [], changed: [] },
	taskFiles: 0,
};
const sketchbook: FactoryProjectSummary = {
	workspaceRoot: "/Users/me/code/sketchbook",
	name: "sketchbook",
	cards: { open: 1, archived: 0 },
	stages: { file: "absent", total: 0, inUse: 0, awaiting: 0 },
	verification: "none",
	guidance: { roles: [], changed: [] },
	taskFiles: 0,
};
const summary = (projects = [cline, api, sketchbook]) =>
	resource<FactoryProjects>({ projects, userGuidanceChanged: [] });

afterEach(() => {
	document.body.innerHTML = "";
});

const openButton = (
	page: { row: (id: string) => HTMLElement | null },
	id: string,
) => page.row(id)?.querySelector("button");

describe("Projects list", () => {
	it("shows each project's location, state and worst status", async () => {
		const page = await renderSettingsPage(settingsPage, {
			shell: { projectsSummary: summary() },
		});
		expect(page.text()).toContain("3 projects");
		const first = page.row("project-cline")?.textContent ?? "";
		expect(first).toContain(
			"~/code/cline · github.com/cline/cline · PRs target main",
		);
		expect(first).toContain(
			"12 open cards · 2 stages · test setup proposed · guidance for Builder, Code reviewer",
		);
		expect(first).toContain("1 stage needs approval");
		expect(page.row("project-acme-api")?.textContent).toContain(
			"github.com/acme/api",
		);
		expect(page.row("project-acme-api")?.textContent).toContain("Ready");
		expect(page.row("project-sketchbook")?.textContent).toContain(
			"1 open card · no stages · no test setup · no guidance",
		);
		expect(page.row("project-sketchbook")?.textContent).toContain(
			"Nothing set up",
		);
		expect(deadRows(page.container)).toEqual([]);
		await page.unmount();
	});

	it("offers Ask Factory when there are no projects", async () => {
		const page = await renderSettingsPage(settingsPage, {
			shell: { projects: [], projectsSummary: summary([]) },
		});
		expect(page.text()).toContain("No projects yet.");
		await click(page.buttons("Ask Factory")[0]);
		expect(page.shell.newWork).toHaveBeenCalledTimes(1);
		expect(deadRows(page.container)).toEqual([]);
		await page.unmount();
	});

	it("lists the shell's projects by path when the summary is unavailable", async () => {
		const page = await renderSettingsPage(settingsPage, {
			shell: {
				projects: ["/Users/me/code/cline"],
				projectsSummary: {
					...resource<FactoryProjects>(undefined),
					unavailable: "hub",
				},
			},
		});
		expect(
			page.container.querySelector("[data-settings-unavailable]")?.textContent,
		).toContain("Update Cline");
		expect(page.row("project-cline")?.textContent).toContain("~/code/cline");
		await click(openButton(page, "project-cline"));
		await click(openButton(page, "projectStages"));
		expect(page.shell.open).toHaveBeenCalledWith({
			page: "stages",
			project: "/Users/me/code/cline",
		});
		expect(deadRows(page.container)).toEqual([]);
		await page.unmount();
	});
});

describe("Project detail", () => {
	it("links to the project's Stages, Test setup and Guidance with the project set", async () => {
		const page = await renderSettingsPage(settingsPage, {
			shell: { projectsSummary: summary() },
		});
		await click(openButton(page, "project-cline"));
		expect(page.text()).toContain("cline");
		expect(page.row("projectStages")?.textContent).toContain(
			"2 stages: 1 in use, 1 needs approval.",
		);
		expect(page.row("projectTestSetup")?.textContent).toContain(
			"Needs approval",
		);
		expect(page.row("projectGuidance")?.textContent).toContain(
			"Builder, Code reviewer. Builder was changed outside Factory.",
		);
		expect(page.row("taskFiles")?.textContent).toContain(
			"4 files in .cline/tasks become cards when they change.",
		);
		expect(page.text()).not.toContain("Show in Finder");
		await click(openButton(page, "projectStages"));
		await click(openButton(page, "projectTestSetup"));
		await click(openButton(page, "projectGuidance"));
		expect(page.shell.open).toHaveBeenNthCalledWith(1, {
			page: "stages",
			project: cline.workspaceRoot,
		});
		expect(page.shell.open).toHaveBeenNthCalledWith(2, {
			page: "verification",
			project: cline.workspaceRoot,
		});
		expect(page.shell.open).toHaveBeenNthCalledWith(3, {
			page: "guidance",
			project: cline.workspaceRoot,
			role: "builder",
		});
		expect(deadRows(page.container)).toEqual([]);
		// Back returns to the list.
		await click(page.buttons("Back to Projects")[0]);
		expect(page.row("project-sketchbook")).not.toBeNull();
		await page.unmount();
	});

	it("opens on a deep link's project", async () => {
		const page = await renderSettingsPage(settingsPage, {
			shell: { projectsSummary: summary() },
			focus: { project: sketchbook.workspaceRoot },
		});
		expect(page.row("projectStages")?.textContent).toContain("None.");
		expect(page.row("forgetApprovals")?.textContent).toContain(
			"Forget approvals for sketchbook",
		);
		await page.unmount();
	});

	it("forgets approvals only after a confirmation that states the dry run's count", async () => {
		const reset = vi.fn(async (args: { what: string; dryRun?: boolean }) =>
			args.what === "stage_trust"
				? {
						what: "stage_trust" as const,
						dryRun: args.dryRun,
						stages: 2,
						projects: 1,
					}
				: {
						what: "verification_trust" as const,
						dryRun: args.dryRun,
						projects: 1,
					},
		);
		const projectsSummary = summary();
		const page = await renderSettingsPage(settingsPage, {
			client: { reset },
			shell: { projectsSummary },
			focus: { project: cline.workspaceRoot },
		});
		await click(page.buttons("Forget approvals…")[0]);
		expect(reset.mock.calls.map(([args]) => args)).toEqual([
			{ what: "stage_trust", workspaceRoot: cline.workspaceRoot, dryRun: true },
			{
				what: "verification_trust",
				workspaceRoot: cline.workspaceRoot,
				dryRun: true,
			},
		]);
		const dialog = document.querySelector("[data-settings-confirm]");
		expect(dialog?.textContent).toContain("Forget approvals for cline?");
		expect(dialog?.textContent).toContain(
			"2 stage approvals and the test setup approval will be forgotten.",
		);
		await click(page.buttons("Forget approvals")[0]);
		expect(reset.mock.calls.slice(2).map(([args]) => args)).toEqual([
			{ what: "stage_trust", workspaceRoot: cline.workspaceRoot },
			{ what: "verification_trust", workspaceRoot: cline.workspaceRoot },
		]);
		expect(page.shell.saved).toHaveBeenCalledTimes(1);
		expect(projectsSummary.reload).toHaveBeenCalledTimes(1);
		expect(page.row("forgetApprovals")?.textContent).toContain(
			"Forgot 2 stage approvals and the test setup approval.",
		);
		await page.unmount();
	});

	it("says so instead of confirming when nothing is approved, and cancel changes nothing", async () => {
		const reset = vi.fn(async (args: { what: FactoryResetWhat }) => ({
			what: args.what,
			dryRun: true,
			stages: 0,
			projects: 0,
		}));
		const page = await renderSettingsPage(settingsPage, {
			client: { reset },
			shell: { projectsSummary: summary() },
			focus: { project: sketchbook.workspaceRoot },
		});
		await click(page.buttons("Forget approvals…")[0]);
		expect(document.querySelector("[data-settings-confirm]")).toBeNull();
		expect(page.row("forgetApprovals")?.textContent).toContain(
			"Nothing in sketchbook is approved, so there is nothing to forget.",
		);
		expect(reset).toHaveBeenCalledTimes(2);
		expect(
			reset.mock.calls.every(([args]) => (args as { dryRun?: boolean }).dryRun),
		).toBe(true);
		await page.unmount();
	});

	it("reports an unavailable reset under the row", async () => {
		const page = await renderSettingsPage(settingsPage, {
			client: {
				reset: async () => {
					throw new FactorySettingsUnavailable("factory_reset", "hub");
				},
			},
			shell: { projectsSummary: summary() },
			focus: { project: cline.workspaceRoot },
		});
		await click(page.buttons("Forget approvals…")[0]);
		await act(async () => {});
		expect(
			page.row("forgetApprovals")?.querySelector('[role="alert"]')?.textContent,
		).toBe("Update Cline to change this.");
		await page.unmount();
	});
});
