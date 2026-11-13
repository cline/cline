// @vitest-environment jsdom
import type { FactoryWorkflowConfig } from "@cline/shared/browser";
import { act, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	FACTORY_MANAGER_MODEL_STORAGE_KEY,
	MODEL_SELECTION_STORAGE_KEY,
} from "@/lib/model-selection";
import type { DefaultWorkflow } from "../default-workflow";
import {
	blur,
	choose,
	click,
	deadRows,
	fakeWorkflow,
	renderSettingsPage,
	type,
} from "../test-utils";
import type { SettingsPageDefinition, SettingsPageProps } from "../types";
import { settingsPage } from "./roles";

vi.mock("@/components/ui/select", async () =>
	(await import("../test-utils")).nativeSelectModule(),
);

// The app's model picker: one button that picks the next model.
vi.mock("../../../chat/chat-input-bar", () => ({
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

const model = (providerId: string, modelId: string) => ({
	modelSelection: { providerId, modelId },
});
const fable = model("anthropic", "claude-fable-5-2");
const astra = model("openai-native", "gpt-6-astra");

/** Two builders and two code reviewers, as in the default workflow mockup. */
const agents = {
	designer: fable,
	planReviewers: [astra],
	implementers: [fable, astra],
	reviewers: [astra, fable],
	verifier: model("anthropic", "claude-haiku-5"),
};

async function render(
	config: Partial<FactoryWorkflowConfig> = {},
	options: Parameters<typeof renderSettingsPage>[1] = {},
) {
	const workflow = fakeWorkflow({ agents, ...config });
	const page = await renderSettingsPage(settingsPage, {
		...options,
		shell: { workflow, ...options.shell },
	});
	const commit = workflow.commit as ReturnType<typeof vi.fn>;
	return {
		...page,
		workflow,
		/** The last committed config and the row it was committed from. */
		last: () => {
			const call = commit.mock.calls.at(-1);
			return call
				? { config: call[0] as FactoryWorkflowConfig, row: call[1] as string }
				: undefined;
		},
		commits: () => commit.mock.calls.length,
		pickers: (row: string) => [
			...(page
				.row(row)
				?.querySelectorAll<HTMLElement>('[data-testid="model-picker"]') ?? []),
		],
		expand: (role: string) =>
			click(
				page.container.querySelector(
					`button[aria-controls="role-${role}-detail"]`,
				),
			),
	};
}

afterEach(() => {
	document.body.innerHTML = "";
	localStorage.clear();
});

describe("Roles & models: rows", () => {
	it("shows the five roles with their models inline, the review rules and the manager, with no dead rows", async () => {
		const page = await render();
		expect(page.pickers("designer")).toHaveLength(1);
		expect(page.pickers("planReviewers")).toHaveLength(1);
		expect(page.pickers("implementers")).toHaveLength(2);
		expect(page.pickers("verifier")).toHaveLength(1);
		expect(page.pickers("reviewers")).toHaveLength(2);
		expect(
			page.row("verifier")?.querySelector('[role="switch"]'),
		).not.toBeNull();
		for (const row of [
			"requireIndependentReview",
			"reviewMode",
			"minCodeReviewers",
			"managerModel",
			"managerCan",
		])
			expect(page.row(row)).not.toBeNull();
		expect(page.text()).toContain(
			"Who does each step, for new work in every project. Saved to the default workflow, Hands-off.",
		);
		expect(deadRows(page.container)).toEqual([]);
		// Every role open in turn, and the manager's disclosure, still no dead rows.
		for (const role of [
			"designer",
			"planReviewers",
			"implementers",
			"verifier",
			"reviewers",
		]) {
			await page.expand(role);
			expect(deadRows(page.container)).toEqual([]);
		}
		await click(page.row("managerCan")?.querySelector("button[aria-expanded]"));
		expect(page.row("managerCan")?.textContent).toContain(
			"Approve a stage or test setup for you",
		);
		expect(deadRows(page.container)).toEqual([]);
		await page.unmount();
	});

	it("saves an inline model change to that agent, from that role's row", async () => {
		const page = await render();
		await click(page.pickers("implementers")[1]);
		expect(page.last()?.row).toBe("implementers");
		expect(page.last()?.config.agents?.implementers).toEqual([
			fable,
			model("openai-native", "gpt-next"),
		]);
		await page.unmount();
	});

	it("says when no plan checker is set, and opens the role to add one", async () => {
		const page = await render({ agents: { ...agents, planReviewers: [] } });
		expect(page.row("planReviewers")?.textContent).toContain(
			"None. Plans are not checked before building.",
		);
		await page.expand("planReviewers");
		await click(page.buttons("Add plan checker")[0]);
		expect(page.last()?.config.agents?.planReviewers).toEqual([{}]);
		await page.unmount();
	});
});

describe("Roles & models: an expanded role", () => {
	it("opens one role at a time, with a tab per agent, Add and Remove", async () => {
		const page = await render();
		await page.expand("implementers");
		const tabs = [...page.container.querySelectorAll('[role="tab"]')];
		expect(tabs.map((tab) => tab.textContent)).toEqual([
			"Builder 1",
			"Builder 2",
		]);
		expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
		expect(page.buttons("Add builder")).toHaveLength(1);
		expect(page.buttons("Remove Builder 1")).toHaveLength(1);
		await page.expand("reviewers");
		expect(
			page.container.querySelector("#role-implementers-detail"),
		).toBeNull();
		expect(
			[...page.container.querySelectorAll('[role="tab"]')].map(
				(tab) => tab.textContent,
			),
		).toEqual(["Code reviewer 1", "Code reviewer 2"]);
		await page.unmount();
	});

	it("edits the selected agent's model in its tab", async () => {
		const page = await render();
		await page.expand("implementers");
		await click(page.buttons("Builder 2")[0]);
		await click(
			page
				.row("implementers-model")
				?.querySelector('[data-testid="model-picker"]'),
		);
		expect(page.last()?.row).toBe("implementers-model");
		expect(page.last()?.config.agents?.implementers).toEqual([
			fable,
			model("openai-native", "gpt-next"),
		]);
		await page.unmount();
	});

	it("adds and removes agents within each role's bounds", async () => {
		const page = await render({
			agents: {
				...agents,
				implementers: [fable, astra, fable, astra],
				reviewers: [astra],
			},
		});
		await page.expand("implementers");
		// Four builders: the most a role takes, so Add is hidden.
		expect(page.buttons("Add builder")).toHaveLength(0);
		await click(page.buttons("Builder 3")[0]);
		await click(page.buttons("Remove Builder 3")[0]);
		expect(page.last()?.row).toBe("implementers");
		expect(page.last()?.config.agents?.implementers).toEqual([
			fable,
			astra,
			astra,
		]);
		await page.expand("reviewers");
		// One code reviewer: the fewest, so Remove is hidden.
		expect(page.buttons(/^Remove Code reviewer/)).toHaveLength(0);
		await click(page.buttons("Add code reviewer")[0]);
		expect(page.last()?.config.agents?.reviewers).toEqual([astra, {}]);
		await page.unmount();
	});

	it("lowers Fewest code reviewers when a removal leaves fewer reviewers", async () => {
		const page = await render({ minCodeReviewers: 2 });
		await page.expand("reviewers");
		await click(page.buttons("Remove Code reviewer 1")[0]);
		expect(page.last()?.config.agents?.reviewers).toEqual([fable]);
		expect(page.last()?.config.minCodeReviewers).toBe(1);
		await page.unmount();
	});

	it("saves extra instructions with Save, links to Guidance, and Cancel puts the text back", async () => {
		const page = await render();
		await page.expand("implementers");
		const text = page.container.querySelector<HTMLTextAreaElement>(
			'[data-setting="implementers-instructions"] textarea',
		);
		await type(text as HTMLTextAreaElement, "Run bun run check.");
		await click(page.buttons("Cancel")[0]);
		expect(text?.value).toBe("");
		expect(page.commits()).toBe(0);
		await type(text as HTMLTextAreaElement, "Run bun run check.");
		await click(page.buttons("Save")[0]);
		expect(page.last()?.row).toBe("implementers-instructions");
		expect(page.last()?.config.agents?.implementers[0]).toEqual({
			...fable,
			instructions: "Run bun run check.",
		});
		await click(page.buttons("Guidance")[0]);
		expect(page.shell.open).toHaveBeenCalledWith({
			page: "guidance",
			role: "builder",
		});
		await page.unmount();
	});

	it("adds and removes skills, sets a profile and the limits", async () => {
		const page = await render({
			agents: {
				...agents,
				implementers: [{ ...fable, skills: ["cline-sdk"] }],
			},
		});
		await page.expand("implementers");
		await click(page.buttons("Remove skill cline-sdk")[0]);
		expect(page.last()?.config.agents?.implementers[0]).toEqual(fable);
		await click(
			page
				.row("implementers-skills")
				?.querySelector("button[data-setting-control]"),
		);
		const skill = page.container.querySelector<HTMLInputElement>(
			'input[aria-label="Skill name"]',
		);
		await type(skill, "tuistory");
		await act(async () => {
			skill?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
		expect(page.last()?.row).toBe("implementers-skills");
		expect(page.last()?.config.agents?.implementers[0]?.skills).toEqual([
			"cline-sdk",
			"tuistory",
		]);

		const profile = page.control<HTMLInputElement>("implementers-profile");
		await type(profile, "careful-builder");
		await blur(profile);
		expect(page.last()?.row).toBe("implementers-profile");
		expect(page.last()?.config.agents?.implementers[0]?.profile).toBe(
			"careful-builder",
		);

		const steps = page.container.querySelector<HTMLInputElement>(
			'input[aria-label="Builder 1 step limit"]',
		);
		const minutes = page.container.querySelector<HTMLInputElement>(
			'input[aria-label="Builder 1 time limit in minutes"]',
		);
		await type(steps, "200");
		await blur(steps);
		expect(page.last()?.row).toBe("implementers-limits");
		expect(page.last()?.config.agents?.implementers[0]?.maxIterations).toBe(
			200,
		);
		await type(minutes, "45");
		await blur(minutes);
		expect(page.last()?.config.agents?.implementers[0]?.timeoutSeconds).toBe(
			2700,
		);
		const before = page.commits();
		await type(minutes, "500");
		await blur(minutes);
		expect(page.commits()).toBe(before);
		expect(page.row("implementers-limits")?.textContent).toContain(
			"Enter a whole number from 1 to 120, or leave it empty.",
		);
		await page.unmount();
	});

	it("names each role's tools in a sentence", async () => {
		const page = await render();
		await page.expand("implementers");
		expect(page.text()).toContain(
			"Every tool: reads and edits files, runs commands, and uses the MCP servers set up in the app.",
		);
		await page.expand("reviewers");
		expect(page.text()).toContain(
			"Reads files, searches code and uses skills. Cannot edit or run commands.",
		);
		await page.expand("verifier");
		expect(page.text()).toContain(
			"Reads files, searches code, uses skills and runs commands. Cannot edit code.",
		);
		await page.unmount();
	});

	it("saves the tester's own test setup only with Save", async () => {
		const page = await render();
		await page.expand("verifier");
		expect(page.container.querySelectorAll('[role="tab"]')).toHaveLength(0);
		await click(
			page.row("verifier-testSetup")?.querySelector("button[aria-expanded]"),
		);
		await type(
			page.container.querySelector<HTMLInputElement>(
				'input[aria-label="App start command"]',
			),
			"bun run dev",
		);
		expect(page.commits()).toBe(0);
		await click(page.buttons("Save test setup")[0]);
		expect(page.last()?.row).toBe("verifier-testSetup");
		expect(page.last()?.config.agents?.verifier?.environment).toEqual({
			start: "bun run dev",
		});
		await page.unmount();
	});
});

describe("Roles & models: tester, warnings and review rules", () => {
	it("turns the tester off and on", async () => {
		const page = await render();
		await click(page.row("verifier")?.querySelector('[role="switch"]'));
		expect(page.last()?.row).toBe("verifier");
		expect(page.last()?.config.agents?.verifier).toBeUndefined();
		const off = await render({ agents: { ...agents, verifier: undefined } });
		expect(off.pickers("verifier")).toHaveLength(0);
		await click(off.row("verifier")?.querySelector('[role="switch"]'));
		expect(off.last()?.config.agents?.verifier).toEqual({});
		await page.unmount();
		await off.unmount();
	});

	it("warns when no code reviewer uses a different model, and when nothing checks the plan", async () => {
		const independent = await render({
			agents: { ...agents, implementers: [fable], reviewers: [astra] },
		});
		expect(
			independent.row("reviewers")?.querySelector("[data-role-warning]"),
		).toBeNull();
		await independent.unmount();
		const same = await render({
			agents: {
				designer: fable,
				planReviewers: [],
				implementers: [fable],
				reviewers: [fable],
			},
		});
		const text = same.row("reviewers")?.textContent;
		expect(text).toContain(
			"Every code reviewer uses the same model as scoping or a builder",
		);
		expect(text).toContain("plans wait for your approval");
		expect(text).toContain(
			"No plan checker and no tester: only code review checks the work.",
		);
		await same.unmount();
	});

	it("saves the review rules, with Fewest code reviewers capped at the number of reviewers", async () => {
		const page = await render({
			agents: { ...agents, reviewers: [astra, fable] },
		});
		await click(
			page.row("requireIndependentReview")?.querySelector('[role="switch"]'),
		);
		expect(page.last()).toEqual({
			config: expect.objectContaining({ requireIndependentReview: false }),
			row: "requireIndependentReview",
		});
		await choose(
			page.control<HTMLSelectElement>("reviewMode") as HTMLSelectElement,
			"fixed",
		);
		expect(page.last()?.config.reviewMode).toBe("fixed");
		const fewest = page.control<HTMLSelectElement>(
			"minCodeReviewers",
		) as HTMLSelectElement;
		expect([...fewest.options].map((option) => option.disabled)).toEqual([
			false,
			false,
			true,
			true,
		]);
		expect(page.row("minCodeReviewers")?.textContent).toContain(
			"Up to 2, the number of code reviewers.",
		);
		await choose(fewest, "2");
		expect(page.last()).toEqual({
			config: expect.objectContaining({ minCodeReviewers: 2 }),
			row: "minCodeReviewers",
		});
		await page.unmount();
	});
});

describe("Roles & models: the manager", () => {
	it("shows Ask Factory's own model, the chats' until chosen, and picks it", async () => {
		localStorage.setItem(
			MODEL_SELECTION_STORAGE_KEY,
			JSON.stringify({
				lastProvider: "anthropic",
				lastModelByProvider: { anthropic: "claude-fable-5-2" },
			}),
		);
		const page = await render();
		const picker = page
			.row("managerModel")
			?.querySelector<HTMLElement>('[data-testid="model-picker"]');
		expect(picker?.textContent).toBe("claude-fable-5-2");
		await click(picker);
		expect(picker?.textContent).toBe("gpt-next");
		expect(
			JSON.parse(localStorage.getItem(FACTORY_MANAGER_MODEL_STORAGE_KEY) ?? ""),
		).toEqual({
			lastProvider: "openai-native",
			lastModelByProvider: {
				anthropic: "claude-fable-5-2",
				"openai-native": "gpt-next",
			},
		});
		// Other chats keep their remembered model; the workflow is untouched.
		expect(
			JSON.parse(localStorage.getItem(MODEL_SELECTION_STORAGE_KEY) ?? ""),
		).toEqual({
			lastProvider: "anthropic",
			lastModelByProvider: { anthropic: "claude-fable-5-2" },
		});
		expect(page.commits()).toBe(0);
		localStorage.removeItem(FACTORY_MANAGER_MODEL_STORAGE_KEY);
		await page.unmount();
	});
});

describe("Roles & models: opening and saving", () => {
	it("opens the role a link names", async () => {
		const page = await render({}, { focus: { role: "builder" } });
		expect(
			page.container.querySelector("#role-implementers-detail"),
		).not.toBeNull();
		await page.unmount();
	});

	it("disables every control when the Hub can't be reached", async () => {
		const page = await render({}, { shell: { readOnly: true } });
		expect(page.pickers("designer")[0]?.closest("fieldset")).not.toBeNull();
		const switches =
			page.container.querySelectorAll<HTMLButtonElement>('[role="switch"]');
		expect([...switches].every((item) => item.disabled)).toBe(true);
		await page.unmount();
	});

	it("puts a field back and shows the error under its row when a save fails", async () => {
		const save = vi.fn(async () => {
			throw new Error("Couldn't save the workflow.");
		});
		/** The shell's optimistic save, with a save that fails. */
		function useFailingWorkflow(): DefaultWorkflow {
			const base = fakeWorkflow({ agents });
			const [draft, setDraft] = useState<FactoryWorkflowConfig>();
			const [error, setError] = useState<{ row: string; message: string }>();
			return {
				...base,
				config: draft ?? base.config,
				commit: (next: FactoryWorkflowConfig, row: string) => {
					setDraft(next);
					void save().catch((cause: Error) => {
						setDraft(undefined);
						setError({ row, message: cause.message });
					});
				},
				errorFor: (row: string) =>
					error?.row === row ? error.message : undefined,
			};
		}
		const Wrapped: SettingsPageDefinition = {
			...settingsPage,
			Page: (props: SettingsPageProps) => {
				const workflow = useFailingWorkflow();
				return (
					<settingsPage.Page {...props} shell={{ ...props.shell, workflow }} />
				);
			},
		};
		const page = await renderSettingsPage(Wrapped);
		await click(
			page.container.querySelector(
				'button[aria-controls="role-implementers-detail"]',
			),
		);
		const text = page.container.querySelector<HTMLTextAreaElement>(
			'[data-setting="implementers-instructions"] textarea',
		);
		await type(text as HTMLTextAreaElement, "Run bun run check.");
		await click(page.buttons("Save")[0]);
		expect(save).toHaveBeenCalledOnce();
		expect(text?.value).toBe("");
		expect(
			page.row("implementers-instructions")?.querySelector('[role="alert"]')
				?.textContent,
		).toBe("Couldn't save the workflow.");
		// A switch goes back too.
		await click(page.row("verifier")?.querySelector('[role="switch"]'));
		expect(
			page.row("verifier")?.querySelector<HTMLInputElement>('[role="switch"]')
				?.checked,
		).toBe(true);
		expect(page.row("verifier")?.textContent).toContain(
			"Couldn't save the workflow.",
		);
		await page.unmount();
	});
});
