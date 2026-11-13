// @vitest-environment jsdom
import {
	DEFAULT_FACTORY_AGENTS,
	type FactoryWorkflowConfig,
	factoryWorkflowConfigSchema,
} from "@cline/shared/browser";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { desktopClient } from "@/lib/desktop-client";
import { FS_LIMITS } from "@/lib/factory-settings-copy/limits";
import { FS_PAGES, FS_SHELL } from "@/lib/factory-settings-copy/shell";
import { FactorySettingsPage } from "./factory-settings";
import { deadRows } from "./settings/test-utils";

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: vi.fn() },
}));
const invoke = vi.mocked(desktopClient.invoke);

const layout = vi.hoisted(() => ({ width: 0 }));
vi.mock("./use-element-size", () => ({
	useElementSize: () => [() => {}, { width: layout.width, height: 0 }],
}));

// The app's Radix select, as a native one: the trigger's labels go on it.
vi.mock("@/components/ui/select", async () =>
	(await import("./settings/test-utils")).nativeSelectModule(),
);

// The app's model picker: one button that picks the next model.
vi.mock("../chat/chat-input-bar", () => ({
	ModelSelector: ({
		model,
		onSelectionChange,
	}: {
		model: string;
		onSelectionChange: (selection: {
			providerId: string;
			modelId: string;
		}) => void;
	}) => (
		<button
			type="button"
			data-testid="model-picker"
			onClick={() =>
				onSelectionChange({ providerId: "openai-native", modelId: "gpt-next" })
			}
		>
			{model || "default"}
		</button>
	),
}));

const hash = "a".repeat(64);
const model = (providerId: string, modelId: string) => ({
	modelSelection: { providerId, modelId },
});
/** A code reviewer on a model no author uses. */
const independentAgents = {
	designer: model("anthropic", "claude-opus-5"),
	planReviewers: [],
	implementers: [model("anthropic", "claude-opus-5")],
	reviewers: [model("openai-native", "gpt-6")],
	verifier: {},
};
const workflow = (config: Record<string, unknown>): FactoryWorkflowConfig =>
	factoryWorkflowConfigSchema.parse(config);
const handsOff = (extra: Record<string, unknown> = {}) =>
	workflow({
		autonomy: "hands_off",
		approval: "automatic",
		maxCostUsd: 10,
		agents: independentAgents,
		...extra,
	});

let root: Root;
let container: HTMLDivElement;
let saved: {
	name: string;
	config: FactoryWorkflowConfig;
	useByDefault?: boolean;
}[];
let saveFails: string | undefined;
let stages: { status: string; stage: Record<string, unknown> }[];
let limitsReply: Record<string, unknown>;
let hubStatus: string;
/** `factory_get_projects`; undefined: this build has no such command. */
let projectsReply: unknown;

function serve(config: FactoryWorkflowConfig, name = "Hands-off") {
	let presets = [{ name, revision: hash, config }];
	invoke.mockImplementation(async (command: string, args?: unknown) => {
		const input = args as Record<string, unknown>;
		switch (command) {
			case "get_desktop_settings":
				return { factoryPresets: presets, factoryDefaultPreset: name };
			case "get_process_context":
				return {
					hub: { status: hubStatus, url: "ws://127.0.0.1:1", error: null },
				};
			case "factory_get_limits":
				return limitsReply;
			case "factory_set_limits":
				limitsReply = { ...limitsReply, ...input };
				return limitsReply;
			case "factory_save_preset": {
				saved.push(input as (typeof saved)[number]);
				if (saveFails) throw new Error(saveFails);
				presets = [
					{
						name: input.name as string,
						revision: hash,
						config: input.config as FactoryWorkflowConfig,
					},
				];
				return presets;
			}
			case "factory_get_projects":
				if (projectsReply === undefined) break;
				return typeof projectsReply === "function"
					? projectsReply()
					: projectsReply;
			case "factory_get_stages":
				return {
					file: "present",
					stages: stages.map((entry) => ({ ...entry, hash })),
				};
			case "factory_decide_stage":
				stages = stages.map((entry) =>
					entry.stage.id === input.stageId
						? { ...entry, status: input.decision as string }
						: entry,
				);
				return {
					file: "present",
					stages: stages.map((entry) => ({ ...entry, hash })),
				};
		}
		throw new Error(`unsupported desktop command: ${command}`);
	});
}

/** One project's summary, as `factory_get_projects` gives it. */
const summary = (workspaceRoot: string, awaiting = 0, extra = {}) => ({
	workspaceRoot,
	name: workspaceRoot.split("/").at(-1),
	stages: { file: "present", total: awaiting, inUse: 0, awaiting },
	verification: "none",
	guidance: { roles: [], changed: [] },
	taskFiles: 0,
	...extra,
});

async function render(
	props: Partial<Parameters<typeof FactorySettingsPage>[0]> = {},
) {
	await act(async () =>
		root.render(
			<FactorySettingsPage
				onBack={() => {}}
				projects={["/work/app"]}
				{...props}
			/>,
		),
	);
	await act(async () => {});
}

const control = <T extends Element = HTMLSelectElement>(id: string) => {
	const element = container.querySelector<T & Element>(
		`[data-setting="${id}"] select, [data-setting="${id}"] input, [data-setting="${id}"] [role="switch"]`,
	);
	if (!element) throw new Error(`No control for ${id}`);
	return element as unknown as T;
};
const toggle = (id: string) =>
	container.querySelector(
		`[data-setting="${id}"] [role="switch"]`,
	) as HTMLInputElement;
const row = (id: string) =>
	container.querySelector(`[data-setting="${id}"]`) as HTMLElement;
const buttons = (name: string | RegExp) =>
	[...document.querySelectorAll("button")].filter((button) =>
		typeof name === "string"
			? (button.getAttribute("aria-label") ?? button.textContent) === name
			: name.test(
					button.getAttribute("aria-label") ?? button.textContent ?? "",
				),
	);
async function choose(id: string, value: string) {
	const select = control<HTMLSelectElement>(id);
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			HTMLSelectElement.prototype,
			"value",
		)?.set?.call(select, value);
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
	await act(async () => {});
}
async function type(input: HTMLInputElement, value: string) {
	await act(async () => {
		input.focus();
		Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)?.set?.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}
async function key(element: Element, name: string) {
	await act(async () =>
		element.dispatchEvent(
			new KeyboardEvent("keydown", { key: name, bubbles: true }),
		),
	);
	await act(async () => {});
}
async function blur(input: HTMLElement) {
	await act(async () => input.blur());
	await act(async () => {});
}
async function click(element: Element | null | undefined) {
	await act(async () => (element as HTMLElement | undefined)?.click());
	await act(async () => {});
}
const navItem = (page: string) =>
	container.querySelector<HTMLElement>(`nav [data-settings-page="${page}"]`);
async function openPage(page: string) {
	await click(navItem(page));
}
const lastSaved = () => saved.at(-1)?.config;
const searchField = () =>
	container.querySelector<HTMLInputElement>('input[type="search"]');

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	invoke.mockReset();
	saved = [];
	saveFails = undefined;
	stages = [];
	hubStatus = "connected";
	projectsReply = undefined;
	limitsReply = {
		supported: true,
		concurrency: 3,
		paused: false,
		dailyCostUsd: 50,
		spentTodayUsd: 12.5,
	};
	layout.width = 0;
	sessionStorage.clear();
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("FactorySettingsPage shell", () => {
	it("has one way back and no Save button", async () => {
		serve(handsOff());
		const back = vi.fn();
		await render({ onBack: back });
		expect(
			[...container.querySelectorAll("[aria-label]")].filter(
				(element) => element.getAttribute("aria-label") === "Back to Factory",
			),
		).toHaveLength(1);
		expect(buttons(/^Save/)).toHaveLength(0);
		await click(buttons("Back to Factory")[0]);
		expect(back).toHaveBeenCalledOnce();
	});

	it("draws Ask Factory as an outline toggle, not a filled primary", async () => {
		serve(handsOff());
		await render({ onAskFactory: () => {} });
		const ask = () =>
			container.querySelector<HTMLElement>("[data-ask-factory]");
		const fill = () =>
			ask()?.getAttribute("class")?.split(/\s+/).includes("bg-surface-hover");
		expect(ask()?.getAttribute("class")).not.toContain("bg-primary");
		expect(ask()?.getAttribute("aria-pressed")).toBe("false");
		expect(fill()).toBe(false);
		await render({ onAskFactory: () => {}, askFactoryOpen: true });
		expect(ask()?.getAttribute("aria-pressed")).toBe("true");
		expect(fill()).toBe(true);
	});

	it("lists five groups and eleven pages, Automation first", async () => {
		serve(handsOff());
		await render();
		const nav = container.querySelector('nav[aria-label="Factory settings"]');
		expect(
			[...(nav?.querySelectorAll("h3") ?? [])].map((h) => h.textContent),
		).toEqual([
			"Factory",
			"Workers",
			"Pipeline",
			"Where work runs",
			"Advanced",
		]);
		const items = [...(nav?.querySelectorAll("[data-settings-page]") ?? [])];
		expect(items.map((item) => item.textContent)).toEqual(
			Object.values(FS_PAGES),
		);
		expect(navItem("automation")?.getAttribute("aria-current")).toBe("page");
		expect(container.querySelector("h2")?.textContent).toBe("Automation");
		await openPage("limits");
		expect(container.querySelector("h2")?.textContent).toBe(
			"Limits & spending",
		);
		expect(sessionStorage.getItem("factory.settingsSection")).toBe("limits");
	});

	it.each([
		["general", "Automation"],
		["models", "Roles & models"],
		["limits", "Limits & spending"],
	])("maps the saved section %s to its page", async (saved, heading) => {
		sessionStorage.setItem("factory.settingsSection", saved);
		serve(handsOff());
		await render();
		expect(container.querySelector("h2")?.textContent).toBe(heading);
	});

	it("opens a deep link on its row, and the spending banner's link on the daily limit", async () => {
		serve(handsOff());
		await render({ focus: "dailyCostUsd" });
		expect(container.querySelector("h2")?.textContent).toBe(
			"Limits & spending",
		);
		expect(document.activeElement).toBe(control("dailyCostUsd"));
		await act(async () => root.unmount());
		root = createRoot(container);
		await render({ focus: { page: "automation", row: "maxRepairRounds" } });
		// Its field is disabled until the workflow is read; focus follows.
		await act(async () => new Promise((done) => setTimeout(done, 150)));
		expect(document.activeElement).toBe(control("maxRepairRounds"));
	});

	it("searches row titles and descriptions; Enter opens the page and focuses the row", async () => {
		serve(handsOff());
		await render();
		const search = searchField();
		if (!search) throw new Error("No search field");
		await type(search, "daily");
		const hits = [...container.querySelectorAll('[role="option"]')];
		expect(hits.map((hit) => hit.getAttribute("data-search-hit"))).toEqual([
			"dailyCostUsd",
		]);
		expect(container.querySelector("nav [data-settings-page]")).toBeNull();
		await key(search, "Enter");
		expect(container.querySelector("h2")?.textContent).toBe(
			"Limits & spending",
		);
		expect(document.activeElement).toBe(control("dailyCostUsd"));
		// Esc clears and the page list returns.
		await type(search, "nothing matches this");
		expect(container.textContent).toContain(
			FS_SHELL.noResults("nothing matches this"),
		);
		await key(search, "Escape");
		expect(search.value).toBe("");
		expect(navItem("automation")).not.toBeNull();
	});

	it.each([
		{ width: 440, menu: true },
		{ width: 719, menu: true },
		{ width: 780, menu: false },
		{ width: 0, menu: false },
	])("folds the section list into a page menu under 720px ($width)", async ({
		width,
		menu,
	}) => {
		layout.width = width;
		serve(handsOff());
		await render();
		const button = container.querySelector<HTMLElement>(
			"[data-settings-page-menu]",
		);
		expect(button !== null).toBe(menu);
		expect(
			container.querySelector('nav[aria-label="Factory settings"]') !== null,
		).toBe(!menu);
		if (!menu) return;
		expect(button?.getAttribute("aria-haspopup")).toBe("menu");
		expect(button?.textContent).toContain("Automation");
		await click(button);
		const items = [...container.querySelectorAll('[role="menuitem"]')];
		expect(items).toHaveLength(11);
		await click(items.find((item) => item.textContent === "Limits & spending"));
		expect(container.querySelector('[role="menu"]')).toBeNull();
		expect(container.querySelector("h2")?.textContent).toBe(
			"Limits & spending",
		);
	});

	it("counts what waits for a decision from the projects summary", async () => {
		projectsReply = {
			projects: [
				summary("/work/app", 2, {
					verification: "proposed",
					guidance: { roles: ["builder"], changed: ["builder"] },
				}),
			],
			userGuidanceChanged: ["reviewer"],
		};
		serve(handsOff());
		await render();
		const badge = (page: string) =>
			navItem(page)?.querySelector("[data-settings-badge]")?.textContent;
		expect(badge("stages")).toBe("2 (2 stages need approval)");
		expect(badge("verification")).toBe("1 (1 test setup needs approval)");
		expect(badge("guidance")).toBe(
			"2 (2 guidance files changed outside Factory)",
		);
		expect(badge("automation")).toBeUndefined();
	});

	it("shows the last known values, read-only, while the Hub can't be reached", async () => {
		hubStatus = "disconnected";
		serve(handsOff());
		await render();
		expect(container.textContent).toContain(FS_SHELL.hubUnreachable);
		expect(control("approval").disabled).toBe(true);
		hubStatus = "connected";
		await click(buttons(FS_SHELL.retry)[0]);
		expect(container.textContent).not.toContain(FS_SHELL.hubUnreachable);
		expect(control("approval").disabled).toBe(false);
	});

	it("opens the app's notification settings", async () => {
		serve(handsOff());
		const openAppSettings = vi.fn();
		await render({ onOpenAppSettings: openAppSettings });
		await click(buttons("Open notification settings")[0]);
		expect(openAppSettings).toHaveBeenCalledWith("General");
	});

	it("never asks for ratings or feedback, and has no dead rows", async () => {
		serve(handsOff());
		await render();
		let text = "";
		for (const page of Object.keys(FS_PAGES)) {
			await openPage(page);
			text += container.textContent ?? "";
			if (page === "automation" || page === "limits")
				expect(deadRows(container)).toEqual([]);
		}
		expect(text).not.toMatch(/rating|rate this|feedback|thumbs/i);
	});
});

describe("Automation", () => {
	describe("plan approval mapping", () => {
		it.each([
			{
				label: "hands-off, automatic",
				config: handsOff(),
				shown: "automatic",
				note: undefined,
			},
			{
				label: "hands-off, every plan",
				config: handsOff({ approval: "required" }),
				shown: "required",
				note: undefined,
			},
			{
				label: "older, automatic",
				config: workflow({ approval: "automatic", agents: independentAgents }),
				shown: "automatic",
				note: false,
			},
			{
				label: "older, every plan",
				config: workflow({ approval: "required", agents: independentAgents }),
				shown: "required",
				note: true,
			},
		])("shows $label without saving anything", async ({
			config,
			shown,
			note,
		}) => {
			serve(config);
			await render();
			expect(control("approval").value).toBe(shown);
			const older = container.querySelector(
				'[data-testid="factory-settings-older"]',
			);
			if (note === undefined) expect(older).toBeNull();
			else {
				expect(older?.textContent).toContain("Saved by an older version.");
				expect(older?.textContent?.includes("stays on a local branch")).toBe(
					note,
				);
			}
			expect(saved).toEqual([]);
		});

		it("writes approval only, keeping hands-off", async () => {
			serve(handsOff());
			await render();
			await choose("approval", "required");
			expect(saved).toHaveLength(1);
			expect(saved[0]).toMatchObject({ name: "Hands-off", useByDefault: true });
			expect(lastSaved()).toMatchObject({
				autonomy: "hands_off",
				approval: "required",
			});
		});

		it("never adds autonomy to an older workflow until Update", async () => {
			serve(
				workflow({ approval: "automatic", agents: independentAgents }),
				"Mine",
			);
			await render();
			await choose("approval", "required");
			expect(lastSaved()).toMatchObject({ approval: "required" });
			expect(lastSaved()?.autonomy).toBeUndefined();
			// The older default reads as every change; changing it keeps manual.
			expect(control("humanStamp").value).toBe("always");
			await choose("humanStamp", "never");
			expect(lastSaved()).toMatchObject({ humanStamp: "never" });
			expect(lastSaved()?.autonomy).toBeUndefined();
			expect(saved.every((entry) => entry.name === "Mine")).toBe(true);
		});

		it("Update turns on hands-off and pins what the page showed", async () => {
			serve(workflow({ approval: "automatic", agents: independentAgents }));
			await render();
			expect(
				container.querySelector('[data-testid="factory-settings-older"]')
					?.textContent,
			).toContain("sets a $10 card limit");
			expect(control("humanStamp").value).toBe("always");
			await click(buttons("Update the workflow")[0]);
			expect(saved).toHaveLength(1);
			expect(lastSaved()).toMatchObject({
				autonomy: "hands_off",
				approval: "automatic",
				humanStamp: "always",
				reviewMode: "fixed",
				requireIndependentReview: false,
			});
			expect(
				container.querySelector('[data-testid="factory-settings-older"]'),
			).toBeNull();
			expect(control("humanStamp").value).toBe("always");
		});
	});

	it("saves each change at once, and rolls back with the error under the row", async () => {
		serve(handsOff());
		await render();
		expect(control("humanStamp").value).toBe("by_risk");
		await choose("humanStamp", "always");
		expect(saved).toHaveLength(1);
		expect(container.textContent).toContain(FS_SHELL.saved);
		saveFails = "Settings file is read-only.";
		await choose("humanStamp", "never");
		expect(saved).toHaveLength(2);
		expect(control("humanStamp").value).toBe("always");
		expect(row("humanStamp").querySelector('[role="alert"]')?.textContent).toBe(
			"Settings file is read-only.",
		);
		expect(row("approval").querySelector('[role="alert"]')).toBeNull();
	});

	it("writes Keep the PR passing, suggested rules, fix rounds and retries", async () => {
		serve(handsOff());
		await render();
		// Unset is on for hands-off work.
		expect(toggle("watchPullRequest").checked).toBe(true);
		await click(toggle("watchPullRequest"));
		expect(saved).toHaveLength(1);
		expect(lastSaved()?.watchPullRequest).toBe(false);
		expect(toggle("repoRules").checked).toBe(false);
		await click(toggle("repoRules"));
		expect(lastSaved()?.repoRules).toBe(true);
		const rounds = control<HTMLInputElement>("maxRepairRounds");
		expect(rounds.value).toBe("2");
		await type(rounds, "11");
		await blur(rounds);
		expect(row("maxRepairRounds").textContent).toContain(
			"Enter a whole number from 0 to 10.",
		);
		expect(saved).toHaveLength(2);
		await type(rounds, "4");
		await key(rounds, "Enter");
		expect(lastSaved()?.maxRepairRounds).toBe(4);
		const retries = control<HTMLInputElement>("maxRuntimeRetries");
		await type(retries, "0");
		await blur(retries);
		expect(lastSaved()?.maxRuntimeRetries).toBe(0);
		expect(saved).toHaveLength(4);
	});

	it("marks pull requests ready only with an independent reviewer", async () => {
		serve(handsOff({ agents: DEFAULT_FACTORY_AGENTS }));
		const open = vi.fn();
		await render();
		const option = () =>
			control("pullRequestReady").querySelector<HTMLOptionElement>(
				'option[value="when_no_review_required"]',
			);
		expect(control("pullRequestReady").value).toBe("never");
		expect(option()?.disabled).toBe(true);
		expect(row("pullRequestReady").textContent).toContain(
			"needs a reviewer on a different model. Set one in Roles & models.",
		);
		await click(buttons("Set one in Roles & models")[0]);
		expect(container.querySelector("h2")?.textContent).toBe("Roles & models");
		expect(open).not.toHaveBeenCalled();
		await act(async () => root.unmount());
		root = createRoot(container);
		sessionStorage.clear();
		serve(handsOff());
		await render();
		expect(option()?.disabled).toBe(false);
		await choose("pullRequestReady", "when_no_review_required");
		expect(lastSaved()?.pullRequestReady).toBe("when_no_review_required");
		expect(row("pullRequestReady").textContent).toContain(
			"Factory never merges.",
		);
	});

	it("names the default workflow in the scope line and opens Workflows from it", async () => {
		serve(handsOff(), "Careful");
		await render();
		const scope = container.querySelector("[data-page-scope]");
		expect(scope?.textContent).toBe(
			"For new work in every project. Work already started keeps its settings. Saved to the default workflow, Careful.",
		);
		await click(scope?.querySelector("button"));
		expect(container.querySelector("h2")?.textContent).toBe("Workflows");
	});
});

describe("Limits & spending", () => {
	it("commits spending fields on blur or Enter, with validation", async () => {
		serve(handsOff());
		await render({ focus: { page: "limits" } });
		const card = control<HTMLInputElement>("maxCostUsd");
		expect(card.value).toBe("10.00");
		await type(card, "2000");
		expect(row("maxCostUsd").textContent).toContain("up to $1,000");
		await blur(card);
		expect(saved).toEqual([]);
		await type(card, "25");
		expect(saved).toEqual([]);
		await blur(card);
		expect(lastSaved()?.maxCostUsd).toBe(25);
		await type(card, "");
		await key(card, "Enter");
		expect(saved).toHaveLength(2);
		expect(lastSaved()?.maxCostUsd).toBeUndefined();
		// Hands-off work still stops at the built-in limit.
		expect(row("maxCostUsd").textContent).toContain("built-in $10");

		const daily = control<HTMLInputElement>("dailyCostUsd");
		expect(row("dailyCostUsd").textContent).toContain(
			FS_LIMITS.spentToday("$12.50"),
		);
		await type(daily, "80");
		expect(invoke).not.toHaveBeenCalledWith(
			"factory_set_limits",
			expect.anything(),
		);
		await blur(daily);
		expect(invoke).toHaveBeenCalledWith("factory_set_limits", {
			dailyCostUsd: 80,
		});
		expect(container.textContent).toContain(FS_SHELL.saved);
		// Empty is no limit, said in amber.
		await type(daily, "");
		await blur(daily);
		expect(invoke).toHaveBeenLastCalledWith("factory_set_limits", {
			dailyCostUsd: null,
		});
		expect(row("dailyCostUsd").textContent).toContain(FS_LIMITS.noDailyLimit);
	});

	it("changes work at once at once", async () => {
		serve(handsOff());
		await render({ focus: { page: "limits" } });
		expect(control("concurrency").value).toBe("3");
		await choose("concurrency", "5");
		expect(invoke).toHaveBeenCalledWith("factory_set_limits", {
			concurrency: 5,
		});
		expect(control("concurrency").value).toBe("5");
	});

	it("disables work at once with a note when the Hub has no limit setting", async () => {
		limitsReply = { supported: false };
		serve(handsOff());
		await render({ focus: { page: "limits" } });
		expect(control("concurrency").disabled).toBe(true);
		expect(row("concurrency").textContent).toContain(FS_SHELL.hubTooOld);
		expect(row("concurrency").querySelector('[role="alert"]')).toBeNull();
	});

	it("shows Resume only while new work is paused", async () => {
		serve(handsOff());
		await render({ focus: { page: "limits" } });
		expect(container.textContent).not.toContain(FS_LIMITS.pausedTitle);
		expect(buttons(/^Pause/)).toHaveLength(0);
		await act(async () => root.unmount());
		root = createRoot(container);
		limitsReply = { ...limitsReply, paused: true };
		await render({ focus: { page: "limits" } });
		expect(container.textContent).toContain(FS_LIMITS.pausedTitle);
		await click(buttons(FS_LIMITS.resume)[0]);
		expect(invoke).toHaveBeenCalledWith("factory_set_limits", {
			paused: false,
		});
		expect(container.textContent).not.toContain(FS_LIMITS.pausedTitle);
	});

	it("reveals the built-in limits on request", async () => {
		serve(handsOff());
		await render({ focus: { page: "limits" } });
		const toggle = row("builtInLimits").querySelector("button[aria-expanded]");
		expect(toggle?.getAttribute("aria-expanded")).toBe("false");
		expect(row("builtInLimits").textContent).not.toContain("Quick plan check");
		await click(toggle);
		expect(toggle?.getAttribute("aria-expanded")).toBe("true");
		expect(row("builtInLimits").textContent).toContain(
			"20 steps, 5 minutes, for plans that arrive already scoped",
		);
	});
});

describe("Interim pages", () => {
	it("changes each role's model through the model picker", async () => {
		serve(
			handsOff({
				agents: {
					...independentAgents,
					planReviewers: [model("openai-native", "gpt-6")],
					verifier: model("openai-native", "gpt-6"),
				},
			}),
		);
		await render({ focus: { page: "roles" } });
		await click(
			row("implementers").querySelector('[data-testid="model-picker"]'),
		);
		expect(lastSaved()?.agents?.implementers[0]?.modelSelection).toEqual({
			providerId: "openai-native",
			modelId: "gpt-next",
		});
	});

	it("lists a project's stages with one decision each, and refreshes the count", async () => {
		stages = [
			{
				status: "approved",
				stage: {
					id: "scan",
					name: "Security scan",
					kind: "command",
					command: "bun run scan",
				},
			},
			{
				status: "needs_approval",
				stage: {
					id: "docs",
					name: "Docs update",
					kind: "agent",
					access: "write",
					instruction: "Update docs/ only.",
				},
			},
		];
		projectsReply = () => ({
			projects: [
				summary(
					"/work/app",
					stages.filter((entry) => entry.status === "needs_approval").length,
				),
			],
			userGuidanceChanged: [],
		});
		serve(handsOff());
		await render();
		expect(navItem("stages")?.textContent).toContain("1");
		await openPage("stages");
		const waiting = container.querySelector('[data-status="needs_approval"]');
		expect(waiting?.textContent).toContain("Update docs/ only.");
		await click(buttons("Approve")[0]);
		expect(invoke).toHaveBeenCalledWith("factory_decide_stage", {
			workspaceRoot: "/work/app",
			stageId: "docs",
			expectedHash: hash,
			decision: "approved",
		});
		expect(
			navItem("stages")?.querySelector("[data-settings-badge]"),
		).toBeNull();
	});

	it("opens project pages on the first project waiting for a decision, shared across pages", async () => {
		projectsReply = {
			projects: [summary("/work/api"), summary("/work/app", 1)],
			userGuidanceChanged: [],
		};
		serve(handsOff());
		await render({
			projects: ["/work/api", "/work/app"],
			focus: { page: "stages" },
		});
		expect(control("settings-project").value).toBe("/work/app");
		await choose("settings-project", "/work/api");
		expect(sessionStorage.getItem("factory.settingsProject")).toBe("/work/api");
		await act(async () => root.unmount());
		root = createRoot(container);
		await render({ projects: ["/work/api", "/work/app"] });
		await openPage("stages");
		expect(control("settings-project").value).toBe("/work/api");
	});

	it("opens a project Factory knows that has no card on the board", async () => {
		projectsReply = {
			projects: [summary("/work/app"), summary("/work/lib")],
			userGuidanceChanged: [],
		};
		serve(handsOff());
		await render({ focus: { page: "stages", project: "/work/lib" } });
		expect(control("settings-project").value).toBe("/work/lib");
	});
});
