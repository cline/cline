// @vitest-environment jsdom
import {
	DEFAULT_FACTORY_AGENTS,
	factoryWorkflowConfigSchema,
} from "@cline/shared/browser";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type FactoryPreset,
	HANDS_OFF_PRESET_CONFIG,
	HANDS_OFF_PRESET_NAME,
} from "@/lib/factory-presets";
import { FactorySettingsUnavailable } from "@/lib/factory-settings-client";
import {
	click,
	deadRows,
	fakeWorkflow,
	renderSettingsPage,
	type,
} from "../test-utils";
import { settingsPage } from "./workflows";

vi.mock("@/components/ui/select", async () =>
	(await import("../test-utils")).nativeSelectModule(),
);

const rev = (c: string) => c.repeat(64);
const careful: FactoryPreset = {
	name: "Careful",
	revision: rev("a"),
	config: factoryWorkflowConfigSchema.parse({
		approval: "required",
		maxCostUsd: 25,
		agents: { ...DEFAULT_FACTORY_AGENTS, verifier: {} },
	}),
};
const small: FactoryPreset = {
	name: "Small fixes",
	revision: rev("b"),
	config: factoryWorkflowConfigSchema.parse({ approval: "automatic" }),
};
const handsOff: FactoryPreset = {
	name: HANDS_OFF_PRESET_NAME,
	revision: rev("c"),
	config: HANDS_OFF_PRESET_CONFIG,
};
const saved = [careful, small, handsOff];

function workflowWith(defaultName = "Careful", presets = saved) {
	const workflow = fakeWorkflow(
		presets.find((preset) => preset.name === defaultName)?.config,
	);
	return {
		...workflow,
		name: defaultName,
		presets: { ...workflow.presets, presets, defaultPreset: defaultName },
	};
}

async function render(
	client: NonNullable<Parameters<typeof renderSettingsPage>[1]>["client"] = {},
	workflow = workflowWith(),
) {
	return renderSettingsPage(settingsPage, { client, shell: { workflow } });
}

type Page = Awaited<ReturnType<typeof render>>;

const rowOf = (page: Page, name: string) =>
	page.container.querySelector<HTMLElement>(`[data-workflow="${name}"]`);

async function openMenu(page: Page, name: string) {
	const [trigger] = page.buttons(`More actions for ${name}`);
	await act(async () =>
		trigger?.dispatchEvent(
			new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
		),
	);
	return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

async function choose(page: Page, name: string, item: string) {
	const items = await openMenu(page, name);
	const target = items.find((el) => el.textContent?.trim() === item);
	if (!target) throw new Error(`No menu item ${item}`);
	await click(target);
}

let clipboard: ReturnType<typeof vi.fn>;
beforeEach(() => {
	// The Save as checkbox measures itself.
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
	clipboard = vi.fn(async () => {});
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText: clipboard },
	});
});
afterEach(() => {
	document.body.innerHTML = "";
});

describe("Workflows page", () => {
	it("lists Hands-off first, a summary per workflow, and the default", async () => {
		const page = await render();
		const names = [
			...page.container.querySelectorAll<HTMLElement>("[data-workflow]"),
		].map((row) => row.dataset.workflow);
		expect(names).toEqual(["Hands-off", "Careful", "Small fixes"]);
		expect(rowOf(page, "Hands-off")?.textContent).toContain("Built in");
		expect(rowOf(page, "Hands-off")?.textContent).toContain(
			"Plans only when needed · 1 builder · tester off · $10 per card",
		);
		expect(rowOf(page, "Careful")?.textContent).toContain(
			"Every plan waits · 1 builder · tester on · $25 per card",
		);
		expect(rowOf(page, "Careful")?.textContent).toContain("Default");
		expect(rowOf(page, "Careful")?.textContent).not.toContain("Make default");
		expect(rowOf(page, "Small fixes")?.textContent).toContain("no card limit");
		expect(deadRows(page.container)).toEqual([]);
		await page.unmount();
	});

	it("Make default saves the workflow as the default", async () => {
		const page = await render({ savePreset: async () => saved });
		const make = rowOf(page, "Small fixes")?.querySelector("button");
		expect(make?.textContent).toBe("Make default");
		await click(make);
		expect(page.shell.client.savePreset).toHaveBeenCalledWith({
			name: "Small fixes",
			config: small.config,
			useByDefault: true,
		});
		expect(page.shell.workflow.presets.setDefaultPreset).toHaveBeenCalledWith(
			"Small fixes",
		);
		expect(page.shell.saved).toHaveBeenCalled();
		await page.unmount();
	});

	it("offers no Rename or Delete for Hands-off", async () => {
		const page = await render();
		const items = (await openMenu(page, "Hands-off")).map((el) =>
			el.textContent?.trim(),
		);
		expect(items).toEqual(["Duplicate", "Copy as JSON"]);
		await page.unmount();
	});

	it("renames in place, refusing empty, taken and built-in names", async () => {
		const page = await render({
			renamePreset: async () => [
				{ ...careful, name: "Thorough" },
				small,
				handsOff,
			],
		});
		await choose(page, "Careful", "Rename…");
		const input = document.querySelector<HTMLInputElement>(
			'input[aria-label="New name for Careful"]',
		);
		expect(document.activeElement).toBe(input);
		const save = () =>
			click(
				page.buttons("Save").find((b) => rowOf(page, "Careful")?.contains(b)),
			);
		await type(input, "  ");
		await save();
		expect(rowOf(page, "Careful")?.textContent).toContain("Enter a name.");
		await type(input, "Small fixes");
		await save();
		expect(rowOf(page, "Careful")?.textContent).toContain(
			"A workflow named “Small fixes” already exists.",
		);
		await type(input, "Hands-off");
		await save();
		expect(rowOf(page, "Careful")?.textContent).toContain(
			"“Hands-off” is built in; choose another name.",
		);
		expect(page.shell.client.renamePreset).not.toHaveBeenCalled();
		await type(input, "Thorough");
		await save();
		expect(page.shell.client.renamePreset).toHaveBeenCalledWith(
			"Careful",
			"Thorough",
		);
		// Renaming the default moves the default with it.
		expect(page.shell.workflow.presets.setDefaultPreset).toHaveBeenCalledWith(
			"Thorough",
		);
		await page.unmount();
	});

	it("Escape cancels a rename and returns focus to the row's menu button", async () => {
		const page = await render();
		await choose(page, "Small fixes", "Rename…");
		const input = document.querySelector<HTMLInputElement>(
			'input[aria-label="New name for Small fixes"]',
		);
		await act(async () =>
			input?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			),
		);
		await act(async () => {});
		expect(
			document.querySelector('input[aria-label="New name for Small fixes"]'),
		).toBeNull();
		expect(document.activeElement?.getAttribute("aria-label")).toBe(
			"More actions for Small fixes",
		);
		expect(page.shell.client.renamePreset).not.toHaveBeenCalled();
		await page.unmount();
	});

	it("shows the backend's refusal of a rename under the row", async () => {
		const page = await render({
			renamePreset: async () => {
				throw new Error("A workflow named “X” already exists.");
			},
		});
		await choose(page, "Small fixes", "Rename…");
		const input = document.querySelector<HTMLInputElement>(
			'input[aria-label="New name for Small fixes"]',
		);
		await type(input, "X");
		await act(async () =>
			input?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			),
		);
		await act(async () => {});
		expect(
			rowOf(page, "Small fixes")?.querySelector('[role="alert"]')?.textContent,
		).toBe("A workflow named “X” already exists.");
		await page.unmount();
	});

	it("duplicates under the first free copy name", async () => {
		const page = await render(
			{ savePreset: async () => saved },
			workflowWith("Careful", [...saved, { ...careful, name: "Careful copy" }]),
		);
		await choose(page, "Careful", "Duplicate");
		expect(page.shell.client.savePreset).toHaveBeenCalledWith({
			name: "Careful copy 2",
			config: careful.config,
		});
		await page.unmount();
	});

	it("Copy as JSON puts the workflow recipe on the clipboard", async () => {
		const page = await render();
		await choose(page, "Careful", "Copy as JSON");
		expect(clipboard).toHaveBeenCalledTimes(1);
		expect(JSON.parse(clipboard.mock.calls[0]?.[0] as string)).toEqual({
			schemaVersion: 1,
			name: "Careful",
			revision: rev("a"),
			config: careful.config,
		});
		expect(rowOf(page, "Careful")?.textContent).toContain(
			"Copied “Careful” as JSON.",
		);
		await page.unmount();
	});

	it("sets Delete workflow apart at the end of the row menu", async () => {
		const page = await render();
		await openMenu(page, "Small fixes");
		const menu = document.querySelector('[role="menu"]');
		const last = menu?.lastElementChild;
		expect(last?.textContent).toBe("Delete workflow…");
		expect(last?.previousElementSibling?.getAttribute("role")).toBe(
			"separator",
		);
		await page.unmount();
	});

	it("deletes a workflow after confirmation", async () => {
		const page = await render({
			deletePreset: async () => [careful, handsOff],
		});
		await choose(page, "Small fixes", "Delete workflow…");
		expect(document.body.textContent).toContain("Delete “Small fixes”?");
		expect(page.shell.client.deletePreset).not.toHaveBeenCalled();
		await click(page.buttons("Delete workflow")[0]);
		expect(page.shell.client.deletePreset).toHaveBeenCalledWith(
			"Small fixes",
			undefined,
		);
		expect(page.shell.workflow.presets.setPresets).toHaveBeenCalledWith([
			careful,
			handsOff,
		]);
		expect(page.text()).toContain("Deleted “Small fixes”.");
		await page.unmount();
	});

	it("deleting the default asks which workflow becomes the default", async () => {
		const page = await render({ deletePreset: async () => [small, handsOff] });
		await choose(page, "Careful", "Delete workflow…");
		const dialog = document.querySelector(
			'[data-settings-dialog="deleteDefault"]',
		);
		expect(dialog?.textContent).toContain(
			"It is the default workflow, so choose",
		);
		const select = dialog?.querySelector("select");
		expect([...(select?.options ?? [])].map((o) => o.value)).toEqual([
			"Hands-off",
			"Small fixes",
		]);
		const { choose: pick } = await import("../test-utils");
		await pick(select ?? null, "Small fixes");
		await click(page.buttons("Delete workflow")[0]);
		expect(page.shell.client.deletePreset).toHaveBeenCalledWith(
			"Careful",
			"Small fixes",
		);
		expect(page.shell.workflow.presets.setDefaultPreset).toHaveBeenCalledWith(
			"Small fixes",
		);
		await page.unmount();
	});

	it("saves the current settings as a new workflow", async () => {
		const page = await render({ savePreset: async () => saved });
		await click(page.buttons("Save current as…")[0]);
		const input = document.querySelector<HTMLInputElement>(
			"#workflow-save-as-name",
		);
		await type(input, "Careful");
		await click(page.buttons("Save")[0]);
		expect(document.body.textContent).toContain(
			"A workflow named “Careful” already exists.",
		);
		await type(input, "Weekend");
		await click(page.buttons("Save")[0]);
		expect(page.shell.client.savePreset).toHaveBeenCalledWith({
			name: "Weekend",
			config: page.shell.workflow.config,
			useByDefault: true,
		});
		expect(page.shell.workflow.presets.setDefaultPreset).toHaveBeenCalledWith(
			"Weekend",
		);
		await page.unmount();
	});

	describe("Import", () => {
		const recipe = {
			schemaVersion: 1,
			name: "Night shift",
			revision: rev("d"),
			config: factoryWorkflowConfigSchema.parse({
				approval: "automatic",
				maxCostUsd: 3,
			}),
		};
		async function paste(page: Page, text: string) {
			await click(page.buttons("Import…")[0]);
			await type(
				document.querySelector<HTMLTextAreaElement>("#workflow-import-json"),
				text,
			);
			await click(page.buttons("Review")[0]);
		}

		it("previews what a valid workflow sets, then saves it without changing the default", async () => {
			const page = await render({ savePreset: async () => saved });
			await paste(page, JSON.stringify(recipe));
			const preview = document.querySelector("[data-workflow-preview]");
			expect(preview?.textContent).toContain("Plan approval");
			expect(preview?.textContent).toContain("$3");
			expect(page.shell.client.savePreset).not.toHaveBeenCalled();
			await click(page.buttons("Import")[0]);
			expect(page.shell.client.savePreset).toHaveBeenCalledWith({
				name: "Night shift",
				revision: rev("d"),
				config: recipe.config,
			});
			expect(
				page.shell.workflow.presets.setDefaultPreset,
			).not.toHaveBeenCalled();
			expect(page.text()).toContain("Imported “Night shift”.");
			await page.unmount();
		});

		it("refuses invalid JSON and a non-workflow", async () => {
			const page = await render();
			await paste(page, "{nope");
			expect(document.body.textContent).toContain(
				"Workflow import must be valid JSON.",
			);
			await type(
				document.querySelector<HTMLTextAreaElement>("#workflow-import-json"),
				JSON.stringify({ name: "x" }),
			);
			await click(page.buttons("Review")[0]);
			expect(document.body.textContent).toContain("Not a version 1 workflow");
			expect(page.shell.client.savePreset).not.toHaveBeenCalled();
			await page.unmount();
		});

		it("refuses a name a different saved workflow uses", async () => {
			const page = await render();
			await paste(page, JSON.stringify({ ...recipe, name: "Careful" }));
			expect(document.body.textContent).toContain(
				"A different saved workflow is named “Careful”.",
			);
			expect(document.querySelector("[data-workflow-preview]")).toBeNull();
			await page.unmount();
		});
	});

	it("explains the limits on a repository's workflow file behind a disclosure", async () => {
		const page = await render();
		const row = page.row("repositoryWorkflows");
		expect(row?.querySelector("ul")).toBeNull();
		await click(row?.querySelector("button[aria-expanded]"));
		expect(row?.querySelectorAll("li")).toHaveLength(5);
		await page.unmount();
	});

	it("reports a failed save under the row", async () => {
		const page = await render({
			savePreset: async () => {
				throw new FactorySettingsUnavailable("factory_save_preset", "hub");
			},
		});
		await click(rowOf(page, "Small fixes")?.querySelector("button"));
		expect(rowOf(page, "Small fixes")?.textContent).toContain(
			"Update Cline to change this.",
		);
		await page.unmount();
	});
});
