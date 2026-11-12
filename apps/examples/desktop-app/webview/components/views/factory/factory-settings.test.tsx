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
import { FACTORY_SETTINGS } from "@/lib/factory-copy";
import { FactorySettingsPage } from "./factory-settings";

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: vi.fn() },
}));
const invoke = vi.mocked(desktopClient.invoke);

const layout = vi.hoisted(() => ({ width: 0 }));
vi.mock("./use-element-width", () => ({
	useElementWidth: () => [() => {}, layout.width],
}));

// The app's Radix select, as a native one: the trigger's labels go on it.
vi.mock("@/components/ui/select", async () => {
	const React = await import("react");
	type Ctx = {
		value?: string;
		disabled?: boolean;
		onValueChange: (value: string) => void;
		trigger: Record<string, unknown>;
	};
	const Context = React.createContext<Ctx | null>(null);
	return {
		Select: ({
			value,
			disabled,
			onValueChange,
			children,
		}: Omit<Ctx, "trigger"> & { children: React.ReactNode }) => (
			<Context.Provider value={{ value, disabled, onValueChange, trigger: {} }}>
				{children}
			</Context.Provider>
		),
		SelectTrigger: ({
			children: _children,
			className: _className,
			size: _size,
			...props
		}: Record<string, unknown>) => {
			const context = React.useContext(Context);
			if (context) Object.assign(context.trigger, props);
			return null;
		},
		SelectValue: () => null,
		SelectContent: ({ children }: { children: React.ReactNode }) => {
			const context = React.useContext(Context);
			return (
				<select
					{...(context?.trigger ?? {})}
					value={context?.value ?? ""}
					disabled={context?.disabled}
					onChange={(event) => context?.onValueChange(event.target.value)}
				>
					{children}
				</select>
			);
		},
		SelectItem: ({
			value,
			disabled,
			children,
		}: {
			value: string;
			disabled?: boolean;
			children: React.ReactNode;
		}) => (
			<option value={value} disabled={disabled}>
				{children}
			</option>
		),
	};
});

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

function serve(config: FactoryWorkflowConfig, name = "Hands-off") {
	let presets = [{ name, revision: hash, config }];
	invoke.mockImplementation(async (command: string, args?: unknown) => {
		const input = args as Record<string, unknown>;
		switch (command) {
			case "get_desktop_settings":
				return { factoryPresets: presets, factoryDefaultPreset: name };
			case "factory_get_limits":
				return {
					supported: true,
					concurrency: 3,
					dailyCostUsd: 50,
					spentTodayUsd: 12.5,
				};
			case "factory_set_limits":
				return {
					supported: true,
					concurrency: 3,
					dailyCostUsd: 50,
					spentTodayUsd: 12.5,
					...input,
				};
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
		throw new Error(`Unexpected command ${command}`);
	});
}

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
const row = (id: string) =>
	container.querySelector(`[data-setting="${id}"]`) as HTMLElement;
const buttons = (name: string | RegExp) =>
	[...container.querySelectorAll("button")].filter((button) =>
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
async function blur(input: HTMLElement) {
	await act(async () => input.blur());
	await act(async () => {});
}
async function click(element: Element | undefined) {
	await act(async () => (element as HTMLElement | undefined)?.click());
	await act(async () => {});
}
async function openSection(id: "general" | "models" | "projects") {
	await click(container.querySelector(`[data-section="${id}"]`) ?? undefined);
}
const lastSaved = () => saved.at(-1)?.config;

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
	layout.width = 0;
	sessionStorage.clear();
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("FactorySettingsPage", () => {
	it("has one way back and no Save button", async () => {
		serve(handsOff());
		const back = vi.fn();
		await render({ onBack: back });
		expect(
			[...container.querySelectorAll("[aria-label]")].filter(
				(element) => element.getAttribute("aria-label") === "Back to Factory",
			),
		).toHaveLength(1);
		expect(buttons(FACTORY_SETTINGS.title)).toHaveLength(0);
		expect(buttons(/^Save/)).toHaveLength(0);
		await click(buttons("Back to Factory")[0]);
		expect(back).toHaveBeenCalledOnce();
	});

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
			await click(buttons("Update")[0]);
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
			// Nothing on the page moved.
			expect(control("humanStamp").value).toBe("always");
		});
	});

	it("saves each change at once, and rolls back with the error under the row", async () => {
		serve(handsOff());
		await render();
		expect(control("humanStamp").value).toBe("by_risk");
		await choose("humanStamp", "always");
		expect(saved).toHaveLength(1);
		expect(container.textContent).toContain(FACTORY_SETTINGS.saved);
		saveFails = "Settings file is read-only.";
		await choose("humanStamp", "never");
		expect(saved).toHaveLength(2);
		expect(control("humanStamp").value).toBe("always");
		expect(row("humanStamp").querySelector('[role="alert"]')?.textContent).toBe(
			"Settings file is read-only.",
		);
		expect(row("approval").querySelector('[role="alert"]')).toBeNull();
	});

	it("commits spending fields on blur or Enter, with validation", async () => {
		serve(handsOff());
		await render();
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
		await act(async () =>
			card.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			),
		);
		await act(async () => {});
		expect(saved).toHaveLength(2);
		expect(lastSaved()?.maxCostUsd).toBeUndefined();
		// Hands-off work still stops at the built-in limit.
		expect(row("maxCostUsd").textContent).toContain("built-in $10");

		const daily = control<HTMLInputElement>("dailyCostUsd");
		expect(row("dailyCostUsd").textContent).toContain("Spent today: $12.50");
		await type(daily, "80");
		expect(invoke).not.toHaveBeenCalledWith(
			"factory_set_limits",
			expect.anything(),
		);
		await blur(daily);
		expect(invoke).toHaveBeenCalledWith("factory_set_limits", {
			dailyCostUsd: 80,
		});
	});

	it("disables work at once with a note when the Hub has no limit setting", async () => {
		serve(handsOff());
		const served = invoke.getMockImplementation();
		invoke.mockImplementation(
			async (command: string, args?: Record<string, unknown>) =>
				command === "factory_get_limits"
					? { supported: false }
					: served?.(command, args),
		);
		await render();
		expect(control("concurrency").disabled).toBe(true);
		expect(row("concurrency").textContent).toContain(
			FACTORY_SETTINGS.general.workAtOnceUnsupported,
		);
		expect(row("concurrency").querySelector('[role="alert"]')).toBeNull();
	});

	it("marks pull requests ready only with an independent reviewer", async () => {
		serve(handsOff({ agents: DEFAULT_FACTORY_AGENTS }));
		await render();
		const option = () =>
			control("pullRequestReady").querySelector<HTMLOptionElement>(
				'option[value="when_no_review_required"]',
			);
		expect(control("pullRequestReady").value).toBe("never");
		expect(option()?.disabled).toBe(true);
		expect(row("pullRequestReady").textContent).toContain(
			"Needs a reviewer on a different model (Models)",
		);
		await act(async () => root.unmount());
		root = createRoot(container);
		serve(handsOff());
		await render();
		expect(option()?.disabled).toBe(false);
		await choose("pullRequestReady", "when_no_review_required");
		expect(lastSaved()?.pullRequestReady).toBe("when_no_review_required");
		expect(row("pullRequestReady").textContent).toContain(
			"Factory never merges.",
		);
	});

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
		await render();
		await openSection("models");
		await click(
			row("implementers").querySelector('[data-testid="model-picker"]') ??
				undefined,
		);
		expect(lastSaved()?.agents?.implementers[0]?.modelSelection).toEqual({
			providerId: "openai-native",
			modelId: "gpt-next",
		});
		// At the minimum there is nothing to remove; plan checkers may be none.
		expect(buttons("Remove builder 1")).toHaveLength(0);
		expect(buttons("Remove plan checker 1")).toHaveLength(1);
		expect(buttons("Add builder")).toHaveLength(1);
		await click(control("verifier"));
		expect(lastSaved()?.agents?.verifier).toBeUndefined();
		expect(
			row("verifier").querySelector('[data-testid="model-picker"]'),
		).toBeNull();
	});

	it("imports a workflow file only when it is valid and its name is free", async () => {
		serve(handsOff());
		await render();
		await openSection("models");
		const json = container.querySelector<HTMLTextAreaElement>(
			'[aria-label="Workflow JSON"]',
		);
		if (!json) throw new Error("Missing workflow JSON");
		const importAs = async (text: string) => {
			await act(async () => {
				Object.getOwnPropertyDescriptor(
					HTMLTextAreaElement.prototype,
					"value",
				)?.set?.call(json, text);
				json.dispatchEvent(new Event("input", { bubbles: true }));
			});
			await click(buttons("Import workflow")[0]);
		};
		await importAs("{");
		expect(row("workflowFile").textContent).toContain("valid JSON");
		const recipe = (name: string, revision: string) =>
			JSON.stringify({ schemaVersion: 1, name, revision, config: {} });
		await importAs(recipe("Hands-off", "b".repeat(64)));
		expect(row("workflowFile").textContent).toContain(
			"A different saved workflow is named",
		);
		expect(saved).toEqual([]);
		await importAs(recipe("Shared", "b".repeat(64)));
		expect(saved.map((item) => item.name)).toEqual(["Shared"]);
		expect(saved[0]?.useByDefault).toBeUndefined();
	});

	it("lists a project's stages with one decision each and counts those awaiting one", async () => {
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
		serve(handsOff());
		await render();
		const projects = container.querySelector('[data-section="projects"]');
		expect(projects?.textContent).toContain("1");
		await openSection("projects");
		const actions = (status: string) =>
			[
				...(container
					.querySelector(`[data-status="${status}"]`)
					?.querySelectorAll("button:not([aria-expanded])") ?? []),
			].map((button) => button.textContent);
		const waiting = container.querySelector('[data-status="needs_approval"]');
		expect(waiting?.textContent).toContain("Update docs/ only.");
		expect(actions("needs_approval")).toEqual(["Approve"]);
		expect(actions("approved")).toEqual(["Stop using"]);
		// The list and the count are one read.
		expect(
			invoke.mock.calls.filter(([command]) => command === "factory_get_stages"),
		).toHaveLength(1);
		await click(buttons("Approve")[0]);
		expect(invoke).toHaveBeenCalledWith("factory_decide_stage", {
			workspaceRoot: "/work/app",
			stageId: "docs",
			expectedHash: hash,
			decision: "approved",
		});
		expect(projects?.textContent).not.toContain("1");
	});

	it.each([
		{ width: 440, tabs: true },
		{ width: 780, tabs: false },
		{ width: 0, tabs: false },
	])("lays sections out as tabs only under 720px ($width)", async ({
		width,
		tabs,
	}) => {
		layout.width = width;
		serve(handsOff());
		await render();
		expect(container.querySelector('[role="tablist"]') !== null).toBe(tabs);
		expect(
			container.querySelector('nav[aria-label="Factory settings sections"]') !==
				null,
		).toBe(!tabs);
		expect(
			container
				.querySelector('[data-section="general"]')
				?.getAttribute(tabs ? "aria-selected" : "aria-current"),
		).toBe(tabs ? "true" : "page");
	});

	it("never asks for ratings or feedback", async () => {
		serve(handsOff());
		await render();
		let text = container.textContent ?? "";
		for (const section of ["models", "projects"] as const) {
			await openSection(section);
			text += container.textContent ?? "";
		}
		expect(text).not.toMatch(/rating|rate this|feedback|thumbs/i);
	});
});
