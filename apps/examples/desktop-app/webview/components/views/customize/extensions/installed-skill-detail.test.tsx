// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	commitExtensionInventoryResponse,
	getCachedExtensionInventory,
	type SkillItem,
} from "@/lib/extension-inventory";
import type { MarketplaceEntry } from "@/lib/marketplace";
import {
	InstalledSkillDetailPage,
	type InstalledSkillSelection,
} from "./installed-skill-detail";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	writeText: vi.fn(),
	updateCachedMarketplaceEntry: vi.fn(),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke, subscribe: () => () => {} },
	openExternalUrl: vi.fn(),
}));
vi.mock("@/lib/marketplace-installed", () => ({
	updateCachedMarketplaceEntry: mocks.updateCachedMarketplaceEntry,
}));
vi.mock("../marketplace/marketplace-skill-preview", () => ({
	InstalledSkillPreview: ({
		skillPath,
		instructions,
	}: {
		skillPath: string;
		instructions?: string;
	}) => (
		<section
			aria-label="Installed skill content"
			data-instructions={instructions}
		>
			{skillPath}
		</section>
	),
	MarketplaceSkillPreview: ({ entry }: { entry: MarketplaceEntry }) => (
		<section aria-label="Marketplace skill content">{entry.name}</section>
	),
}));

const skill: SkillItem = {
	name: "Local skill",
	description: "The installed version",
	instructions: "# Local instructions",
	path: "/workspace/.agents/skills/local/SKILL.md",
	enabled: true,
};
const entry: MarketplaceEntry = {
	id: "catalog-skill",
	type: "skill",
	name: "Catalog skill",
	tagline: "Catalog tagline",
	description: "Catalog description",
	tags: [],
	author: { name: "Catalog author" },
	verified: true,
	install: { command: "cline", args: ["skills", "add", "catalog-skill"] },
};
let container: HTMLDivElement;
let root: Root;
const onBack = vi.fn();

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	vi.stubGlobal("navigator", { clipboard: { writeText: mocks.writeText } });
	mocks.invoke.mockReset();
	mocks.writeText.mockReset();
	mocks.writeText.mockResolvedValue(undefined);
	mocks.updateCachedMarketplaceEntry.mockReset();
	onBack.mockReset();
	commitExtensionInventoryResponse({
		workspaceRoot: "/workspace",
		skills: [skill],
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});
async function render(selection: InstalledSkillSelection = { skill }) {
	if (selection.skill)
		commitExtensionInventoryResponse({
			workspaceRoot: "/workspace",
			skills: [selection.skill],
		});
	await act(async () => {
		root.render(
			<InstalledSkillDetailPage onBack={onBack} selection={selection} />,
		);
	});
}
function button(label: string) {
	const match = [...container.querySelectorAll("button")].find(
		(candidate) =>
			candidate.getAttribute("aria-label") === label ||
			candidate.textContent === label,
	);
	expect(match, `Button ${label}`).toBeDefined();
	return match as HTMLButtonElement;
}
function confirmationButton(label: string) {
	const dialog = document.querySelector('[role="alertdialog"]');
	expect(dialog).not.toBeNull();
	const match = [...(dialog?.querySelectorAll("button") ?? [])].find(
		(candidate) => candidate.textContent === label,
	);
	expect(match, `Confirmation button ${label}`).toBeDefined();
	return match as HTMLButtonElement;
}
function skillToggle() {
	const toggle = container.querySelector<HTMLInputElement>(
		`[role="switch"][aria-label="Enable ${skill.name}"]`,
	);
	expect(toggle).not.toBeNull();
	return toggle as HTMLInputElement;
}

describe("Installed skill detail page", () => {
	it("uses the shared page with installed files and truthful local metadata", async () => {
		await render();
		expect(
			container.querySelector('nav[aria-label="Skill navigation"]'),
		).not.toBeNull();
		expect(document.activeElement).toBe(button("Back to Manage"));
		expect(
			container.querySelector('section[aria-label="Installed skill content"]')
				?.textContent,
		).toBe(skill.path);
		expect(
			container
				.querySelector('section[aria-label="Installed skill content"]')
				?.getAttribute("data-instructions"),
		).toBe(skill.instructions);
		expect(
			container.querySelector(
				'section[aria-label="Marketplace skill content"]',
			),
		).toBeNull();
		expect(container.textContent).toContain("The installed version");
		expect(container.textContent?.match(/The installed version/g)).toHaveLength(
			1,
		);
		expect(container.textContent).toContain("Project");
		expect(container.textContent).not.toContain("Author");
		expect(container.textContent).not.toContain("Verified");
		await act(async () =>
			button("Skill path actions").dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			),
		);
		const copy = [
			...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
		].find((item) => item.textContent === "Copy path");
		expect(copy).toBeDefined();
		await act(async () => copy?.click());
		expect(mocks.writeText).toHaveBeenCalledWith(skill.path);
		expect(container.querySelector("output")?.textContent).toBe(
			"Skill path copied.",
		);
		await act(async () => button("Back to Manage").click());
		expect(onBack).toHaveBeenCalledOnce();
	});

	it("shows disabled skill content without enabling it and allows enabling from details", async () => {
		await render({ skill: { ...skill, enabled: false } });
		expect(skillToggle().checked).toBe(false);
		expect(skillToggle().disabled).toBe(false);
		expect(
			container
				.querySelector('section[aria-label="Installed skill content"]')
				?.getAttribute("data-instructions"),
		).toBe(skill.instructions);
		expect(mocks.invoke).not.toHaveBeenCalled();
		mocks.invoke.mockResolvedValueOnce({
			workspaceRoot: "/workspace",
			skills: [skill],
		});
		await act(async () => skillToggle().click());
		expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("set_skill_disabled", {
			path: skill.path,
			disabled: false,
		});
		expect(skillToggle().checked).toBe(true);
	});

	it("updates the enabled state and publishes the returned inventory", async () => {
		mocks.invoke.mockResolvedValueOnce({
			workspaceRoot: "/workspace",
			skills: [{ ...skill, enabled: false }],
		});
		await render();
		await act(async () => skillToggle().click());
		expect(mocks.invoke).toHaveBeenCalledWith("set_skill_disabled", {
			path: skill.path,
			disabled: true,
		});
		expect(skillToggle().checked).toBe(false);
		expect(getCachedExtensionInventory()?.skills[0]?.enabled).toBe(false);
		mocks.invoke.mockRejectedValueOnce(new Error("Unable to enable skill"));
		await act(async () => skillToggle().click());
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			"Unable to enable skill",
		);
		expect(skillToggle().checked).toBe(false);
	});

	it.each([
		{ source: "local", selection: { skill }, name: skill.name },
		{ source: "catalog-only", selection: { entry }, name: entry.name },
	])("keeps the $source skill installed when removal is canceled", async ({
		selection,
		name,
	}) => {
		await render(selection);
		const remove = button("Uninstall");
		await act(async () => {
			remove.focus();
			remove.click();
		});
		const dialog = document.querySelector('[role="alertdialog"]');
		expect(dialog?.textContent).toContain("Uninstall skill?");
		expect(dialog?.textContent).toContain(name);
		expect(document.activeElement).toBe(confirmationButton("Cancel"));
		expect(mocks.invoke).not.toHaveBeenCalled();
		await act(async () => confirmationButton("Cancel").click());
		expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		await vi.waitFor(() => expect(document.activeElement).toBe(remove));
		expect(mocks.invoke).not.toHaveBeenCalled();
		expect(mocks.updateCachedMarketplaceEntry).not.toHaveBeenCalled();
		expect(onBack).not.toHaveBeenCalled();
	});

	it("uninstalls the local file after confirmation, keeps failures visible, and returns after success", async () => {
		mocks.invoke.mockRejectedValueOnce(new Error("Unable to uninstall skill"));
		await render({ skill, entry });
		await act(async () => button("Uninstall").click());
		expect(mocks.invoke).not.toHaveBeenCalled();
		await act(async () => confirmationButton("Uninstall").click());
		expect(container.querySelector('[role="alert"]')?.textContent).toBe(
			"Unable to uninstall skill",
		);
		expect(onBack).not.toHaveBeenCalled();
		let finishRemoval: () => void = () => {};
		mocks.invoke.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finishRemoval = resolve;
				}),
		);
		await act(async () => button("Uninstall").click());
		await act(async () => confirmationButton("Uninstall").click());
		expect(document.querySelector('[role="alertdialog"]')).toBeNull();
		expect(button("Uninstalling…").disabled).toBe(true);
		expect(skillToggle().disabled).toBe(true);
		await act(async () => button("Uninstalling…").click());
		expect(mocks.invoke).toHaveBeenCalledTimes(2);
		await act(async () => finishRemoval());
		expect(mocks.invoke).toHaveBeenCalledWith("uninstall_local_primitive", {
			type: "skill",
			id: skill.path.toLowerCase(),
			name: skill.name,
			path: skill.path,
		});
		expect(mocks.invoke).toHaveBeenCalledWith("list_user_instruction_configs");
		expect(getCachedExtensionInventory()?.skills).toEqual([]);
		expect(onBack).toHaveBeenCalledOnce();
		expect(mocks.updateCachedMarketplaceEntry).not.toHaveBeenCalled();
	});

	it("shows plugin files while preserving plugin ownership of its skill", async () => {
		await render({
			skill: {
				...skill,
				instructions: "",
				agentPlugin: true,
				pluginName: "Example plugin",
			},
		});
		expect(container.textContent).toContain("Example plugin");
		expect(
			container.querySelector('section[aria-label="Installed skill content"]')
				?.textContent,
		).toBe(skill.path);
		expect(skillToggle().disabled).toBe(true);
		expect(
			[...container.querySelectorAll("button")].some(
				(item) => item.textContent === "Uninstall",
			),
		).toBe(false);
		expect(mocks.invoke).not.toHaveBeenCalled();
	});

	it("supports catalog-only installations without inventing a local scope", async () => {
		mocks.invoke.mockResolvedValueOnce({ message: "Uninstalled" });
		await render({ entry });
		expect(
			container.querySelector('section[aria-label="Marketplace skill content"]')
				?.textContent,
		).toBe(entry.name);
		expect(container.textContent).toContain("Catalog author");
		expect(container.textContent).not.toContain("Scope");
		expect(container.querySelector('[role="switch"]')).toBeNull();
		await act(async () => button("Uninstall").click());
		expect(mocks.invoke).not.toHaveBeenCalled();
		await act(async () => confirmationButton("Uninstall").click());
		expect(mocks.invoke).toHaveBeenCalledWith(
			"uninstall_marketplace_entry",
			{ entry },
			{ timeoutMs: 300_000 },
		);
		expect(mocks.updateCachedMarketplaceEntry).toHaveBeenCalledWith(
			entry,
			false,
		);
		expect(onBack).toHaveBeenCalledOnce();
	});
});

it("follows inventory updates published while skill details are open", async () => {
	await render();
	await act(async () => {
		commitExtensionInventoryResponse({
			workspaceRoot: "/workspace",
			skills: [
				{ ...skill, enabled: false, instructions: "Updated instructions" },
			],
		});
	});
	expect(skillToggle().checked).toBe(false);
	expect(
		container
			.querySelector('[aria-label="Installed skill content"]')
			?.getAttribute("data-instructions"),
	).toBe("Updated instructions");
	mocks.invoke.mockResolvedValueOnce({
		workspaceRoot: "/workspace",
		skills: [skill],
	});
	await act(async () => skillToggle().click());
	expect(mocks.invoke).toHaveBeenCalledWith("set_skill_disabled", {
		path: skill.path,
		disabled: false,
	});
});
