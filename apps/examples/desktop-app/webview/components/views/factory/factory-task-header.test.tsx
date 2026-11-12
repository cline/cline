// @vitest-environment jsdom
import {
	type AgendaTaskRecord,
	factoryDesignProgressSchema,
	factoryRunStateSchema,
	factoryTaskConfigSchema,
} from "@cline/shared";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	FactoryTaskHeader,
	factoryAwaitingStart,
	factoryScopingStopReason,
} from "./factory-task-header";

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: vi.fn(), subscribe: vi.fn(() => () => {}) },
	openExternalUrl: vi.fn(),
}));

const task: AgendaTaskRecord = {
	taskId: "feature",
	title: "Search notes",
	instructions: "Search titles.",
	type: "todo",
	scope: "workspace",
	workspaceRoot: "/repo",
	status: "pending_approval",
	resourcePaths: [],
	priority: 2,
	availableAt: "2026-01-01T00:00:00Z",
	expiresAt: "2027-01-01T00:00:00Z",
	automationEligible: false,
	revision: 1,
	createdBy: { kind: "user" },
	updatedBy: { kind: "user" },
	createdAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-01T00:00:00Z",
	factory: {
		execution: "local",
		approval: "required",
		maxRepairRounds: 2,
		checks: [
			{ name: "API", command: "node check.mjs", kind: "api", artifacts: [] },
		],
		publishPullRequest: false,
	},
};
const handsOff = {
	...task,
	factory: {
		...task.factory!,
		autonomy: "hands_off" as const,
		approval: "automatic" as const,
	},
};

const withVerifier = (value: AgendaTaskRecord): AgendaTaskRecord => ({
	...value,
	factory: factoryTaskConfigSchema.parse({
		...value.factory,
		agents: { ...value.factory?.agents, verifier: {} },
	}),
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

async function render(
	props: Partial<ComponentProps<typeof FactoryTaskHeader>> & {
		task: AgendaTaskRecord;
	},
) {
	await act(async () =>
		root.render(
			<FactoryTaskHeader
				busy={false}
				designActive={false}
				state={undefined}
				approvalReason={null}
				onBack={vi.fn()}
				onArchive={vi.fn()}
				onDelete={vi.fn()}
				{...props}
			/>,
		),
	);
}
const progress = () => document.querySelector('[aria-label="Task progress"]');
const headline = () => progress()?.querySelector("strong")?.textContent;
const buttons = () =>
	[...document.querySelectorAll("button")].map((item) =>
		item.textContent?.trim(),
	);

/** Station names on the card's line, and the one the card is at. */
const line = () =>
	document.querySelector('[data-testid="factory-card-stations"]');
const at = () => {
	const item = line()?.querySelector(
		'[data-state="current"],[data-state="stopped"]',
	);
	return item
		? `${item.getAttribute("data-factory-station")}:${item.getAttribute("data-state")}`
		: undefined;
};

describe("FactoryTaskHeader station line", () => {
	it("uses the home's shared station line and vocabulary", async () => {
		await render({
			task: withVerifier({ ...handsOff, status: "in_progress" }),
		});
		expect(
			line()?.querySelector('section[aria-label="Where this card is"]'),
		).not.toBeNull();
		expect(
			[...(line()?.querySelectorAll("[data-factory-station]") ?? [])].map(
				(item) => item.getAttribute("data-factory-station"),
			),
		).toEqual(["scope", "build", "verify", "review", "delivered"]);
		expect(at()).toBe("build:current");
		// The old stepper is gone.
		expect(document.querySelector('ol[aria-label="Pipeline"]')).toBeNull();
	});

	it("leaves out a station the plan skips", async () => {
		await render({ task: { ...handsOff, status: "in_progress" } });
		expect(line()?.querySelector('[data-factory-station="verify"]')).toBeNull();
	});

	it("shows no line on an archived card", async () => {
		await render({ task: { ...task, archivedAt: "2026-01-02T00:00:00Z" } });
		expect(line()).toBeNull();
	});
});

describe("FactoryTaskHeader status", () => {
	it("offers Start in the header for a held card with no plan", async () => {
		const onStart = vi.fn();
		const held: AgendaTaskRecord = {
			...task,
			factory: factoryTaskConfigSchema.parse({ ...task.factory, hold: true }),
		};
		await render({ task: held, onStart });
		expect(headline()).toBe("On hold");
		expect(buttons()).toContain("Start");
		expect(
			factoryAwaitingStart(held, {
				autoProgress: false,
				designActive: false,
				approvalReason: null,
			}),
		).toBe(true);
	});

	it("reads a manual card with no plan that cannot be approved as Not started", async () => {
		await render({
			task,
			approvalReason: "Scoping has not chosen reviewers for this plan yet.",
			onStart: vi.fn(),
		});
		expect(headline()).toBe("Not started");
		expect(progress()?.textContent).toContain(
			"Factory hasn't scoped this yet. Start scoping to write a plan you can approve.",
		);
		expect(buttons()).toContain("Start scoping");
	});

	it("keeps a manual plan approvable as written out of Not started", () => {
		expect(
			factoryAwaitingStart(task, {
				autoProgress: false,
				designActive: false,
				approvalReason: null,
			}),
		).toBe(false);
		expect(
			factoryAwaitingStart(
				{ ...task, factoryQueued: "design" },
				{ autoProgress: false, designActive: false, approvalReason: "x" },
			),
		).toBe(false);
	});

	it("names a plan fault once and marks the scoping step", async () => {
		await render({
			task: {
				...handsOff,
				status: "failed",
				error:
					"The plan's checks still need fixing: the check runs a missing package.",
			},
			failure: {
				reason:
					"The plan's checks still need fixing: the check runs a missing package.",
				planFaultStopped: true,
			},
			onEditPlan: vi.fn(),
		});
		expect(headline()).toBe("The plan's checks still need fixing");
		expect(
			document.querySelector('[data-testid="factory-failure-reason"]')
				?.textContent,
		).toBe("The check runs a missing package.");
		expect(at()).toBe("build:stopped");
		expect(progress()?.textContent).not.toContain("Stopped after");
	});

	it("names a running repository stage as a sub-step of Build", async () => {
		const state = factoryRunStateSchema.parse({
			phase: "verifying",
			repairRound: 0,
			sessions: [],
			workspace: {
				path: "/wt",
				branch: "feat/search",
				baseBranch: "main",
				baseCommit: "base",
			},
			candidate: {
				commit: "c",
				checks: [],
				reviews: [],
				stages: [
					{
						id: "scan",
						name: "Security scan",
						kind: "command",
						hash: "h",
						blocking: true,
						status: "running",
					},
				],
			},
		});
		await render({ task: { ...task, status: "in_progress" }, state });
		expect(headline()).toBe("Build · Security scan");
		expect(at()).toBe("build:current");
	});

	it("does not say building is in progress under a building headline", async () => {
		await render({ task: { ...task, status: "in_progress" } });
		expect(progress()?.textContent).not.toContain("Building is in progress");
	});
});

describe("FactoryTaskHeader primary action", () => {
	const delivered = factoryRunStateSchema.parse({
		phase: "ready",
		repairRound: 0,
		sessions: [],
		workspace: {
			path: "/wt",
			branch: "feat/search",
			baseBranch: "main",
			baseCommit: "base",
		},
		candidate: { commit: "c", checks: [], reviews: [] },
	});
	const actions = () =>
		[
			...(document
				.querySelector('[data-testid="factory-card-actions"]')
				?.querySelectorAll("button") ?? []),
		].map((item) => item.textContent?.trim());
	const menuItems = async () => {
		const trigger = [...document.querySelectorAll("button")].find(
			(item) => item.textContent?.trim() === "More",
		);
		await act(async () =>
			trigger?.dispatchEvent(
				new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
			),
		);
		return [...document.querySelectorAll('[role="menuitem"]')].map((item) =>
			item.textContent?.trim(),
		);
	};

	it("has no primary action while working: the Agents tab is the content", async () => {
		await render({
			task: { ...handsOff, status: "in_progress" },
			live: {
				sessions: [
					{ sessionId: "b1", role: "builder" },
					{ sessionId: "r1", role: "reviewer" },
				],
			},
		});
		expect(
			document.querySelector('[data-testid="factory-card-actions"]'),
		).toBeNull();
		expect(buttons()).not.toContain("Watch live");
		// One agent named, never "+1 more".
		expect(
			document.querySelector('[data-testid="factory-live-line"]')?.textContent,
		).not.toContain("more");
	});

	it("opens the draft PR from a delivered card's header", async () => {
		await render({
			task: { ...handsOff, status: "completed" },
			state: { ...delivered, pullRequestUrl: "https://example.test/pr/1" },
			delivery: { pullRequestUrl: "https://example.test/pr/1" },
		});
		expect(headline()).toBe("Draft PR ready");
		expect(actions()).toEqual(["Open draft PR"]);
		expect(progress()?.textContent).toContain("You decide when to merge.");
	});

	it.each([
		[{ pullRequestReady: true }, "Marked ready for review"],
		[
			{
				pullRequestReady: true,
				pullRequestOutcome: {
					state: "merged",
					headChanged: true,
					at: "2026-01-02T00:00:00Z",
				},
			},
			"Merged after changes",
		],
		[
			{
				pullRequestOutcome: {
					state: "closed",
					headChanged: false,
					at: "2026-01-02T00:00:00Z",
				},
			},
			"Closed without merging",
		],
	] as const)("heads a delivered PR with what became of it: %o", async (pr, line) => {
		await render({
			task: { ...handsOff, status: "completed" },
			state: {
				...delivered,
				pullRequestUrl: "https://example.test/pr/1",
				...pr,
			},
			delivery: { pullRequestUrl: "https://example.test/pr/1" },
		});
		expect(headline()).toBe(line);
		// Ready, merged or closed: no longer a draft.
		expect(actions()).toEqual(["Open PR"]);
		// A merged or closed PR is no longer the person's to merge.
		expect(progress()?.textContent?.includes("You decide when to merge.")).toBe(
			!("pullRequestOutcome" in pr),
		);
	});

	it("shows the changes when the delivery has no PR", async () => {
		const onViewChanges = vi.fn();
		await render({
			task: { ...handsOff, status: "completed" },
			state: delivered,
			delivery: { branch: "feat/search", onViewChanges },
		});
		expect(actions()).toEqual(["View changes"]);
		expect(progress()?.textContent).toContain(
			"The changes are on branch feat/search. Nothing was published.",
		);
		const view = [...document.querySelectorAll("button")].find(
			(item) => item.textContent?.trim() === "View changes",
		);
		await act(async () => view?.click());
		expect(onViewChanges).toHaveBeenCalled();
	});

	it("asks for review with Accept and Factory's reason beside it", async () => {
		const onAccept = vi.fn();
		await render({
			task: { ...handsOff, status: "completed" },
			state: {
				...delivered,
				pullRequestUrl: "https://example.test/pr/1",
				humanReview: { required: true, reason: "shared contract" },
			},
			accept: {
				onAccept,
				reason: "Factory asks for your review: touches a shared contract.",
			},
			delivery: { pullRequestUrl: "https://example.test/pr/1" },
		});
		expect(headline()).toBe("Needs your review");
		expect(actions()).toEqual(["Accept", "Open draft PR"]);
		const reason = document.querySelector(
			'[data-testid="factory-review-reason"]',
		);
		expect(reason?.textContent).toBe(
			"Factory asks for your review: touches a shared contract.",
		);
		// The reason is said once, beside Accept.
		expect(
			progress()?.textContent?.split("touches a shared contract").length,
		).toBe(2);
		const accept = [...document.querySelectorAll("button")].find(
			(item) => item.textContent?.trim() === "Accept",
		);
		await act(async () => accept?.click());
		expect(onAccept).toHaveBeenCalled();
	});

	it("offers Try again on a stopped card and keeps Edit plan in More", async () => {
		await render({
			task: { ...handsOff, status: "failed", error: "Checks failed." },
			failure: {
				reason: "Checks did not pass: Type check failed.",
				onRetry: vi.fn(),
			},
			onEditPlan: vi.fn(),
			state: factoryRunStateSchema.parse({
				phase: "blocked",
				repairRound: 0,
				sessions: [],
				workspace: {
					path: "/wt",
					branch: "feat/search",
					baseBranch: "main",
					baseCommit: "base",
				},
				candidate: {
					commit: "c",
					checks: [
						{
							name: "Types",
							command: "tsc",
							kind: "test",
							status: "failed",
							exitCode: 1,
							output: "",
							artifacts: [],
						},
					],
					reviews: [],
				},
			}),
		});
		expect(headline()).toBe("Checks did not pass");
		expect(actions()).toEqual(["Try again"]);
		// The reason drops the headline it repeats; no sentence restates Try again.
		expect(
			document.querySelector('[data-testid="factory-failure-reason"]')
				?.textContent,
		).toBe("Type check failed.");
		expect(progress()?.textContent).not.toContain("edit the plan first");
		expect(await menuItems()).toEqual(["Edit plan", "Archive", "Delete…"]);
	});

	it("makes Edit plan the one action when only editing can fix the plan", async () => {
		await render({
			task: { ...handsOff, status: "failed" },
			failure: { planFaultStopped: true },
			onEditPlan: vi.fn(),
		});
		expect(actions()).toEqual(["Edit plan"]);
		expect(await menuItems()).not.toContain("Edit plan");
	});

	it("says scoping stopped, once, when scoping ran and could not settle the plan", async () => {
		const error = "Design did not complete: Plan repair limit (2) reached.";
		const stoppedTask: AgendaTaskRecord = {
			...handsOff,
			error,
			factoryDesignProgress: {
				revision: 1,
				phase: "reviewing",
				reviewerSessions: [],
			} as unknown as AgendaTaskRecord["factoryDesignProgress"],
		};
		const onRetry = vi.fn();
		await render({
			task: stoppedTask,
			approvalReason: "Scoping has not chosen reviewers for this plan yet.",
			failure: {
				reason: factoryScopingStopReason(error),
				onRetry,
			},
			onStart: vi.fn(),
			onEditPlan: vi.fn(),
		});
		expect(headline()).toBe("Scoping stopped");
		expect(progress()?.textContent).not.toContain("Not started");
		expect(
			document.querySelector('[data-testid="factory-failure-reason"]')
				?.textContent,
		).toBe("The plan reviewers still had objections after 2 rounds of fixes.");
		expect(progress()?.textContent?.split("still had objections").length).toBe(
			2,
		);
		expect(actions()).toEqual(["Try scoping again"]);
		expect(await menuItems()).toContain("Edit plan");
		expect(factoryScopingStopReason("Design did not complete: boom")).toBe(
			"Scoping did not finish.",
		);
		expect(
			factoryAwaitingStart(stoppedTask, {
				autoProgress: false,
				designActive: false,
				approvalReason: "x",
			}),
		).toBe(false);
	});

	it("rates a delivered card from More", async () => {
		const onRate = vi.fn();
		await render({
			task: { ...handsOff, status: "completed" },
			state: delivered,
			delivery: { branch: "feat/search", onViewChanges: vi.fn() },
			onRate,
		});
		expect(await menuItems()).toContain("Rate this delivery…");
	});

	it("offers Start scoping on a card nothing will start", async () => {
		await render({
			task,
			approvalReason: "Scoping has not chosen reviewers for this plan yet.",
			onStart: vi.fn(),
		});
		expect(actions()).toEqual(["Start scoping"]);
	});
});

describe("FactoryTaskHeader supplied plan line", () => {
	const progress = (
		phase: "designing" | "complete",
		route: Record<string, unknown>,
	) =>
		factoryDesignProgressSchema.parse({
			phase,
			revision: 1,
			repairRound: 0,
			agents: {
				designer: {},
				planReviewers: [],
				reviewers: [{}],
				implementers: [{}],
			},
			designerSessionId: "factory_design_x",
			findings: [],
			route,
			...(phase === "complete" ? { reviewerSessions: [], reviews: [] } : {}),
		});
	const line = () =>
		container.querySelector("[data-testid=factory-scope-route]")?.textContent;

	it("says how a supplied plan was checked, or why it was not used", async () => {
		await render({
			task: {
				...task,
				factoryDesignProgress: progress("complete", {
					scoping: "prepared",
					sweep: "checks",
				}),
			},
		});
		expect(line()).toBe(
			"Plan provided with the request; checked against the code only.",
		);
		await render({
			task: {
				...task,
				factoryDesignProgress: progress("complete", {
					scoping: "prepared",
					sweep: "model",
				}),
			},
		});
		expect(line()).toBe("Plan provided with the request; quick check passed.");
		await render({
			task: {
				...task,
				factoryDesignProgress: progress("designing", {
					scoping: "designer",
					reason:
						"Every supplied check already passes at the base commit, so the plan proves no change.",
				}),
			},
		});
		expect(line()).toBe(
			"Scoped by Factory: the supplied plan was not used (Every supplied check already passes at the base commit, so the plan proves no change).",
		);
	});

	it("shows nothing on an ordinary card", async () => {
		await render({ task });
		expect(line()).toBeUndefined();
	});
});
