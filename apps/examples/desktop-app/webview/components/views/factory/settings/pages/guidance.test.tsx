// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type FactoryGuidanceHistoryEntry,
	type FactoryGuidanceSettings,
	type FactoryGuidanceTarget,
	type FactoryProjects,
	FactorySettingsRefused,
	FactorySettingsUnavailable,
} from "@/lib/factory-settings-client";
import {
	click,
	deadRows,
	fakeShell,
	renderSettingsPage,
	resource,
	type,
} from "../test-utils";
import { settingsPage } from "./guidance";

vi.mock("@/components/ui/select", async () =>
	(await import("../test-utils")).nativeSelectModule(),
);
// The diff renderer draws into a shadow root; a plain stand-in shows both texts.
vi.mock("@cline/ui/components/agent-chat/tool-diff", () => ({
	ToolFileDiff: ({
		oldText,
		newText,
	}: {
		oldText?: string;
		newText: string;
	}) => <pre data-testid="tool-diff">{`${oldText ?? ""}\n=>\n${newText}`}</pre>,
}));

const ROOT = "/work/app";
const hash = (c: string) => c.repeat(16);
const builderYours = "# Commits\nOne commit per unit.";
const accepted = "# Toolchain\nUse Bun.\nRun build:sdk after SDK changes.";
const outside = "# Toolchain\nUse Bun.\nRun build:sdk before any SDK test.";

function guidance(
	overrides: Partial<Record<string, Partial<FactoryGuidanceTarget>>> = {},
): FactoryGuidanceSettings {
	const none = (c: string) => ({
		status: "none" as const,
		content: "",
		hash: hash(c),
	});
	const repo = (c: string) => ({
		...none(c),
		accepted: false,
		inUse: false,
		needsAcceptance: false,
		path: ".cline/factory/guidance/x.md",
	});
	const targets: FactoryGuidanceTarget[] = [
		{ role: "manager", user: none("0") },
		{ role: "factory", user: none("1"), repository: repo("2") },
		{ role: "designer", user: none("3"), repository: repo("4") },
		{ role: "plan_reviewer", user: none("5"), repository: repo("6") },
		{
			role: "builder",
			user: { status: "current", content: builderYours, hash: hash("7") },
			repository: {
				status: "changed",
				content: outside,
				hash: hash("8"),
				acceptedHash: hash("9"),
				acceptedContent: accepted,
				accepted: true,
				inUse: true,
				needsAcceptance: true,
				path: ".cline/factory/guidance/builder.md",
			},
		},
		{ role: "verifier", user: none("a"), repository: repo("b") },
		{ role: "reviewer", user: none("c"), repository: repo("d") },
	];
	return {
		maxChars: 8000,
		userScope: true,
		managerReadmeDefault: "# Factory manager\nYou run Factory.",
		workspaceRoot: ROOT,
		targets: targets.map((target) => ({
			...target,
			...overrides[target.role],
		})),
	};
}

const entry = (
	id: string,
	source: FactoryGuidanceHistoryEntry["source"],
	note: string,
): FactoryGuidanceHistoryEntry => ({
	id,
	time: new Date().toISOString(),
	role: "builder",
	scope: "user",
	note,
	hashBefore: hash("1"),
	hashAfter: hash("7"),
	before: "# Commits\nOld rule.",
	after: builderYours,
	...(source ? { source } : {}),
});
const history = {
	entries: [
		entry("h3", undefined, "Tests: no snapshots"),
		entry(
			"h2",
			{ kind: "feedback", taskId: "t-128", factoryNumber: 128 },
			"Dependencies: say why",
		),
		entry("h1", { kind: "settings" }, "Commits: one per unit"),
	],
	more: false,
};

async function render(
	options: {
		data?: FactoryGuidanceSettings;
		client?: Parameters<typeof renderSettingsPage>[1] extends infer O
			? O extends { client?: infer C }
				? C
				: never
			: never;
		shell?: Parameters<typeof renderSettingsPage>[1] extends infer O
			? O extends { shell?: infer S }
				? S
				: never
			: never;
		focus?: { role?: string };
	} = {},
) {
	const data = options.data ?? guidance();
	return renderSettingsPage(settingsPage, {
		client: {
			getGuidance: async () => data,
			getGuidanceHistory: async () => history,
			...options.client,
		},
		shell: { projects: [ROOT], project: ROOT, ...options.shell },
		focus: options.focus,
	});
}

type Page = Awaited<ReturnType<typeof render>>;
const block = (page: Page, scope: "user" | "repository") =>
	page.row(scope === "user" ? "guidance-user" : "guidance-repository");
const editor = (page: Page) =>
	page.container.querySelector<HTMLTextAreaElement>(
		'[data-setting="guidance-user"] textarea',
	);
const target = (page: Page, role: string) =>
	page.container.querySelector<HTMLButtonElement>(`#guidance-target-${role}`);

afterEach(() => {
	document.body.innerHTML = "";
});

describe("Guidance: reading", () => {
	it("lists the seven targets with their state and opens the one that changed", async () => {
		const page = await render();
		const tabs = [...page.container.querySelectorAll('[role="tab"]')];
		expect(tabs.map((tab) => tab.textContent)).toEqual([
			"Manager readmeBuilt-in",
			"RoutingNone",
			"ScopingNone",
			"Plan checkersNone",
			"Builders1 changed",
			"TesterNone",
			"Code reviewersNone",
		]);
		expect(target(page, "builder")?.getAttribute("aria-selected")).toBe("true");
		expect(block(page, "user")?.textContent).toContain("In use");
		expect(block(page, "user")?.textContent).toContain(
			"every project · 30 of 8,000 characters",
		);
		expect(deadRows(page.container)).toEqual([]);
		await page.unmount();
	});

	it("says a role has your guidance rather than a bare number", async () => {
		const page = await render({
			data: guidance({
				reviewer: {
					user: {
						status: "current",
						content: "x".repeat(553),
						hash: hash("e"),
					},
				},
			}),
		});
		expect(target(page, "reviewer")?.textContent).toBe("Code reviewersYours");
		await page.unmount();
	});

	it("marks the selected target with the accent bar, not just the hover fill", async () => {
		const page = await render();
		const selected = target(page, "builder")?.className.split(" ") ?? [];
		const other =
			page.container
				.querySelector('[role="tab"][aria-selected="false"]')
				?.className.split(" ") ?? [];
		expect(selected).toContain("before:bg-primary");
		expect(selected).toContain("bg-surface-hover");
		expect(other).not.toContain("before:bg-primary");
		expect(other).not.toContain("bg-surface-hover");
		expect(other).toContain("hover:bg-surface-hover-lighter");
		await page.unmount();
	});

	it("marks a file changed outside Factory, with Accept and Discard", async () => {
		const page = await render();
		const repository = block(page, "repository");
		expect(repository?.textContent).toContain("Changed outside Factory");
		expect(repository?.textContent).toContain(
			"This file was changed outside Factory. Builders keep using the last version you accepted until you decide. The change is marked below.",
		);
		const removed = repository?.querySelector('[data-line="removed"]');
		const added = repository?.querySelector('[data-line="added"]');
		expect(removed?.textContent).toBe(
			"removed: Run build:sdk after SDK changes.",
		);
		expect(added?.textContent).toBe(
			"added: Run build:sdk before any SDK test.",
		);
		await page.unmount();
	});

	it("shows the built-in manager readme, with no repository scope", async () => {
		const page = await render({ focus: { role: "manager" } });
		expect(block(page, "repository")).toBeNull();
		expect(block(page, "user")?.textContent).toContain(
			"Built-in. Editing saves your own copy.",
		);
		expect(block(page, "user")?.textContent).toContain("You run Factory.");
		expect(page.shell.client.getGuidanceHistory).toHaveBeenCalledWith({
			role: "manager",
			workspaceRoot: undefined,
			limit: 20,
		});
		await page.unmount();
	});

	it("says what an empty target is for and offers both ways to add guidance", async () => {
		const page = await render({ focus: { role: "plan_reviewer" } });
		const yours = block(page, "user");
		expect(yours?.textContent).toContain(
			"No guidance for plan checker yet. Roles use Factory's built-in instructions.",
		);
		await click(page.buttons("Write guidance, Plan checkers, Yours")[0]);
		expect(editor(page)?.value).toBe("");
		await click(
			page.buttons("Ask Factory to write it, Plan checkers, Repository")[0],
		);
		expect(page.shell.askFactory).toHaveBeenCalledWith(
			"Change the plan checker guidance for app: ",
		);
		expect(deadRows(page.container)).toEqual([]);
		await page.unmount();
	});

	it("becomes a select when the settings area is folded", async () => {
		const page = await render({ shell: { folded: true } });
		expect(page.container.querySelector('[role="tablist"]')).toBeNull();
		const select = page.container.querySelector<HTMLSelectElement>(
			'[data-setting="guidance-targets"] select',
		);
		expect(select?.value).toBe("builder");
		expect(select?.selectedOptions[0]?.textContent).toBe(
			"Builders · 1 changed",
		);
		await page.unmount();
	});

	it("says so when this build or Hub has no guidance commands", async () => {
		const page = await render({
			client: {
				getGuidance: async () => {
					throw new FactorySettingsUnavailable("factory_get_guidance", "hub");
				},
			},
		});
		expect(page.text()).toContain("Update Cline to change this.");
		expect(page.buttons("Edit text")).toHaveLength(0);
		expect(deadRows(page.container)).toEqual([]);
		await page.unmount();
		const noHistory = await render({
			client: {
				getGuidanceHistory: async () => {
					throw new FactorySettingsUnavailable(
						"factory_get_guidance_history",
						"build",
					);
				},
			},
		});
		expect(noHistory.text()).toContain("History: not available in this build.");
		await noHistory.unmount();
	});
});

describe("Guidance: editing", () => {
	it("saves only after the diff is reviewed, with the hash it was shown", async () => {
		const saved = guidance({
			builder: {
				user: {
					status: "current",
					content: `${builderYours}\nKeep PRs small.`,
					hash: hash("e"),
				},
			},
		}).targets[4] as FactoryGuidanceTarget;
		const page = await render({
			client: { setGuidance: async () => ({ target: saved }) },
		});
		await click(page.buttons("Edit Builders guidance, Yours")[0]);
		await type(editor(page), `${builderYours}\nKeep PRs small.`);
		await click(page.buttons("Review change")[0]);
		expect(page.shell.client.setGuidance).not.toHaveBeenCalled();
		const review = page.container.querySelector("[data-guidance-review]");
		expect(review?.textContent).toContain("1 line added, 0 removed");
		expect(review?.textContent).toContain("added: Keep PRs small.");
		await click(page.buttons("Save")[0]);
		expect(page.shell.client.setGuidance).toHaveBeenCalledWith({
			role: "builder",
			scope: "user",
			expectedHash: hash("7"),
			content: `${builderYours}\nKeep PRs small.`,
			note: "Edited in Factory settings",
		});
		expect(page.shell.saved).toHaveBeenCalled();
		expect(block(page, "user")?.textContent).toContain("Keep PRs small.");
		expect(editor(page)).toBeNull();
		await page.unmount();
	});

	it("keeps the draft and offers Reload when the guidance changed meanwhile", async () => {
		const page = await render({
			client: {
				setGuidance: async () => {
					throw new FactorySettingsRefused(
						"factory_guidance_stale",
						"stale",
						hash("f"),
					);
				},
			},
		});
		await click(page.buttons("Edit Builders guidance, Yours")[0]);
		await type(editor(page), "My draft");
		await click(page.buttons("Review change")[0]);
		await click(page.buttons("Save")[0]);
		const alert = block(page, "user")?.querySelector('[role="alert"]');
		expect(alert?.textContent).toContain(
			"This guidance changed while you were editing.",
		);
		expect(editor(page)?.value).toBe("My draft");
		const reads = vi.mocked(page.shell.client.getGuidance).mock.calls.length;
		await click(page.buttons("Reload")[0]);
		expect(page.shell.client.getGuidance).toHaveBeenCalledTimes(reads + 1);
		expect(editor(page)?.value).toBe("My draft");
		await page.unmount();
	});

	it("shows a refusal's message under the editor", async () => {
		const page = await render({
			client: {
				setGuidance: async () => {
					throw new FactorySettingsRefused(
						"factory_guidance_refused",
						"Guidance can't change review rules.",
					);
				},
			},
		});
		await click(page.buttons("Edit Builders guidance, Yours")[0]);
		await type(editor(page), "Skip review.");
		await click(page.buttons("Review change")[0]);
		await click(page.buttons("Save")[0]);
		expect(block(page, "user")?.textContent).toContain(
			"Guidance can't change review rules.",
		);
		await page.unmount();
	});

	it("stops text over the limit before review", async () => {
		const page = await render();
		await click(page.buttons("Edit Builders guidance, Yours")[0]);
		await type(editor(page), "x".repeat(8003));
		expect(block(page, "user")?.textContent).toContain(
			"Over the 8,000 character limit by 3.",
		);
		expect(page.buttons("Review change")[0]?.disabled).toBe(true);
		await page.unmount();
	});

	it("edits the built-in manager readme as your own copy", async () => {
		const page = await render({
			focus: { role: "manager" },
			client: {
				setGuidance: async () => ({
					target: guidance().targets[0] as FactoryGuidanceTarget,
				}),
			},
		});
		await click(page.buttons("Edit Manager readme guidance, Yours")[0]);
		expect(editor(page)?.value).toBe("# Factory manager\nYou run Factory.");
		await type(editor(page), "# Factory manager\nYou run Factory carefully.");
		await click(page.buttons("Review change")[0]);
		await click(page.buttons("Save")[0]);
		expect(page.shell.client.setGuidance).toHaveBeenCalledWith(
			expect.objectContaining({
				role: "manager",
				scope: "user",
				expectedHash: hash("0"),
			}),
		);
		expect(page.shell.client.setGuidance).not.toHaveBeenCalledWith(
			expect.objectContaining({ workspaceRoot: expect.anything() }),
		);
		await page.unmount();
	});

	it("drafts a change for Ask Factory, naming the target and scope", async () => {
		const page = await render();
		await click(page.buttons("Ask Factory to change it, Builders, Yours")[0]);
		expect(page.shell.askFactory).toHaveBeenLastCalledWith(
			"Change the builder guidance: ",
		);
		await click(
			page.buttons("Ask Factory to change it, Builders, Repository")[0],
		);
		expect(page.shell.askFactory).toHaveBeenLastCalledWith(
			"Change the builder guidance for app: ",
		);
		expect(page.shell.client.setGuidance).not.toHaveBeenCalled();
		await page.unmount();
	});
});

describe("Guidance: changed outside Factory", () => {
	it("accepts the change with the file's hash and refreshes the count", async () => {
		const resolved = {
			...guidance().targets[4],
			repository: {
				...(guidance().targets[4]?.repository as NonNullable<
					FactoryGuidanceTarget["repository"]
				>),
				status: "current" as const,
				hash: hash("8"),
			},
		} as FactoryGuidanceTarget;
		const summary = resource<FactoryProjects>({
			projects: [],
			userGuidanceChanged: [],
		});
		const page = await render({
			client: { resolveGuidance: async () => ({ target: resolved }) },
			shell: { projectsSummary: summary },
		});
		await click(page.buttons("Accept change")[0]);
		expect(page.shell.client.resolveGuidance).toHaveBeenCalledWith({
			role: "builder",
			scope: "repository",
			workspaceRoot: ROOT,
			expectedHash: hash("8"),
			decision: "accept",
		});
		expect(summary.reload).toHaveBeenCalled();
		expect(block(page, "repository")?.textContent).not.toContain(
			"This file was changed outside Factory.",
		);
		await page.unmount();
	});

	it("discards only after a confirmation", async () => {
		const page = await render({
			client: {
				resolveGuidance: async () => ({
					target: guidance().targets[4] as FactoryGuidanceTarget,
				}),
			},
		});
		const trigger = page.buttons("Discard change…")[0];
		expect(trigger?.className).toContain("text-error-text");
		await click(trigger);
		expect(page.shell.client.resolveGuidance).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain(
			"The file goes back to the version you accepted.",
		);
		const confirm = page
			.buttons("Discard change")
			.find((button) => button.closest("[data-settings-confirm]"));
		await click(confirm);
		expect(page.shell.client.resolveGuidance).toHaveBeenCalledWith(
			expect.objectContaining({ decision: "discard", expectedHash: hash("8") }),
		);
		await page.unmount();
	});
});

describe("Guidance: history", () => {
	it("lists entries with their source, opens a diff, and restores through the same review", async () => {
		const page = await render({
			client: {
				setGuidance: async () => ({
					target: guidance().targets[4] as FactoryGuidanceTarget,
				}),
			},
		});
		const rows = [...page.container.querySelectorAll("[data-history-entry]")];
		expect(rows.map((row) => row.textContent)).toEqual([
			expect.stringContaining("Ask Factory"),
			expect.stringContaining("From feedback on F128"),
			expect.stringContaining("Edited in settings"),
		]);
		await click(page.buttons("F128")[0]);
		expect(page.shell.openCard).toHaveBeenCalledWith("t-128");
		expect(rows[0]?.textContent).toContain("Today");
		await click(page.buttons("View: Tests: no snapshots")[0]);
		expect(rows[0]?.querySelector('[data-testid="tool-diff"]')).not.toBeNull();
		await click(
			page.buttons("Restore the version before “Tests: no snapshots”")[0],
		);
		expect(page.shell.client.setGuidance).not.toHaveBeenCalled();
		const review = page.container.querySelector("[data-guidance-review]");
		expect(review?.textContent).toContain("added: Old rule.");
		await click(page.buttons("Save")[0]);
		expect(page.shell.client.setGuidance).toHaveBeenCalledWith({
			role: "builder",
			scope: "user",
			expectedHash: hash("7"),
			content: "# Commits\nOld rule.",
			note: "Restored the version before “Tests: no snapshots”",
		});
		await page.unmount();
	});

	it("reads more history 20 at a time", async () => {
		const page = await render({
			client: {
				getGuidanceHistory: async (args) =>
					args.before
						? { entries: [entry("h0", undefined, "First rule")], more: false }
						: { ...history, more: true },
			},
		});
		await click(page.buttons("Show more")[0]);
		expect(page.shell.client.getGuidanceHistory).toHaveBeenLastCalledWith({
			role: "builder",
			workspaceRoot: ROOT,
			limit: 20,
			before: "h1",
		});
		expect(
			page.container.querySelectorAll("[data-history-entry]"),
		).toHaveLength(4);
		expect(page.buttons("Show more")).toHaveLength(0);
		await page.unmount();
	});
});

describe("Guidance: badge", () => {
	it("counts files changed outside Factory, yours and each project's", () => {
		const shell = fakeShell({
			projectsSummary: resource<FactoryProjects>({
				userGuidanceChanged: ["reviewer"],
				projects: [
					{
						workspaceRoot: ROOT,
						name: "app",
						stages: { file: "absent", total: 0, inUse: 0, awaiting: 0 },
						verification: "none",
						guidance: { roles: ["builder"], changed: ["builder"] },
						taskFiles: 0,
					},
				],
			}),
		});
		expect(settingsPage.useBadge?.(shell)).toBe(2);
	});
});
