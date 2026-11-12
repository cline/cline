// @vitest-environment jsdom
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFactoryWorkflowRecipe } from "@cline/core";
import { DEFAULT_FACTORY_AGENTS, type FactoryTaskConfig } from "@cline/shared";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	factoryIndependentReviewSupported,
	factoryRequiresIndependentReview,
	factoryReviewCoverage,
	withRequireIndependentReview,
} from "@/lib/factory-limits";
import { ensureLocalStorage } from "@/lib/test-local-storage";
import {
	readDesktopSettings,
	withBuiltInFactoryPresets,
	writeDesktopSettings,
} from "../../../../sidecar/desktop-settings";
import { handleFactoryCommand } from "../../../../sidecar/factory-commands";
import { DEFAULT_FACTORY } from "./factory-detail";
import {
	FactoryHandsOffNotice,
	HANDS_OFF_NOTICE_DISMISSED_KEY,
} from "./factory-hands-off-notice";
import {
	FactoryWorkflowEditor,
	factoryWorkflowSummary,
} from "./factory-workflow-editor";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(
		async (
			_command: string,
			_args?: Record<string, unknown>,
		): Promise<unknown> => undefined,
	),
}));
vi.mock("@/lib/desktop-client", () => ({ desktopClient: mocks }));

ensureLocalStorage();

let dataDir: string;
let container: HTMLDivElement;
let root: Root;
let config: FactoryTaskConfig;
const writeText = vi.fn(async (_text: string) => {});

beforeEach(() => {
	vi.clearAllMocks();
	dataDir = mkdtempSync(join(tmpdir(), "factory-workflow-editor-"));
	process.env.CLINE_DATA_DIR = dataDir;
	// Exercise the real sidecar save path so revisions come from core.
	mocks.invoke.mockImplementation(async (command, args) =>
		command === "get_desktop_settings"
			? readDesktopSettings()
			: handleFactoryCommand(
					{ pendingQuestions: new Map() },
					"factory_save_preset",
					args,
					async () => {
						throw new Error("Preset save must not access tasks");
					},
				),
	);
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText },
	});
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	delete process.env.CLINE_DATA_DIR;
	rmSync(dataDir, { recursive: true, force: true });
});

function button(label: string): HTMLButtonElement {
	const found = Array.from(document.querySelectorAll("button")).find((item) =>
		item.textContent?.includes(label),
	);
	if (!found) throw new Error(`Missing button ${label}`);
	return found;
}
function changeInput(selector: string, value: string) {
	const input = document.querySelector(selector);
	if (
		!(input instanceof HTMLInputElement) &&
		!(input instanceof HTMLTextAreaElement)
	)
		throw new Error(`Missing input ${selector}`);
	Object.getOwnPropertyDescriptor(
		input instanceof HTMLInputElement
			? HTMLInputElement.prototype
			: HTMLTextAreaElement.prototype,
		"value",
	)?.set?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}
const repairs = 'input[type="number"][max="10"]';

function Editor() {
	const [value, setValue] = useState(DEFAULT_FACTORY);
	config = value;
	return (
		<FactoryWorkflowEditor
			config={value}
			onChange={setValue}
			disabled={false}
		/>
	);
}

describe("Verifier app environment fields", () => {
	const field = (label: string) => `[aria-label="App ${label}"]`;
	async function enableVerifier() {
		await act(async () => root.render(<Editor />));
		expect(document.querySelector(field("start command"))).toBeNull();
		const toggle = Array.from(document.querySelectorAll("label"))
			.find((label) => label.textContent?.includes("Agent testing"))
			?.querySelector("input");
		if (!toggle) throw new Error("Missing agent testing toggle");
		await act(async () => toggle.click());
		expect(container.textContent).toContain(
			"App environment (Factory starts and stops it)",
		);
		expect(container.textContent).toContain(
			"Overrides the repository's verification setup",
		);
	}
	const revision = () =>
		createFactoryWorkflowRecipe({ name: "Repo app", config }).revision;

	it("writes agents.verifier.environment and removes it when every field is cleared", async () => {
		await enableVerifier();
		const unset = revision();
		const start = "bun run dev --port $FACTORY_APP_PORT";
		await act(async () => changeInput(field("start command"), start));
		expect(config.agents?.verifier?.environment).toEqual({ start });
		expect(container.textContent).not.toContain("Provide a setup");
		await act(async () => changeInput(field("ready timeout seconds"), "30"));
		expect(config.agents?.verifier?.environment).toEqual({
			start,
			readyTimeoutSeconds: 30,
		});
		expect(revision()).not.toBe(unset);

		await act(async () => changeInput(field("start command"), ""));
		await act(async () => changeInput(field("ready timeout seconds"), ""));
		expect(config.agents?.verifier).toEqual({});
		expect(revision()).toBe(unset);
	});

	it("explains a healthcheck without a start command and an invalid port variable", async () => {
		await enableVerifier();
		await act(async () => changeInput(field("setup command"), "bun install"));
		expect(container.textContent).not.toContain("needs a start command");
		await act(async () =>
			changeInput(field("healthcheck command"), "curl -fsS $FACTORY_APP_URL"),
		);
		expect(container.textContent).toContain(
			"A healthcheck needs a start command",
		);
		expect(config.agents?.verifier?.environment).toEqual({
			setup: "bun install",
			healthcheck: "curl -fsS $FACTORY_APP_URL",
		});
		await act(async () => changeInput(field("port variable"), "1PORT"));
		expect(container.textContent).toContain(
			"Port variable must be an environment variable name.",
		);
	});
});

describe("Hands-off policy controls", () => {
	const toggle = (text: string) => {
		const input = Array.from(document.querySelectorAll("label"))
			.find((label) => label.textContent?.includes(text))
			?.querySelector("input");
		if (!(input instanceof HTMLInputElement))
			throw new Error(`Missing ${text} toggle`);
		return input;
	};

	it("starts new workflows hands-off and writes autonomy and approval separately", async () => {
		await act(async () => root.render(<Editor />));
		const handsOff = toggle("Run new work to a draft PR automatically");
		const pause = toggle("Pause for my approval before building");
		expect(handsOff.checked).toBe(true);
		expect(pause.checked).toBe(false);
		expect(config).toMatchObject({
			autonomy: "hands_off",
			approval: "automatic",
		});

		await act(async () => handsOff.click());
		expect(config).not.toHaveProperty("autonomy");
		expect(config.approval).toBe("automatic");
		await act(async () => pause.click());
		expect(config.approval).toBe("required");

		await act(async () =>
			changeInput('[aria-label="Workflow name"]', "Manual"),
		);
		await act(async () => button("Save workflow").click());
		expect(readDesktopSettings().factoryPresets?.[0]?.config).toMatchObject({
			approval: "required",
		});
		expect(
			readDesktopSettings().factoryPresets?.[0]?.config,
		).not.toHaveProperty("autonomy");

		// Turning hands-off on also publishes, since it ends in a draft PR.
		await act(async () => handsOff.click());
		expect(config).toMatchObject({
			autonomy: "hands_off",
			approval: "required",
			publishPullRequest: true,
			// The engine no longer watches a hands-off draft PR by default.
			watchPullRequest: false,
		});
		await act(async () => pause.click());
		await act(async () => button("Save workflow").click());
		expect(readDesktopSettings().factoryPresets?.[0]?.config).toMatchObject({
			autonomy: "hands_off",
			approval: "automatic",
		});
	});

	it("says what the hands-off and approval switches do together, in every combination", async () => {
		await act(async () => root.render(<Editor />));
		const flow = () =>
			container.querySelector('[data-testid="factory-setting-flow"]')
				?.textContent;
		const handsOff = toggle("Run new work to a draft PR automatically");
		const pause = toggle("Pause for my approval before building");
		// The pause sits under hands-off as its refinement, still usable.
		expect(
			pause.closest('[data-factory-setting="approval"]')?.className,
		).toContain("pl-4");
		expect(pause.disabled).toBe(false);
		expect(flow()).toBe(
			"New work runs from request to draft PR without stopping.",
		);
		await act(async () => pause.click());
		expect(flow()).toBe(
			"New work stops once for you to approve its plan, then runs to a draft PR.",
		);
		expect(container.textContent).toContain(
			"Factory waits for you to approve each plan before it builds.",
		);
		await act(async () => handsOff.click());
		expect(flow()).toContain(
			"New work waits for you to approve its plan before building",
		);
		await act(async () => pause.click());
		expect(flow()).toContain(
			"New work builds as soon as its plan passes the check",
		);
	});

	it("uses sentence-case headings and the one word “workflow”", async () => {
		await act(async () => root.render(<Editor />));
		for (const heading of container.querySelectorAll("h4"))
			expect(heading.className).not.toContain("uppercase");
		const text = container.textContent ?? "";
		expect(text).not.toMatch(/\bpresets?\b/i);
		expect(text).not.toMatch(/\brecipe\b/i);
		expect(text).toContain("Saved workflows");
		expect(button("Save workflow")).toBeDefined();
	});

	it("writes a chosen model the same way as “Who checks the work”", async () => {
		function WithModel() {
			const [value, setValue] = useState<FactoryTaskConfig>({
				...DEFAULT_FACTORY,
				agents: {
					...(DEFAULT_FACTORY.agents ?? DEFAULT_FACTORY_AGENTS),
					designer: {
						modelSelection: { providerId: "cline", modelId: "openai/gpt-5" },
					},
				},
			});
			config = value;
			return (
				<FactoryWorkflowEditor
					config={value}
					onChange={setValue}
					disabled={false}
				/>
			);
		}
		await act(async () => root.render(<WithModel />));
		const text = container.textContent ?? "";
		expect(text).toContain("Plans: openai/gpt-5");
		expect(text).toContain("openai/gpt-5");
		expect(text).not.toContain("cline/openai/gpt-5");
	});

	it("asks for review by risk by default and writes the chosen policy as humanStamp", async () => {
		await act(async () => root.render(<Editor />));
		const policy = Array.from(document.querySelectorAll("fieldset")).find(
			(set) => set.querySelector("legend")?.textContent === "Ask for my review",
		);
		if (!policy) throw new Error("Missing review policy");
		const option = (label: string) => {
			const input = Array.from(policy.querySelectorAll("label"))
				.find((item) => item.textContent?.includes(label))
				?.querySelector("input");
			if (!(input instanceof HTMLInputElement))
				throw new Error(`Missing ${label}`);
			return input;
		};
		expect(policy.textContent).toContain("Only on risky changes (recommended)");
		// Unset reads as by risk for hands-off work and keeps the revision.
		expect(config).not.toHaveProperty("humanStamp");
		expect(option("Only on risky changes").checked).toBe(true);
		await act(async () => option("On every change").click());
		expect(config.humanStamp).toBe("always");
		expect(option("On every change").checked).toBe(true);
		await act(async () => option("Never").click());
		expect(config.humanStamp).toBe("never");
		await act(async () => changeInput('[aria-label="Workflow name"]', "Quiet"));
		await act(async () => button("Save workflow").click());
		expect(readDesktopSettings().factoryPresets?.[0]?.config).toMatchObject({
			humanStamp: "never",
		});
	});

	it("shows a one-time notice for a hands-off default and remembers its dismissal", async () => {
		writeDesktopSettings({
			cloudSessionsEnabled: false,
			factoryDefaultPreset: "Careful",
			factoryPresets: [
				createFactoryWorkflowRecipe({
					name: "Careful",
					config: { autonomy: "hands_off", approval: "automatic" },
				}),
			],
		});
		mocks.invoke.mockImplementation(async (command) =>
			command === "get_desktop_settings"
				? withBuiltInFactoryPresets(readDesktopSettings())
				: undefined,
		);
		window.localStorage.removeItem(HANDS_OFF_NOTICE_DISMISSED_KEY);
		await act(async () => root.render(<FactoryHandsOffNotice />));
		expect(container.textContent).toContain(
			"Factory now runs work to a draft PR on its own. To review plans first, turn on “Pause for my approval before building” in Factory settings.",
		);
		// The notice explains; it never asks for a click to change anything.
		expect(mocks.invoke).toHaveBeenCalledTimes(1);
		await act(async () =>
			(
				container.querySelector(
					'[aria-label="Dismiss notice"]',
				) as HTMLButtonElement
			).click(),
		);
		expect(container.textContent).toBe("");
		await act(async () => root.unmount());
		root = createRoot(container);
		await act(async () => root.render(<FactoryHandsOffNotice />));
		expect(container.textContent).toBe("");
	});

	it("hides the notice when the default no longer runs hands-off", async () => {
		writeDesktopSettings({
			cloudSessionsEnabled: false,
			factoryDefaultPreset: "Manual",
			factoryPresets: [
				createFactoryWorkflowRecipe({ name: "Manual", config: {} }),
			],
			factoryHandsOffUpgradeApplied: true,
		});
		mocks.invoke.mockImplementation(async (command) =>
			command === "get_desktop_settings"
				? withBuiltInFactoryPresets(readDesktopSettings())
				: undefined,
		);
		window.localStorage.removeItem(HANDS_OFF_NOTICE_DISMISSED_KEY);
		await act(async () => root.render(<FactoryHandsOffNotice />));
		expect(container.textContent).toBe("");
	});
});

describe("Factory settings layout", () => {
	it("shows the everyday settings and keeps the rest under a closed Advanced", async () => {
		await act(async () => root.render(<Editor />));
		const advanced = Array.from(container.querySelectorAll("details")).find(
			(item) =>
				item.querySelector("summary")?.textContent?.startsWith("Advanced"),
		);
		if (!advanced) throw new Error("Missing Advanced");
		expect(advanced.open).toBe(false);
		const outside = (text: string) =>
			Array.from(container.querySelectorAll("label")).some(
				(label) =>
					label.textContent?.includes(text) && !advanced.contains(label),
			);
		for (const label of [
			"Run new work to a draft PR automatically",
			"Pause for my approval before building",
			"Stop a card after $",
		])
			expect(outside(label)).toBe(true);
		for (const selector of [
			'[aria-label="Workflow name"]',
			'[aria-label="Apply a saved workflow"]',
			repairs,
		])
			expect(advanced.querySelector(selector)).not.toBeNull();
		expect(advanced.textContent).toContain("Agent testing");
		for (const sw of container.querySelectorAll('input[role="switch"]'))
			expect(sw.getAttribute("type")).toBe("checkbox");
	});

	it("counts participants with correct plurals", () => {
		expect(
			factoryWorkflowSummary({
				designer: {},
				implementers: [{}],
				planReviewers: [{}, {}],
				reviewers: [{}],
			}),
		).toBe("Workflow · 1 builder · 2 plan checkers · 1 code reviewer");
		expect(
			factoryWorkflowSummary({
				designer: {},
				implementers: [{}, {}],
				planReviewers: [],
				reviewers: [{}, {}],
				verifier: {},
			}),
		).toBe(
			"Workflow · 2 builders · 0 plan checkers · 2 code reviewers · agent testing",
		);
	});
});

function field(label: string): HTMLInputElement {
	const found = Array.from(container.querySelectorAll("label")).find((item) =>
		item.textContent?.includes(label),
	);
	const input = found?.querySelector("input");
	if (!input) throw new Error(`Missing field ${label}`);
	return input;
}
function typeInto(input: HTMLInputElement, value: string) {
	Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}
function section(name: string): HTMLElement {
	const found = container.querySelector(`section[aria-label="${name}"]`);
	if (!(found instanceof HTMLElement)) throw new Error(`Missing ${name}`);
	return found;
}

describe("Factory spending settings", () => {
	it("reads and writes the per-card limit, validating the amount", async () => {
		const save = mocks.invoke.getMockImplementation();
		mocks.invoke.mockImplementation(async (command, args) =>
			command === "get_desktop_settings"
				? withBuiltInFactoryPresets(readDesktopSettings())
				: save?.(command, args),
		);
		await act(async () => root.render(<Editor />));
		const spending = section("Spending");
		expect(spending.textContent).toContain("Stop a card after $");
		await act(async () => typeInto(field("Stop a card after $"), "25"));
		expect(config.maxCostUsd).toBe(25);
		for (const invalid of ["-5", "0", "1001"]) {
			await act(async () => typeInto(field("Stop a card after $"), invalid));
			expect(config.maxCostUsd).toBe(25);
			expect(spending.querySelector('[role="alert"]')?.textContent).toContain(
				"Enter an amount above $0 and up to $1,000",
			);
		}
		await act(async () => typeInto(field("Stop a card after $"), ""));
		expect(config.maxCostUsd).toBeUndefined();
		expect(spending.textContent).toContain(
			"No spending limit: Factory keeps working until you stop it",
		);
		// The daily limit belongs to the settings page's Hub limits only.
		expect(spending.textContent).not.toContain("per day");
	});
});

describe("Who checks the work", () => {
	it("flags the default workflow: one model builds and reviews, and nothing checks the plan or tests", async () => {
		await act(async () => root.render(<Editor />));
		const summary = section("Who checks the work");
		const lines = Array.from(summary.querySelectorAll("li")).map(
			(item) => item.textContent,
		);
		expect(lines).toEqual([
			"Plans: feature model",
			"Checks the plan: nobody",
			"Builds: feature model",
			"Tests: nobody",
			"Reviews: feature model (same model)",
		]);
		expect(summary.textContent).toContain(
			"The same model builds and reviews this work",
		);
		expect(summary.textContent).toContain(
			"No plan checker and no tester: only code review checks the work.",
		);
	});

	it("names each stage's models and stays quiet when review is independent", () => {
		const opus = { providerId: "anthropic", modelId: "claude-opus" };
		const gpt = { providerId: "openai", modelId: "gpt-5" };
		const coverage = factoryReviewCoverage({
			designer: { modelSelection: opus },
			planReviewers: [{ modelSelection: gpt }],
			implementers: [{ modelSelection: opus }],
			reviewers: [{ modelSelection: opus }],
		});
		expect(coverage.independent).toBe(true);
		expect(coverage.noPlanCheckOrTest).toBe(false);
		expect(coverage.builds.map(({ label }) => label)).toEqual(["claude-opus"]);
		// Only reviewers on the builder's model are not independent.
		expect(
			factoryReviewCoverage({
				designer: {},
				planReviewers: [],
				implementers: [{ modelSelection: opus }],
				reviewers: [{ modelSelection: opus }, { modelSelection: opus }],
				verifier: {},
			}),
		).toMatchObject({ independent: false, noPlanCheckOrTest: false });
		// A reviewer on the feature model differs from a builder on a chosen one.
		expect(
			factoryReviewCoverage({
				designer: {},
				planReviewers: [],
				implementers: [{ modelSelection: opus }],
				reviewers: [{}],
			}),
		).toMatchObject({ independent: true, noPlanCheckOrTest: true });
		// Profiles compare by their resolved model when known.
		expect(
			factoryReviewCoverage({
				designer: {},
				planReviewers: [],
				implementers: [{ modelSelection: opus }],
				reviewers: [
					{
						profile: "strict",
						resolvedProfile: {
							name: "strict",
							description: "",
							systemPrompt: "",
							providerId: "anthropic",
							modelId: "claude-opus",
						},
					},
				],
			}).independent,
		).toBe(false);
	});

	it("updates the summary from the participants and opens them with Edit roles", async () => {
		await act(async () => root.render(<Editor />));
		const advanced = Array.from(container.querySelectorAll("details")).find(
			(item) =>
				item.querySelector("summary")?.textContent?.startsWith("Advanced"),
		);
		if (!advanced) throw new Error("Missing Advanced");
		expect(advanced.open).toBe(false);
		await act(async () => button("Edit roles").click());
		expect(advanced.open).toBe(true);
		await act(async () => button("Add plan checker").click());
		await act(async () => field("Agent testing").click());
		const summary = section("Who checks the work");
		expect(summary.textContent).toContain(
			"Checks the plan: feature model (same model)",
		);
		expect(summary.textContent).toContain("Tests: feature model");
		expect(summary.textContent).not.toContain("No plan checker and no tester");
		expect(summary.textContent).toContain(
			"The same model builds and reviews this work",
		);
	});

	it("binds the review requirement, disabled until the workflow schema has it", async () => {
		await act(async () => root.render(<Editor />));
		const label =
			"Require a different model to review before approving automatically";
		const toggle = field(label);
		// Hands-off with the field unset reads as required.
		expect(toggle.checked).toBe(true);
		expect(toggle.disabled).toBe(!factoryIndependentReviewSupported());
		if (!factoryIndependentReviewSupported())
			expect(section("Who checks the work").textContent).toContain(
				"Update Cline to use this.",
			);
		expect(
			factoryIndependentReviewSupported({ requireIndependentReview: {} }),
		).toBe(true);
		expect(factoryRequiresIndependentReview(DEFAULT_FACTORY)).toBe(true);
		const manual = { ...DEFAULT_FACTORY, autonomy: undefined };
		expect(factoryRequiresIndependentReview(manual)).toBe(false);
		const off = withRequireIndependentReview(DEFAULT_FACTORY, false);
		expect(off).toMatchObject({ requireIndependentReview: false });
		expect(factoryRequiresIndependentReview(off)).toBe(false);
		expect(withRequireIndependentReview(off, undefined)).not.toHaveProperty(
			"requireIndependentReview",
		);
	});
});
