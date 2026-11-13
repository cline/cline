// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type FactoryProjects,
	FactorySettingsUnavailable,
	type FactoryStagesListing,
} from "@/lib/factory-settings-client";
import { click, deadRows, renderSettingsPage, resource } from "../test-utils";
import { settingsPage } from "./stages";

vi.mock("@/components/ui/select", async () =>
	(await import("../test-utils")).nativeSelectModule(),
);

const hash = (c: string) => c.repeat(64);
const scan = {
	id: "security-scan",
	name: "Security scan",
	kind: "command" as const,
	command: "bun run scan",
	when: { paths: ["src/auth/**", "**/secrets/**"] },
};
const migrations = {
	id: "migration-review",
	name: "Migration review",
	kind: "agent" as const,
	access: "read" as const,
	instruction: "Check every migration is reversible.",
	when: { paths: ["**/migrations/**"], minSize: "shared_contract" as const },
	timeoutSeconds: 600,
};
const locales = {
	id: "locale-keys",
	name: "Locale keys",
	kind: "command" as const,
	command: "bun run check:i18n",
	blocking: false,
};
const docs = {
	id: "docs",
	name: "Docs update",
	kind: "agent" as const,
	access: "write" as const,
	instruction: "Update docs/.",
};
const listing: FactoryStagesListing = {
	file: "present",
	stages: [
		{ stage: scan, hash: hash("a"), status: "approved" },
		{ stage: migrations, hash: hash("b"), status: "needs_approval" },
		{ stage: locales, hash: hash("c"), status: "changed" },
		{ stage: docs, hash: hash("d"), status: "declined" },
	],
};

const summary = (
	projects: Partial<FactoryProjects["projects"][number]>[],
): FactoryProjects => ({
	projects: projects.map((project) => ({
		workspaceRoot: "/work/app",
		name: "app",
		stages: { file: "present", total: 0, inUse: 0, awaiting: 0 },
		verification: "none",
		guidance: { roles: [], changed: [] },
		taskFiles: 0,
		...project,
	})),
	userGuidanceChanged: [],
});

let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
	await unmount?.();
	unmount = undefined;
});

async function render(options: Parameters<typeof renderSettingsPage>[1] = {}) {
	const page = await renderSettingsPage(settingsPage, {
		client: { getStages: async () => listing, ...options.client },
		shell: options.shell,
	});
	unmount = page.unmount;
	return page;
}

const decisionButtons = (row: HTMLElement | null) =>
	[...(row?.querySelectorAll("button") ?? [])].filter((button) =>
		["Approve", "Stop using"].includes(button.textContent ?? ""),
	);

describe("Stages page: what is clickable", () => {
	it("draws the stage line as a static figure, not a row of tabs", async () => {
		const page = await render();
		const line = page.container.querySelector<HTMLElement>('[role="img"]');
		expect(line?.querySelector("button, [tabindex]")).toBeNull();
		expect(line?.className).not.toMatch(/\b(border|rounded-lg|bg-card)\b/);
		for (const cell of line?.querySelectorAll("*") ?? [])
			expect(cell.getAttribute("class") ?? "").not.toMatch(
				/\b(text-primary|bg-primary\/10)\b/,
			);
	});

	it("keeps the status pill a static tint beside a bordered Stop using", async () => {
		const page = await render();
		const row = page.row("stage-security-scan");
		const pill = [...(row?.querySelectorAll('[data-slot="badge"]') ?? [])].find(
			(badge) => badge.textContent === "In use",
		);
		expect(pill?.closest("button")).toBeNull();
		expect(pill?.className).toContain("border-transparent");
		const [stop] = decisionButtons(row);
		expect(stop?.textContent).toBe("Stop using");
		expect(stop?.className.split(" ")).toContain("border");
		expect(stop?.className).not.toContain("border-transparent");
	});

	it("shows and hides a stage's definition with one down chevron", async () => {
		const page = await render();
		const toggle = page.container.querySelector<HTMLButtonElement>(
			"#stage-security-scan-title",
		);
		const chevron = () => toggle?.querySelector("svg")?.getAttribute("class");
		expect(toggle?.querySelectorAll("svg")).toHaveLength(1);
		expect(chevron()).not.toContain("rotate-180");
		await click(toggle);
		expect(toggle?.getAttribute("aria-expanded")).toBe("true");
		expect(chevron()).toContain("rotate-180");
	});
});

describe("Stages page", () => {
	it("shows the stage line and one row per stage with exactly one decision", async () => {
		const page = await render();
		expect(page.shell.client.getStages).toHaveBeenCalledWith("/work/app");
		const line = page.container.querySelector('[role="img"]');
		expect(line?.getAttribute("aria-label")).toContain("repository stages");
		expect(line?.textContent).toContain("Repository stages");
		const rows = {
			approved: page.row("stage-security-scan"),
			needs: page.row("stage-migration-review"),
			changed: page.row("stage-locale-keys"),
			declined: page.row("stage-docs"),
		};
		expect(rows.approved?.textContent).toContain(
			"Command · when src/auth/** or **/secrets/** change · blocks delivery",
		);
		expect(rows.needs?.textContent).toContain(
			"Agent, read-only · when **/migrations/** changes in a large change · blocks delivery",
		);
		expect(rows.changed?.textContent).toContain(
			"Command · always · does not block delivery",
		);
		expect(rows.declined?.textContent).toContain(
			"Agent, can change code before review",
		);
		for (const [row, pill, action] of [
			[rows.approved, "In use", "Stop using"],
			[rows.needs, "Needs approval", "Approve"],
			[rows.changed, "Changed since approved", "Approve"],
			[rows.declined, "Not used", "Approve"],
		] as const) {
			expect(row?.textContent).toContain(pill);
			expect(decisionButtons(row).map((button) => button.textContent)).toEqual([
				action,
			]);
		}
		expect(deadRows(page.container)).toEqual([]);
	});

	it("keeps the whole definition open wherever Approve is offered", async () => {
		const page = await render();
		for (const id of ["migration-review", "locale-keys", "docs"]) {
			const row = page.row(`stage-${id}`);
			const toggle = row?.querySelector("[aria-expanded]");
			expect(toggle?.getAttribute("aria-expanded")).toBe("true");
			const definition = row?.querySelector<HTMLElement>(
				`#${toggle?.getAttribute("aria-controls")}`,
			);
			expect(definition?.hidden).toBe(false);
			// The canonical JSON the hash covers, every field.
			expect(
				JSON.parse(definition?.querySelector("pre")?.textContent ?? ""),
			).toEqual(listing.stages.find((entry) => entry.stage.id === id)?.stage);
		}
		expect(page.row("stage-locale-keys")?.textContent).toContain(
			"Once approved, Factory runs this in each card's worktree on this computer, as you, with access to your files.",
		);
		expect(page.row("stage-migration-review")?.textContent).toContain(
			"Runs on Code reviewer 1's model",
		);
		expect(page.row("stage-docs")?.textContent).toContain(
			"Runs on Builder 1's model",
		);
		// In use: behind a disclosure the person opens.
		const approved = page.row("stage-security-scan");
		const toggle =
			approved?.querySelector<HTMLButtonElement>("[aria-expanded]");
		expect(toggle?.getAttribute("aria-expanded")).toBe("false");
		await click(toggle);
		expect(toggle?.getAttribute("aria-expanded")).toBe("true");
		expect(approved?.textContent).toContain('"command": "bun run scan"');
	});

	it("approves by the shown hash, and stops using with declined", async () => {
		const approved: FactoryStagesListing = {
			...listing,
			stages: listing.stages.map((entry) =>
				entry.stage.id === "migration-review"
					? { ...entry, status: "approved" }
					: entry,
			),
		};
		const page = await render({
			client: { decideStage: async () => approved },
		});
		await click(decisionButtons(page.row("stage-migration-review"))[0]);
		expect(page.shell.client.decideStage).toHaveBeenCalledWith({
			workspaceRoot: "/work/app",
			stageId: "migration-review",
			expectedHash: hash("b"),
			decision: "approved",
		});
		expect(page.shell.saved).toHaveBeenCalled();
		expect(page.shell.projectsSummary.reload).toHaveBeenCalled();
		expect(page.row("stage-migration-review")?.textContent).toContain("In use");
		await click(decisionButtons(page.row("stage-security-scan"))[0]);
		expect(page.shell.client.decideStage).toHaveBeenLastCalledWith({
			workspaceRoot: "/work/app",
			stageId: "security-scan",
			expectedHash: hash("a"),
			decision: "declined",
		});
	});

	it("on a stale hash keeps the error under the row and reads the file again", async () => {
		const newer = {
			...listing,
			stages: [
				{
					stage: { ...migrations, instruction: "Something else." },
					hash: hash("e"),
					status: "changed" as const,
				},
			],
		};
		const getStages = vi
			.fn<() => Promise<FactoryStagesListing>>()
			.mockResolvedValueOnce(listing)
			.mockResolvedValue(newer);
		const page = await render({
			client: {
				getStages,
				decideStage: async () => {
					throw new Error(
						'Factory could not save the decision on the repository stage: Repository stage "Migration review" changed since it was shown; review it again',
					);
				},
			},
		});
		await click(decisionButtons(page.row("stage-migration-review"))[0]);
		expect(getStages).toHaveBeenCalledTimes(2);
		const row = page.row("stage-migration-review");
		expect(row?.querySelector('[role="alert"]')?.textContent).toContain(
			"changed since it was shown",
		);
		// The new definition is what is shown now, open, with its own hash.
		expect(row?.textContent).toContain("Something else.");
		expect(page.shell.saved).not.toHaveBeenCalled();
	});

	it("drafts Add, Change and Remove for Ask Factory", async () => {
		const page = await render();
		await click(page.buttons("Add stage")[0]);
		expect(page.shell.askFactory).toHaveBeenLastCalledWith(
			"Add a stage to app that ",
		);
		const trigger = page.buttons("More actions for Security scan")[0];
		await act(async () => {
			trigger?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
		const item = (name: string) =>
			[...document.querySelectorAll('[role="menuitem"]')].find(
				(element) => element.textContent === name,
			);
		expect(item("Ask Factory to change it")).toBeDefined();
		await click(item("Remove with Ask Factory"));
		expect(page.shell.askFactory).toHaveBeenLastCalledWith(
			"Remove the “Security scan” stage from app.",
		);
		await act(async () => {
			page
				.buttons("More actions for Security scan")[0]
				?.dispatchEvent(
					new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
				);
		});
		await click(item("Ask Factory to change it"));
		expect(page.shell.askFactory).toHaveBeenLastCalledWith(
			"Change the “Security scan” stage in app so that ",
		);
		// No decision is sent from a menu.
		expect(page.shell.client.decideStage).not.toHaveBeenCalled();
	});

	it("explains an empty project with ideas and Add stage", async () => {
		const page = await render({
			client: { getStages: async () => ({ file: "absent", stages: [] }) },
		});
		expect(page.text()).toContain(
			"No stages in app. Stages are extra steps, such as a security scan, that run after Build.",
		);
		await click(
			page.buttons(
				"An agent that checks every migration has a rollback note",
			)[0],
		);
		expect(page.shell.askFactory).toHaveBeenLastCalledWith(
			"Add a stage to app where an agent checks every migration has a rollback note",
		);
		await click(page.buttons("Add stage")[0]);
		expect(page.shell.askFactory).toHaveBeenLastCalledWith(
			"Add a stage to app that ",
		);
		expect(page.buttons("Add stage")).toHaveLength(1);
		expect(deadRows(page.container)).toEqual([]);
	});

	it("shows an invalid file's problem and Fix with Ask Factory, no rows", async () => {
		const page = await render({
			client: {
				getStages: async () => ({
					file: "invalid",
					reason: "stages[1].kind: invalid",
					stages: [],
				}),
			},
		});
		expect(page.text()).toContain("Can't read stages.json");
		expect(page.text()).toContain("stages[1].kind: invalid");
		expect(page.container.querySelector('[data-setting^="stage-"]')).toBeNull();
		expect(page.buttons("Add stage")).toHaveLength(0);
		await click(page.buttons("Fix with Ask Factory")[0]);
		expect(page.shell.askFactory).toHaveBeenLastCalledWith(
			"Fix .cline/factory/stages.json in app. It can't be read: stages[1].kind: invalid",
		);
		expect(deadRows(page.container)).toEqual([]);
	});

	it("reads the selected project and opens the others from their rows", async () => {
		const page = await render({
			shell: {
				projects: ["/work/app", "/work/api"],
				project: "/work/app",
				projectsSummary: resource(
					summary([
						{ stages: { file: "present", total: 4, inUse: 1, awaiting: 2 } },
						{
							workspaceRoot: "/work/api",
							name: "api",
							stages: { file: "present", total: 1, inUse: 0, awaiting: 1 },
						},
					]),
				),
			},
		});
		const other = page.row("stages-project-api");
		expect(other?.textContent).toContain("1 needs a decision");
		await click(other?.querySelector("button"));
		expect(page.shell.open).toHaveBeenCalledWith({
			page: "stages",
			project: "/work/api",
		});
		await page.rerender({ ...page.shell, project: "/work/api" });
		expect(page.shell.client.getStages).toHaveBeenLastCalledWith("/work/api");
		expect(page.row("stages-project-app")).not.toBeNull();
		expect(settingsPage.useBadge?.(page.shell)).toBe(3);
	});

	it("says once when the command is unavailable, and disables when read-only", async () => {
		const missing = await render({
			client: {
				getStages: async () => {
					throw new FactorySettingsUnavailable("factory_get_stages", "hub");
				},
			},
		});
		expect(
			missing.container.querySelector("[data-settings-unavailable]")
				?.textContent,
		).toBe("Repository stages: update Cline to use them.");
		expect(missing.buttons("Approve")).toHaveLength(0);
		expect(deadRows(missing.container)).toEqual([]);
		await missing.unmount();
		unmount = undefined;

		const readOnly = await render({ shell: { readOnly: true } });
		for (const button of readOnly.buttons(/^(Approve|Stop using|Add stage)$/))
			expect(button.disabled).toBe(true);
	});
});
