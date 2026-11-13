// @vitest-environment jsdom
import type {
	AgendaTaskRecord,
	AgendaTaskRunRecord,
	HubTaskCreateInput,
} from "@cline/shared";
import {
	factoryDesignProgressSchema,
	factoryRunStateSchema,
} from "@cline/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	onTestFinished,
	vi,
} from "vitest";
import { openExternalUrl } from "@/lib/desktop-client";
import { FACTORY_BOARD } from "@/lib/factory-copy";
import { ensureLocalStorage } from "@/lib/test-local-storage";
import { handleFactoryCommand } from "../../../../sidecar/factory-commands";
import { PAGE_FRAME_FIT_VIEWPORT } from "../page-layout";
import type { FactoryDraft } from "./factory-detail";
import { FACTORY_ACTIVITY_REQUEST } from "./factory-ui";
import { FactoryView } from "./factory-view";

const drafts = new Map<string, FactoryDraft>();

const mocks = vi.hoisted(() => ({
	tasks: [] as AgendaTaskRecord[],
	refresh: vi.fn(async () => {}),
	toast: vi.fn(),
	createTask: vi.fn(),
	startFactoryQueue: vi.fn(async () => ({ queued: 1 })),
	stopFactoryQueue: vi.fn(async () => ({ stopped: true })),
	updateAgendaTask: vi.fn(),
	approveAgendaTask: vi.fn(),
	getFactoryTask: vi.fn(async () => ({ runs: [] as AgendaTaskRunRecord[] })),
	designFactoryTask: vi.fn(async () => ({ sessionId: "design-1" })),
	listAgendaTasks: vi.fn(async () => [] as AgendaTaskRecord[]),
	invoke: vi.fn(
		async (_command: string, _args?: unknown): Promise<unknown> => [],
	),
	subscribe: vi.fn((_event: string, _listener: () => void) => () => {}),
	subscribeTransportState: vi.fn((listener: (state: string) => void) => {
		listener("connected");
		return () => {};
	}),
	/** The board's measured width; 0 is unmeasured, laid out as wide. */
	boardWidth: 0,
}));
vi.mock("./use-element-size", () => ({
	useElementSize: () => [() => {}, { width: mocks.boardWidth, height: 0 }],
}));
vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));
vi.mock("@/hooks/use-agenda-tasks", () => ({
	useAgendaTasks: () => ({
		tasks: mocks.tasks,
		refresh: mocks.refresh,
		createTask: mocks.createTask,
		isLoading: false,
	}),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: mocks,
	openExternalUrl: vi.fn(),
}));

function task(overrides: Partial<AgendaTaskRecord> = {}): AgendaTaskRecord {
	return {
		taskId: "feature-1",
		title: "Export activity",
		instructions: "Export the activity view as CSV.",
		type: "todo",
		scope: "workspace",
		workspaceRoot: "/repo",
		status: "approved",
		resourcePaths: [],
		priority: 2,
		availableAt: "2026-01-01T00:00:00Z",
		expiresAt: "2027-01-01T00:00:00Z",
		automationEligible: false,
		revision: 3,
		createdBy: { kind: "user" },
		updatedBy: { kind: "user" },
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		factory: {
			execution: "local",
			approval: "required",
			maxRepairRounds: 2,
			checks: [
				{ name: "API test", command: "bun test", kind: "api", artifacts: [] },
			],
			acceptanceCriteria: [
				{
					id: "csv-export",
					text: "The activity view exports as CSV",
					required: true,
					check: "API test",
				},
			],
			publishPullRequest: false,
		},
		...overrides,
	};
}
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	vi.clearAllMocks();
	drafts.clear();
	mocks.invoke.mockImplementation(async (command) =>
		command === "factory_attention"
			? handleFactoryCommand(
					{ pendingQuestions: new Map() },
					"factory_attention",
					undefined,
					async (read) =>
						read === "task.list" ? { tasks: mocks.tasks } : { runs: [] },
				)
			: command === "get_desktop_settings"
				? {}
				: command === "factory_get_stages"
					? { file: "absent", stages: [] }
					: [],
	);
	mocks.createTask.mockImplementation(async (input: HubTaskCreateInput) => {
		const created = task({ taskId: input.taskId, status: "pending_approval" });
		mocks.tasks = [...mocks.tasks, created];
		return { task: created };
	});
	mocks.tasks = [];
	mocks.boardWidth = 0;
	ensureLocalStorage();
	window.localStorage.clear();
	sessionStorage.clear();
	sessionStorage.setItem("factory.destination", "board");
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});
function button(label: string): HTMLButtonElement {
	const found = Array.from(document.querySelectorAll("button")).find((item) =>
		item.textContent?.includes(label),
	);
	if (!found) throw new Error(`Missing button ${label}`);
	return found;
}

function labelled(label: string): HTMLButtonElement {
	const found = document.querySelector(`button[aria-label="${label}"]`);
	if (!(found instanceof HTMLButtonElement))
		throw new Error(`Missing button labelled ${label}`);
	return found;
}
function hasButton(label: string): boolean {
	return Array.from(document.querySelectorAll("button")).some(
		(item) => item.textContent?.trim() === label,
	);
}
/** A board column (by its title) or a rail group (by its label). */
function sectionElement(label: string): HTMLElement | null {
	return (
		container.querySelector<HTMLElement>(`section[aria-label="${label}"]`) ??
		Array.from(
			container.querySelectorAll<HTMLElement>("[data-factory-group]"),
		).find(
			(item) =>
				item.querySelector("[data-factory-column-title]")?.textContent ===
				label,
		) ??
		null
	);
}
function section(label: string): string {
	return sectionElement(label)?.textContent ?? "";
}
/** The row for a card inside a section, found by its data attribute. */
function row(sectionLabel: string, taskId: string): HTMLButtonElement {
	const found = sectionElement(sectionLabel)?.querySelector(
		`[data-factory-task="${taskId}"]`,
	);
	if (!(found instanceof HTMLButtonElement))
		throw new Error(`Missing ${taskId} in ${sectionLabel}`);
	return found;
}

/** A card's row on the home, in whichever group lists it. */
function homeRow(taskId: string): HTMLLIElement {
	const found = container
		.querySelector(`[data-factory-home] button[data-factory-task="${taskId}"]`)
		?.closest("li");
	if (!(found instanceof HTMLLIElement))
		throw new Error(`Missing ${taskId} on the home`);
	return found;
}

/**
 * Where a card is on the home: its group, its stage (from its stage line, or
 * the group for waiting and delivered rows), its row's name and text.
 */
function onLine(taskId: string) {
	const found = homeRow(taskId);
	const group = found.dataset.factoryRow;
	const stages = found.querySelector<HTMLElement>("[data-factory-stages]");
	return {
		group,
		station:
			stages?.dataset.factoryStages ??
			(group === "waiting"
				? "waiting"
				: group === "delivered"
					? "delivered"
					: undefined),
		label:
			found
				.querySelector("button[data-factory-task]")
				?.getAttribute("aria-label") ?? "",
		text: found.textContent ?? "",
		stopped: stages?.dataset.state === "stopped",
	};
}

/** How many times a card is listed on the home. */
function listed(taskId: string): number {
	return container.querySelectorAll(
		`[data-factory-home] button[data-factory-task="${taskId}"]`,
	).length;
}

/** Opens a card from its row. */
async function openCard(taskId: string) {
	const target = container.querySelector<HTMLElement>(
		`button[data-factory-task="${taskId}"]`,
	);
	if (!target) throw new Error(`Missing ${taskId}`);
	await act(async () => target.click());
}

/** The text of the Working and Waiting groups. */
function queueText(): string {
	return ["working", "waiting"]
		.map(
			(group) =>
				container.querySelector(`[data-factory-group="${group}"]`)
					?.textContent ?? "",
		)
		.join(" ");
}

/** The board's columns, in order. */
function groups(): string[] {
	return Array.from(
		container.querySelectorAll<HTMLElement>("[data-factory-group]"),
	).map((item) => item.dataset.factoryGroup ?? "");
}
/** The board's columns that list at least one card, in order. */
function filledGroups(): string[] {
	return Array.from(
		container.querySelectorAll<HTMLElement>("[data-factory-group]"),
	)
		.filter((item) => item.querySelector("[data-factory-task]"))
		.map((item) => item.dataset.factoryGroup ?? "");
}

/** Every hook's transport subscription, told about one state change. */
function transportListeners() {
	const listeners = mocks.subscribeTransportState.mock.calls.map(
		([listener]) => listener,
	);
	if (listeners.length === 0) throw new Error("Missing transport subscription");
	return (state: string) => {
		for (const listener of listeners) listener(state);
	};
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

function selectTab(label: string) {
	button(label).dispatchEvent(
		new MouseEvent("mousedown", { bubbles: true, button: 0 }),
	);
}

describe("Factory workflow", () => {
	it("lands on Activity without treating a delayed or failed read as an empty inbox", async () => {
		sessionStorage.removeItem("factory.destination");
		let rejectActivity: (reason: Error) => void = () => {
			throw new Error("Request not started");
		};
		mocks.invoke.mockImplementation(async (command) =>
			command === "factory_attention"
				? new Promise((_, reject) => {
						rejectActivity = reject;
					})
				: {},
		);
		await act(async () =>
			root.render(
				<FactoryView drafts={drafts} onOpenSession={vi.fn(async () => {})} />,
			),
		);
		expect(container.textContent).toContain("Loading…");
		expect(container.textContent).not.toContain(FACTORY_BOARD.empty.nothing);
		expect(container.textContent).not.toContain("Nothing needs you");
		// One landing page: no destination pills.
		expect(
			container.querySelector('nav[aria-label="Factory destinations"]'),
		).toBeNull();
		expect(sessionStorage.getItem("factory.destination")).toBe("activity");
		await act(async () => rejectActivity(new Error("Activity unavailable")));
		const alert = container.querySelector('[role="alert"]')?.textContent;
		expect(alert).toContain(
			"Can't reach Factory. Showing the last known status.",
		);
		expect(alert).toContain("Activity unavailable");
		expect(container.textContent).not.toContain(FACTORY_BOARD.empty.nothing);
		mocks.invoke.mockImplementation(async (command) =>
			command === "factory_attention" ? [] : {},
		);
		await act(async () => button("Retry").click());
		expect(container.textContent).toContain(FACTORY_BOARD.empty.nothing);
		const transportListener = transportListeners();
		await act(async () => transportListener("reconnecting"));
		expect(container.textContent).not.toContain(FACTORY_BOARD.empty.nothing);
		expect(container.textContent).toContain("Can't reach Factory");
		expect(
			mocks.invoke.mock.calls.filter(
				([command]) => command === "factory_attention",
			),
		).toHaveLength(2);
		await act(async () => transportListener("connected"));
		expect(container.textContent).toContain(FACTORY_BOARD.empty.nothing);

		await act(async () => labelled("Factory settings").click());
		expect(sessionStorage.getItem("factory.destination")).toBe("settings");
		await act(async () => labelled("Back to Factory").click());
		expect(sessionStorage.getItem("factory.destination")).toBe("activity");
		expect(
			mocks.invoke.mock.calls.filter(
				([command]) => command === "factory_attention",
			),
		).toHaveLength(3);
	});

	it.each([
		1, 200,
	])("shares one attention read across Activity, History and settings for %i loaded tasks", async (count) => {
		sessionStorage.removeItem("factory.destination");
		mocks.tasks = Array.from({ length: count }, (_, index) =>
			task({
				taskId: `feature-${index}`,
				title: `Feature ${index}`,
				status: "failed",
			}),
		);
		await act(async () =>
			root.render(
				<FactoryView drafts={drafts} onOpenSession={vi.fn(async () => {})} />,
			),
		);
		expect(
			container.querySelectorAll(
				'[data-factory-group="needsYou"] li[data-factory-card]',
			),
		).toHaveLength(count);
		await act(async () => labelled("Factory settings").click());
		await act(async () => labelled("Back to Factory").click());
		await act(async () => button("All history").click());
		expect(container.querySelectorAll("tbody tr")).toHaveLength(count);
		await act(async () => button("Back to Factory").click());
		expect(mocks.getFactoryTask).not.toHaveBeenCalled();
		expect(
			mocks.invoke.mock.calls.filter(
				([command]) => command === "factory_attention",
			),
		).toHaveLength(1);
		expect(
			mocks.subscribe.mock.calls.filter(([event]) => event === "task.updated"),
		).toHaveLength(1);
	});

	it("opens a task requested from outside the Factory and shows a replay's queued review", async () => {
		mocks.tasks = [
			task(),
			task({
				taskId: "task_replay_1",
				title: "Export activity · Cheaper review",
				status: "pending_approval",
				factory: {
					execution: "local",
					approval: "required",
					maxRepairRounds: 2,
					checks: [],
					publishPullRequest: false,
					replay: {
						comparisonId: "comparison_1",
						variantIndex: 0,
						requestHash: "a".repeat(64),
						sourceTaskId: "feature-1",
						sourceRunId: "run-1",
						sourceTaskRevision: 3,
						baseCommit: "base",
						baseBranch: "main",
						label: "Cheaper review",
					},
				},
			}),
		];
		const onRequestedTaskOpened = vi.fn();
		const render = (requestedTaskId?: string) =>
			root.render(
				<FactoryView
					drafts={drafts}
					onOpenSession={vi.fn(async () => {})}
					requestedTaskId={requestedTaskId}
					onRequestedTaskOpened={onRequestedTaskOpened}
				/>,
			);
		await act(async () => render());
		expect(onLine("task_replay_1")).toMatchObject({
			group: "waiting",
			label: "Export activity · Cheaper review, Waiting for plan check",
			stopped: false,
		});
		await act(async () => render("task_replay_1"));
		expect(document.querySelector("h1")?.textContent).toBe(
			"Export activity · Cheaper review",
		);
		expect(sessionStorage.getItem("factory.selectedTask")).toBe(
			"task_replay_1",
		);
		expect(onRequestedTaskOpened).toHaveBeenCalledOnce();
	});

	it("returns from a full task page to the same layout and row, and restores it after remount", async () => {
		mocks.tasks = [
			task({ status: "failed" }),
			task({ taskId: "other", title: "Other work" }),
		];
		const render = () =>
			root.render(
				<FactoryView drafts={drafts} onOpenSession={vi.fn(async () => {})} />,
			);
		await act(async () => render());
		// The Board used to be a destination and then a layout; the line
		// replaces it, and a saved Board opens the home.
		expect(hasButton("Board")).toBe(false);
		expect(hasButton("List")).toBe(false);
		expect(container.querySelector("[data-factory-board]")).toBeNull();
		expect(sessionStorage.getItem("factory.destination")).toBe("activity");
		await act(async () => row("Needs you", "feature-1").click());
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(sessionStorage.getItem("factory.selectedTask")).toBe("feature-1");
		await act(async () => button("Back to Factory").click());
		// Focus returns to the row that opened the card.
		expect(document.activeElement).toBe(row("Needs you", "feature-1"));
		await act(async () => root.unmount());
		root = createRoot(container);
		await act(async () => render());
		expect(section("Needs you")).toContain("Export activity");
		expect(section("Needs you")).not.toContain("Other work");
	});

	it("keeps unavailable activity distinct from queued work and exposes failures inside retained detail", async () => {
		mocks.tasks = [task()];
		let fail = false;
		mocks.invoke.mockImplementation(async (command) => {
			if (command === "factory_attention") {
				if (fail) throw new Error("Connection lost");
				return [];
			}
			return command === "get_desktop_settings" ? {} : [];
		});
		await act(async () =>
			root.render(
				<FactoryView drafts={drafts} onOpenSession={vi.fn(async () => {})} />,
			),
		);
		// Unconfirmed cards wait with the rest of the work, not in a box.
		expect(section("Status unavailable")).toBe("");
		expect(onLine("feature-1").label).toBe(
			"Export activity, Status not loaded yet",
		);
		expect(queueText()).toContain("Status not loaded yet");
		expect(hasButton("Start")).toBe(false);
		await openCard("feature-1");
		fail = true;
		const invalidation = mocks.subscribe.mock.calls.find(
			([event]) => event === "task.updated",
		);
		if (!invalidation) throw new Error("Missing task event subscription");
		await act(async () => invalidation[1]());
		expect(container.querySelector('[role="alert"]')?.textContent).toContain(
			"Connection lost",
		);
		expect(container.textContent).toContain(
			"Can't reach Factory. Showing the last known status.",
		);
		expect(container.textContent).toContain("Export activity");
	});

	it("offers one way in: Ask Factory, never Add work", async () => {
		const onAskFactory = vi.fn();
		await act(async () =>
			root.render(
				<FactoryView
					drafts={drafts}
					onAskFactory={onAskFactory}
					askFactoryOpen={false}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
		const ask = button("Ask Factory");
		// A toggle for the docked panel, and the board's one filled button.
		expect(ask.getAttribute("aria-expanded")).toBe("false");
		expect(ask.getAttribute("aria-pressed")).toBe("false");
		expect(ask.className.split(" ")).toContain("bg-primary");
		expect(
			[...container.querySelectorAll("button")].filter((item) =>
				item.className.split(" ").includes("bg-primary"),
			),
		).toEqual([ask]);
		expect(
			[...container.querySelectorAll("button")].some(
				(candidate) => candidate.textContent?.trim() === "Add work",
			),
		).toBe(false);
		await act(async () => ask.click());
		expect(onAskFactory).toHaveBeenCalledOnce();
		expect(mocks.createTask).not.toHaveBeenCalled();
	});

	it("shows a hands-off retry as work in progress and pauses and resumes new work", async () => {
		const base = task();
		const handsOff = base.factory && {
			...base.factory,
			autonomy: "hands_off" as const,
			approval: "automatic" as const,
		};
		mocks.tasks = [
			task({
				taskId: "retrying",
				title: "Retrying feature",
				status: "failed",
				error: "Provider unavailable",
				approvedRevision: 3,
				lastRunId: "run-retrying",
				updatedAt: "2026-01-01T00:04:00Z",
				factory: handsOff,
			}),
			task({ taskId: "queued", title: "Queued hands-off", factory: handsOff }),
		];
		mocks.invoke.mockImplementation(async (command) =>
			command === "factory_attention"
				? handleFactoryCommand(
						{ pendingQuestions: new Map() },
						"factory_attention",
						undefined,
						async (read) =>
							read === "task.list"
								? { tasks: mocks.tasks }
								: {
										runs: [
											{
												runId: "run-retrying",
												taskRevision: 3,
												factory: factoryRunStateSchema.parse({
													phase: "blocked",
													repairRound: 0,
													workspace: {
														path: "/repo",
														branch: "feat/example",
														baseBranch: "main",
														baseCommit: "a".repeat(40),
													},
													sessions: [],
													autoRecovery: {
														attempts: 1,
														reason: "Provider unavailable",
														at: "2026-01-01T00:05:00Z",
													},
												}),
											},
										],
									},
					)
				: command === "get_desktop_settings"
					? {}
					: [],
		);
		await act(async () =>
			root.render(
				<FactoryView drafts={drafts} onOpenSession={vi.fn(async () => {})} />,
			),
		);
		expect(onLine("retrying")).toMatchObject({
			group: "working",
			station: "build",
			label: "Retrying feature, Retrying after failure (1/1)",
			stopped: false,
		});
		expect(section("Needs you")).not.toContain("Retrying feature");
		expect(hasButton("Resume")).toBe(false);
		expect(hasButton("Try again")).toBe(false);

		await act(async () => button("Pause new work").click());
		expect(mocks.stopFactoryQueue).toHaveBeenCalledOnce();
		// The banner says it, with the card still finishing; the header's
		// one toggle now reads Resume.
		expect(
			container.querySelector('[data-factory-banner="paused"]')?.textContent,
		).toBe(FACTORY_BOARD.paused);
		expect(hasButton("Pause new work")).toBe(false);
		expect(
			Array.from(container.querySelectorAll("button")).filter(
				(item) => item.textContent?.trim() === "Resume",
			),
		).toHaveLength(1);
		// The pause is remembered for this app session only.
		await act(async () => root.unmount());
		root = createRoot(container);
		await act(async () =>
			root.render(
				<FactoryView drafts={drafts} onOpenSession={vi.fn(async () => {})} />,
			),
		);
		expect(container.textContent).toContain(FACTORY_BOARD.paused);
		await act(async () => button("Resume").click());
		expect(mocks.startFactoryQueue).toHaveBeenCalledWith([
			expect.objectContaining({ taskId: "queued" }),
		]);
		expect(container.textContent).not.toContain(FACTORY_BOARD.paused);
		expect(hasButton("Pause new work")).toBe(true);
	});

	it("reads and writes the Hub's persisted pause instead of a session-only one", async () => {
		mocks.tasks = [task({ taskId: "queued", title: "Queued feature" })];
		let hubPaused = true;
		const fallback = mocks.invoke.getMockImplementation();
		mocks.invoke.mockImplementation(async (command, args) => {
			if (command === "factory_get_limits")
				return { supported: true, concurrency: 2, paused: hubPaused };
			if (command === "factory_set_limits") {
				hubPaused = (args as { paused: boolean }).paused;
				return { supported: true, concurrency: 2, paused: hubPaused };
			}
			return fallback?.(command, args);
		});
		const render = async () =>
			act(async () =>
				root.render(
					<FactoryView drafts={drafts} onOpenSession={vi.fn(async () => {})} />,
				),
			);
		await render();
		// Paused on the Hub, e.g. from another window or before a restart.
		expect(container.textContent).toContain(FACTORY_BOARD.paused);
		await act(async () => button("Resume").click());
		expect(mocks.invoke).toHaveBeenCalledWith("factory_set_limits", {
			paused: false,
		});
		// The Hub starts its own queue; the app neither restarts it nor keeps a local pause.
		expect(mocks.startFactoryQueue).not.toHaveBeenCalled();
		expect(sessionStorage.getItem("factory.queueStopped")).toBeNull();
		expect(container.textContent).not.toContain(FACTORY_BOARD.paused);

		await act(async () => button("Pause new work").click());
		expect(mocks.invoke).toHaveBeenCalledWith("factory_set_limits", {
			paused: true,
		});
		expect(mocks.stopFactoryQueue).not.toHaveBeenCalled();
		expect(hubPaused).toBe(true);
		expect(container.textContent).toContain(FACTORY_BOARD.paused);
		expect(sessionStorage.getItem("factory.queueStopped")).toBeNull();
	});

	it("shows an approved card waiting on its automatic retry as working, as core leaves it", async () => {
		const base = task();
		const handsOff = base.factory && {
			...base.factory,
			autonomy: "hands_off" as const,
			approval: "automatic" as const,
		};
		// Core returns the card to approved, clears its error and queues the retry.
		mocks.tasks = [
			task({
				taskId: "retrying",
				title: "Retrying feature",
				status: "approved",
				approvedRevision: 3,
				lastRunId: "run-retrying",
				factory: handsOff,
			}),
		];
		mocks.invoke.mockImplementation(async (command) =>
			command === "factory_attention"
				? handleFactoryCommand(
						{ pendingQuestions: new Map() },
						"factory_attention",
						undefined,
						async (read) =>
							read === "task.list"
								? { tasks: mocks.tasks }
								: {
										runs: [
											{
												runId: "run-retrying",
												taskRevision: 3,
												factory: factoryRunStateSchema.parse({
													phase: "blocked",
													repairRound: 0,
													workspace: {
														path: "/repo",
														branch: "feat/example",
														baseBranch: "main",
														baseCommit: "a".repeat(40),
													},
													sessions: [],
													autoRecovery: {
														attempts: 1,
														reason: "Provider unavailable",
														at: "2026-01-01T00:05:00Z",
													},
												}),
											},
										],
									},
					)
				: command === "get_desktop_settings"
					? {}
					: [],
		);
		await act(async () =>
			root.render(
				<FactoryView drafts={drafts} onOpenSession={vi.fn(async () => {})} />,
			),
		);
		expect(onLine("retrying")).toMatchObject({
			group: "working",
			station: "build",
			label: "Retrying feature, Retrying after failure (1/1)",
			stopped: false,
		});
	});

	it("asks to approve a plan whose automatic approval is waiting instead of reporting a failure", async () => {
		sessionStorage.removeItem("factory.destination");
		const base = task();
		mocks.tasks = [
			task({
				taskId: "waiting",
				title: "Waiting feature",
				status: "pending_approval",
				error:
					"Automatic approval is waiting: Implementer model test-provider/gone is not available",
				factory: base.factory && {
					...base.factory,
					autonomy: "hands_off" as const,
					approval: "automatic" as const,
				},
			}),
		];
		await act(async () =>
			root.render(
				<FactoryView drafts={drafts} onOpenSession={vi.fn(async () => {})} />,
			),
		);
		const plan = onLine("waiting");
		expect(plan.group).toBe("needsYou");
		expect(plan.text).toContain("Waiting feature");
		expect(plan.text).toContain(
			"Implementer model test-provider/gone is not available",
		);
		// It waits at Scope, not stopped.
		expect(plan).toMatchObject({ station: "scope", stopped: false });
	});

	it("labels scoping honestly: queued only when waiting for design, held cards on hold", async () => {
		const base = task();
		const handsOff = base.factory && {
			...base.factory,
			autonomy: "hands_off" as const,
			approval: "automatic" as const,
		};
		const progress = (revision: number, phase: string) =>
			factoryDesignProgressSchema.parse({
				revision,
				repairRound: 0,
				agents: {},
				designerSessionId: "designer",
				findings: [],
				phase,
				...(phase === "complete" ? { reviewerSessions: [], reviews: [] } : {}),
			});
		const card = (taskId: string, overrides: Partial<AgendaTaskRecord>) =>
			task({
				taskId,
				title: `Card ${taskId}`,
				status: "pending_approval",
				factory: handsOff,
				...overrides,
			});
		mocks.tasks = [
			// Never scoped, not held and not queued: nothing will start it.
			card("never-scoped", {}),
			// The Hub reports it in the design queue after a brief edit.
			card("requeued", {
				factoryQueued: "design",
				factoryDesignProgress: progress(2, "complete"),
			}),
			card("held", { factory: handsOff && { ...handsOff, hold: true } }),
			card("scoping", { factoryDesignProgress: progress(3, "designing") }),
			// Scoped before, edited since, and not in the design queue.
			card("stale", { factoryDesignProgress: progress(2, "complete") }),
		];
		await act(async () =>
			root.render(
				<FactoryView drafts={drafts} onOpenSession={vi.fn(async () => {})} />,
			),
		);
		const label = (taskId: string) => onLine(taskId).label;
		expect(label("never-scoped")).toContain("Not started");
		expect(label("never-scoped")).not.toContain("Waiting to start");
		expect(label("requeued")).toContain("Waiting to start");
		expect(label("held")).toContain("On hold");
		expect(label("held")).not.toContain("Waiting to start");
		expect(label("stale")).toContain("Not started");
		expect(onLine("scoping").station).toBe("scope");
		expect(onLine("never-scoped").station).toBe("waiting");
		expect(onLine("held").station).toBe("waiting");
		expect(label("scoping")).toContain("Scoping");
		expect(label("scoping")).not.toContain("Waiting");
	});

	it("never asks for feedback: the old queue opens History, and unrated deliveries are simply delivered", async () => {
		sessionStorage.setItem("factory.destination", "samples");
		const base = task();
		const handsOff = base.factory && {
			...base.factory,
			autonomy: "hands_off" as const,
		};
		const delivered = (audit?: Record<string, unknown>) =>
			factoryRunStateSchema.parse({
				phase: "watching",
				repairRound: 0,
				workspace: {
					path: "/repo",
					branch: "feat/example",
					baseBranch: "main",
					baseCommit: "a".repeat(40),
				},
				sessions: [],
				candidate: { commit: "b".repeat(40), checks: [], reviews: [] },
				...(audit ? { audit } : {}),
			});
		const runs: Record<string, ReturnType<typeof delivered>> = {
			selected: delivered({
				selectedAt: "2026-01-01T00:05:00Z",
				selectionReason: "delivered",
			}),
			reviewed: delivered({
				selectedAt: "2026-01-01T00:05:00Z",
				selectionReason: "delivered",
				reviewedAt: "2026-01-01T00:06:00Z",
			}),
			// No core selection: a hands-off delivery from before automatic
			// sampling still waits for feedback.
			unselected: delivered(),
			// Manual work is sampled only on request.
			manual: delivered(),
		};
		mocks.tasks = Object.keys(runs).map((taskId) =>
			task({
				taskId,
				title: `Feature ${taskId}`,
				status: "completed",
				lastRunId: `run-${taskId}`,
				factory: taskId === "manual" ? base.factory : handsOff,
			}),
		);
		mocks.invoke.mockImplementation(async (command) =>
			command === "factory_attention"
				? handleFactoryCommand(
						{ pendingQuestions: new Map() },
						"factory_attention",
						undefined,
						async (read, args) =>
							read === "task.list"
								? { tasks: mocks.tasks }
								: {
										runs: [
											{
												runId: `run-${args.taskId}`,
												taskRevision: 3,
												factory: runs[String(args.taskId)],
											},
										],
									},
					)
				: command === "get_desktop_settings"
					? {}
					: [],
		);
		await act(async () =>
			root.render(
				<FactoryView drafts={drafts} onOpenSession={vi.fn(async () => {})} />,
			),
		);
		// The old "samples" (feedback queue) destination opens History.
		expect(sessionStorage.getItem("factory.destination")).toBe("history");
		expect(hasButton("Feedback (2)")).toBe(false);
		expect(hasButton("Pick one at random")).toBe(false);
		const rows = Array.from(container.querySelectorAll("tbody tr")).map(
			(row) => row.textContent ?? "",
		);
		// History keeps its feedback column: a rating when given, else nothing.
		expect(rows.find((row) => row.includes("Feature reviewed"))).toContain(
			"Feedback: looks good",
		);
		expect(rows.join(" ")).not.toMatch(
			/waiting for your feedback|not requested/i,
		);
		// On the home, each is a delivery with no rating controls, and none of
		// them needs you.
		await act(async () => button("Back to Factory").click());
		const deliveries = section("Delivered");
		for (const name of Object.keys(runs))
			expect(deliveries).toContain(`Feature ${name}`);
		expect(deliveries).toContain("you said it looks good");
		expect(container.textContent).not.toMatch(
			/feedback|rating|looks good:|something's off/i,
		);
		expect(container.querySelector('[aria-label^="Looks good"]')).toBeNull();
		// Nothing needs you: the column stays, with its one quiet line.
		expect(section("Needs you")).toBe("Needs you0Nothing needs you.");
	});

	it("opens settings from the header and returns focus to it on Back", async () => {
		await act(async () =>
			root.render(
				<FactoryView drafts={drafts} onOpenSession={vi.fn(async () => {})} />,
			),
		);
		await act(async () => labelled("Factory settings").click());
		expect(document.querySelector("h1")?.textContent).toBe("Factory settings");
		// In settings the only way back is the header arrow.
		expect(document.querySelector("[data-factory-settings]")).toBeNull();
		expect(
			document.querySelectorAll('[aria-label="Back to Factory"]'),
		).toHaveLength(1);
		await act(async () => labelled("Back to Factory").click());
		expect(document.activeElement).toBe(labelled("Factory settings"));
		expect(mocks.createTask).not.toHaveBeenCalled();
	});

	it("keeps archived work out of the board and outcomes and opens it from Archived", async () => {
		mocks.tasks = [
			task({
				title: "Archived feature",
				archivedAt: "2026-01-02T00:00:00Z",
				status: "completed",
			}),
			task({ taskId: "active", title: "Active feature" }),
		];
		await act(async () =>
			root.render(
				<FactoryView drafts={drafts} onOpenSession={vi.fn(async () => {})} />,
			),
		);
		expect(container.textContent).not.toContain("Archived feature");
		await act(async () => button("All history").click());
		expect(container.textContent).not.toContain("Archived feature");
		const archivedTab = button("Archived (1)");
		expect(archivedTab.getAttribute("role")).toBe("tab");
		await act(async () =>
			archivedTab.dispatchEvent(
				new MouseEvent("mousedown", { bubbles: true, button: 0 }),
			),
		);
		expect(button("Archived (1)").getAttribute("aria-selected")).toBe("true");
		expect(container.textContent).toContain("Archived feature");
		expect(container.textContent).not.toContain("Active feature");
		expect(section("Working")).toBe("");
		await act(async () => button("Archived feature").click());
		expect(container.textContent).toContain("Archived feature");
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	});
	it("groups actual activity and human actions without treating completion as a stamp", async () => {
		const design = factoryDesignProgressSchema.parse({
			revision: 3,
			repairRound: 0,
			agents: {},
			designerSessionId: "designer",
			findings: [],
			phase: "designing",
		});
		mocks.tasks = [
			task({ taskId: "queued", title: "Queued feature" }),
			task({
				taskId: "scoping",
				title: "Scoping feature",
				status: "pending_approval",
				factoryDesignProgress: design,
			}),
			task({
				taskId: "plan",
				title: "Plan review feature",
				status: "pending_approval",
				factoryDesignProgress: {
					...design,
					phase: "reviewing",
					reviewerSessions: [],
					reviews: [],
				},
			}),
			task({
				taskId: "parallel",
				title: "Parallel feature",
				status: "in_progress",
				currentRunId: "parallel",
			}),
			task({
				taskId: "question",
				title: "Question feature",
				status: "in_progress",
				currentRunId: "question",
			}),
			task({ taskId: "failed", title: "Failed feature", status: "failed" }),
			task({
				taskId: "ready",
				title: "Ready feature",
				status: "completed",
				lastRunId: "ready",
				updatedAt: new Date().toISOString(),
			}),
			task({
				taskId: "stamped",
				title: "Stamped feature",
				status: "completed",
				lastRunId: "stamped",
			}),
			task({
				taskId: "sampled",
				title: "Sampled feature",
				status: "completed",
				lastRunId: "sampled",
			}),
			task({
				taskId: "watching",
				title: "CI feature",
				status: "completed",
				lastRunId: "watching",
			}),
			task({
				taskId: "unknown",
				title: "Unknown feature",
				status: "completed",
			}),
			task({
				taskId: "stale",
				title: "Stale feature",
				status: "completed",
				lastRunId: "new-run",
			}),
			task({
				taskId: "cancelled",
				title: "Cancelled feature",
				status: "cancelled",
			}),
			task({ taskId: "expired", title: "Expired feature", status: "expired" }),
		];
		const ready = factoryRunStateSchema.parse({
			phase: "ready",
			repairRound: 0,
			checks: [],
			sessions: [],
			workspace: {
				path: "/repo",
				branch: "feat/example",
				baseBranch: "main",
				baseCommit: "base",
			},
		});
		const stamp = { commit: "candidate", approvedAt: "2026-01-01T00:00:00Z" };
		const runs = [
			{
				runId: "parallel",
				factory: factoryRunStateSchema.parse({
					...ready,
					phase: "verifying",
					attempts: ["verifier", "reviewer"].map((role) => ({
						id: role,
						key: role,
						role,
						repairRound: 0,
						createdAt: "2026-01-01T00:00:00Z",
						sessionId: role,
						instructions: "Check",
						agent: {},
						status: "running",
					})),
				}),
			},
			{ runId: "ready", factory: ready },
			{ runId: "stamped", factory: { ...ready, humanApproval: stamp } },
			{
				runId: "sampled",
				factory: {
					...ready,
					humanApproval: stamp,
					audit: {
						selectedAt: "2026-01-02T00:00:00Z",
						finding: "Missing requirement",
					},
				},
			},
			{ runId: "watching", factory: { ...ready, phase: "watching" } },
			{ runId: "old-run", factory: { ...ready, humanApproval: stamp } },
			{ runId: "blocked", factory: { ...ready, phase: "blocked" } },
		].map((run) => ({ ...run, taskRevision: 3 }));
		mocks.tasks.push(
			task({
				taskId: "blocked",
				title: "Blocked feature",
				status: "completed",
				lastRunId: "blocked",
			}),
		);
		mocks.tasks.push(
			task({
				taskId: "old-revision",
				title: "Old revision feature",
				status: "completed",
				revision: 4,
				lastRunId: "stamped",
			}),
		);
		const item = {
			requestId: "question-1",
			sessionId: "designer",
			createdAt: "2026-01-01T00:00:00Z",
			question: "Which format?",
			options: [],
		};
		const pendingQuestions = new Map([
			[item.requestId, { item, resolve: vi.fn(), reject: vi.fn() }],
		]);
		mocks.invoke.mockImplementation(async (command) =>
			command === "factory_attention"
				? handleFactoryCommand(
						{ pendingQuestions },
						"factory_attention",
						undefined,
						async (read) =>
							read === "task.list"
								? {
										tasks: mocks.tasks.map((task) =>
											task.taskId === "stale"
												? { ...task, lastRunId: "old-run" }
												: task.taskId === "question"
													? { ...task, originSessionId: "designer" }
													: task,
										),
									}
								: { runs },
					)
				: command === "get_desktop_settings"
					? {}
					: [],
		);

		await act(async () =>
			root.render(
				<FactoryView drafts={drafts} onOpenSession={vi.fn(async () => {})} />,
			),
		);
		// Each card is listed once, at one stage.
		for (const item of mocks.tasks.filter(
			(card) => !["cancelled", "expired"].includes(card.status),
		))
			expect(listed(item.taskId)).toBeLessThanOrEqual(1);
		expect(onLine("queued").station).toBe("waiting");
		expect(onLine("scoping")).toMatchObject({
			group: "working",
			station: "scope",
			label: "Scoping feature, Scoping",
			stopped: false,
		});
		expect(onLine("plan").label).toBe("Plan review feature, Checking the plan");
		expect(onLine("plan").station).toBe("scope");
		// Checks passed; the tester and a code reviewer run side by side.
		expect(onLine("parallel")).toMatchObject({
			group: "working",
			station: "verify",
			label: "Parallel feature, Testing",
			stopped: false,
		});
		expect(onLine("parallel").text).toContain("+1 more");
		expect(onLine("failed")).toMatchObject({
			group: "needsYou",
			stopped: true,
			label: "Failed feature, Stopped at Scope",
		});
		expect(onLine("blocked")).toMatchObject({
			group: "needsYou",
			stopped: true,
		});
		expect(onLine("ready").station).toBe("delivered");
		const deliveries = section("Delivered");
		for (const label of [
			"Ready feature",
			"Stamped feature",
			"reviewed by you",
			"CI feature",
			// Unconfirmed deliveries keep their muted label.
			"Unknown feature",
			"Stale feature",
			"Status not loaded yet",
		])
			expect(deliveries).toContain(label);
		// Every delivery here is among the 20 most recent.
		expect(
			container.querySelectorAll('[data-factory-list="delivered"] li'),
		).toHaveLength(7);
		expect(deliveries).toContain("1 check passed · review passed");
		expect(deliveries).toContain("on a branch, no PR");
		expect(container.textContent).not.toContain("Cancelled feature");
		expect(container.textContent).not.toContain("Expired feature");
		// Needs you holds stopped work first, then decisions. A delivery the
		// person left a note on is delivered: a note asks nothing of them.
		const needsYou = section("Needs you");
		for (const label of [
			"Question feature",
			"Failed feature",
			"Blocked feature",
		])
			expect(needsYou).toContain(label);
		expect(needsYou).not.toContain("Ready feature");
		expect(onLine("sampled").group).toBe("delivered");
		expect(onLine("sampled").text).toContain(
			"You flagged this: “Missing requirement”",
		);
		expect(
			container.querySelector('[data-factory-group="needsYou"] h2')
				?.textContent,
		).toBe("Needs you3");
		const needsOrder = Array.from(
			container.querySelectorAll<HTMLElement>(
				'[data-factory-list="needsYou"] button[data-factory-task]',
			),
		).map((item) => item.dataset.factoryTask);
		expect(needsOrder).toEqual(
			expect.arrayContaining(["blocked", "failed", "question"]),
		);
		expect(needsOrder.indexOf("question")).toBe(2);
		const transportListener = transportListeners();
		await act(async () => transportListener("reconnecting"));
		expect(section("Delivered")).not.toContain("reviewed by you");
		// Without attention only the card's own stop is known.
		expect(section("Needs you")).not.toContain("Question feature");
		expect(onLine("ready").label).toBe("Ready feature, Status not loaded yet");
		await act(async () => transportListener("connected"));
		expect(section("Delivered")).toContain("reviewed by you");
		expect(onLine("ready").label).toBe(
			"Ready feature, Delivered on a branch, no PR",
		);

		await openCard("scoping");
		expect(button("Preparing plan…").disabled).toBe(true);
	});

	it("asks the user to confirm a designer conclusion instead of approving or queueing it", async () => {
		const concluded = (revision: number) =>
			factoryDesignProgressSchema.parse({
				revision,
				repairRound: 0,
				agents: {},
				designerSessionId: "designer",
				findings: [],
				phase: "complete",
				reviewerSessions: [],
				reviews: [],
				conclusion: {
					outcome: "already_fixed",
					rationale: "CSV export already exists.",
					evidence: ["src/export.ts:10"],
				},
			});
		const base = task();
		mocks.tasks = [
			task({
				taskId: "concluded",
				title: "Concluded feature",
				status: "pending_approval",
				factoryDesignProgress: concluded(3),
			}),
			task({
				taskId: "concluded-automatic",
				title: "Automatic concluded feature",
				status: "pending_approval",
				factory: base.factory && { ...base.factory, approval: "automatic" },
				factoryDesignProgress: concluded(3),
			}),
			task({
				taskId: "concluded-approved",
				title: "Approved concluded feature",
				status: "approved",
				factoryDesignProgress: concluded(3),
			}),
		];
		await act(async () =>
			root.render(
				<FactoryView drafts={drafts} onOpenSession={vi.fn(async () => {})} />,
			),
		);
		for (const label of [
			"Concluded feature",
			"Automatic concluded feature",
			"Approved concluded feature",
			"Confirm: no build needed",
		])
			expect(section("Needs you")).toContain(label);
		expect(section("Needs you")).not.toContain("Approve plan");
		// Each waits at Scope, where the conclusion was reached.
		for (const id of ["concluded", "concluded-automatic", "concluded-approved"])
			expect(onLine(id).station).toBe("scope");
		expect(container.textContent).not.toContain("Waiting to build");
		expect(
			container.querySelector('[data-factory-group="needsYou"] h2')
				?.textContent,
		).toBe("Needs you3");
	});

	it("copies a local workflow into the draft and saves its participants without replacing feature checks, PR settings, or docs", async () => {
		const feature = task();
		if (!feature.factory) throw new Error("Missing feature config");
		feature.factory = {
			...feature.factory,
			publishPullRequest: true,
			watchPullRequest: true,
			documents: [{ name: "brief.md", content: "feature details" }],
		};
		mocks.tasks = [feature];
		const preset = {
			name: "Focused",
			config: {
				approval: "required",
				reviewMode: "adaptive",
				maxRepairRounds: 1,
				maxCostUsd: 1,
				maxRuntimeRetries: 0,
				agents: {
					designer: {},
					implementers: [{ instructions: "Keep changes small" }],
					planReviewers: [{}],
					reviewers: [{}, {}],
				},
			},
		};
		mocks.invoke.mockImplementation(async (command) =>
			command === "get_desktop_settings"
				? {
						factoryPresets: [
							preset,
							{
								name: "Default",
								config: { approval: "required", maxRepairRounds: 2 },
							},
						],
					}
				: [],
		);
		mocks.updateAgendaTask.mockResolvedValue(task({ revision: 4 }));
		await act(async () =>
			root.render(
				<FactoryView drafts={drafts} onOpenSession={vi.fn(async () => {})} />,
			),
		);
		await openCard("feature-1");
		await act(async () => {
			const summary = Array.from(document.querySelectorAll("summary")).find(
				(item) => item.textContent?.trim() === "Configuration",
			);
			if (!summary) throw new Error("Missing configuration");
			summary.click();
		});
		const select = document.querySelector(
			'[aria-label="Apply a saved workflow"]',
		);
		if (!(select instanceof HTMLSelectElement))
			throw new Error("Missing preset picker");
		await act(async () => {
			select.value = "Focused";
			select.dispatchEvent(new Event("change", { bubbles: true }));
		});
		await act(async () =>
			changeInput('[aria-label="Builder 1 maxIterations"]', "7"),
		);
		await act(async () => button("Save brief").click());
		expect(mocks.updateAgendaTask).toHaveBeenCalledWith(
			expect.objectContaining({
				expectedRevision: 3,
				factory: {
					...feature.factory,
					...preset.config,
					agents: {
						...preset.config.agents,
						implementers: [
							{
								...preset.config.agents.implementers[0],
								maxIterations: 7,
							},
						],
					},
					documents: feature.factory.documents,
				},
			}),
		);
		expect(document.body.textContent).toContain("2 code reviewers");
		expect(preset.config.agents.implementers).toEqual([
			{
				instructions: "Keep changes small",
			},
		]);
		await act(async () => {
			select.value = "Default";
			select.dispatchEvent(new Event("change", { bubbles: true }));
		});
		await act(async () => button("Save brief").click());
		expect(mocks.updateAgendaTask).toHaveBeenLastCalledWith(
			expect.objectContaining({
				expectedRevision: 4,
				factory: {
					...feature.factory,
					agents: undefined,
					approval: "required",
					maxRepairRounds: 2,
					maxCostUsd: undefined,
					maxRuntimeRetries: undefined,
				},
			}),
		);
		expect(document.body.textContent).toContain("· 1 code reviewer");
		expect(document.body.textContent).not.toContain("1 code reviewers");
	});

	it("labels evidence from an older brief without claiming the edited feature is ready", async () => {
		mocks.tasks = [task({ status: "pending_approval", revision: 4 })];
		mocks.getFactoryTask.mockResolvedValueOnce({
			runs: [
				{
					runId: "run-1",
					attempt: 1,
					claimedAt: new Date().toISOString(),
					taskId: "feature-1",
					taskRevision: 3,
					status: "completed",
					createdAt: "2026-01-01T00:00:00Z",
					updatedAt: "2026-01-01T00:00:00Z",
					factory: {
						phase: "ready",
						repairRound: 0,
						sessions: [],
						workspace: {
							path: "/feature",
							branch: "feat/feature",
							baseBranch: "main",
							baseCommit: "base",
						},
					},
				},
			],
		});
		await act(async () =>
			root.render(
				<FactoryView drafts={drafts} onOpenSession={vi.fn(async () => {})} />,
			),
		);
		await openCard("feature-1");
		await act(async () => selectTab("Verification"));
		expect(document.body.textContent).toContain("from an earlier attempt");
		expect(document.body.textContent).not.toContain(
			"Changes are ready for your review",
		);
	});
	it("starts only approved factory features and leaves ordinary Agenda tasks untouched", async () => {
		const approved = task();
		mocks.tasks = [
			approved,
			task({
				taskId: "design",
				title: "Needs design",
				status: "pending_approval",
			}),
			task({
				taskId: "ordinary",
				title: "Ordinary reminder",
				factory: undefined,
			}),
		];
		await act(async () =>
			root.render(
				<FactoryView drafts={drafts} onOpenSession={vi.fn(async () => {})} />,
			),
		);
		expect(container.textContent).not.toContain("Ordinary reminder");
		// The queue is Working's lower part.
		const queued = container.querySelectorAll<HTMLButtonElement>(
			'[data-factory-list="working"] li[data-factory-row="waiting"] button',
		);
		const start = Array.from(queued).filter(
			(item) => item.textContent === "Start",
		);
		// Only the approved manual card waiting outside the Hub queue.
		expect(start).toHaveLength(1);
		await act(async () => start[0]?.click());
		expect(mocks.startFactoryQueue).toHaveBeenCalledWith([approved]);
		expect(container.textContent).toContain("Starting “Export activity”.");
	});
	it("approves the saved revision and starts the design interview without leaving the feature", async () => {
		mocks.tasks = [task({ status: "pending_approval" })];
		mocks.updateAgendaTask.mockResolvedValue(task({ revision: 4 }));
		mocks.approveAgendaTask.mockResolvedValue(task({ revision: 5 }));
		const openSession = vi.fn(async () => {});
		await act(async () =>
			root.render(<FactoryView drafts={drafts} onOpenSession={openSession} />),
		);
		await openCard("feature-1");
		await act(async () => button("Approve and run").click());
		expect(mocks.updateAgendaTask).not.toHaveBeenCalled();
		expect(mocks.approveAgendaTask).toHaveBeenCalledWith({
			taskId: "feature-1",
			expectedRevision: 3,
			allWorkspaces: true,
		});
		await act(async () => button("Start scoping").click());
		expect(mocks.designFactoryTask).toHaveBeenCalledWith("feature-1");
		// The started interview is this feature's design session from here on.
		await act(async () => button("Refine design").click());
		expect(mocks.updateAgendaTask).not.toHaveBeenCalled();
		expect(openSession).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain("Questions will appear here");
		await act(async () => button("View design transcript").click());
		expect(openSession).toHaveBeenCalledWith("design-1");
	});
	it("collects a running feature question in Needs you and answers it through the existing protocol", async () => {
		mocks.tasks = [
			task({ status: "in_progress" }),
			task({ taskId: "other", title: "Unblocked feature" }),
		];
		let pending = true;
		mocks.invoke.mockImplementation(async (command) => {
			if (command === "factory_attention")
				return pending
					? [
							{
								taskId: "feature-1",
								revision: 3,
								needsAttention: true,
								questions: [
									{
										requestId: "q1",
										sessionId: "builder-1",
										createdAt: "2026-01-01T00:00:00Z",
										question: "Which format?",
										options: ["CSV", "JSON"],
									},
								],
							},
						]
					: [];
			if (command === "respond_ask_question") pending = false;
			return command === "get_desktop_settings" ? {} : [];
		});
		await act(async () =>
			root.render(
				<FactoryView drafts={drafts} onOpenSession={vi.fn(async () => {})} />,
			),
		);
		expect(onLine("feature-1").group).toBe("needsYou");
		expect(onLine("feature-1").text).toContain("Question: Which format?");
		expect(section("Needs you")).not.toContain("Unblocked feature");
		await act(async () => row("Needs you", "feature-1").click());
		expect(document.body.textContent).toContain("Which format?");
		const answer = Array.from(
			document.querySelectorAll('[aria-label="Follow-up question"] button'),
		).find((item) => item.textContent?.includes("CSV"));
		if (!(answer instanceof HTMLButtonElement))
			throw new Error("Missing CSV option");
		await act(async () => answer.click());
		expect(mocks.invoke).toHaveBeenCalledWith("respond_ask_question", {
			environmentId: "local",
			requestId: "q1",
			answer: "CSV",
		});
		expect(document.body.textContent).not.toContain("Which format?");
		await act(async () => button("Back to Factory").click());
		// Answered: Needs you stays, empty.
		expect(section("Needs you")).toBe("Needs you0Nothing needs you.");
	});
	it("loads an agent-saved brief into the open feature without copying from chat", async () => {
		mocks.tasks = [task({ status: "pending_approval" })];
		const render = () =>
			root.render(
				<FactoryView drafts={drafts} onOpenSession={vi.fn(async () => {})} />,
			);
		await act(async () => render());
		await openCard("feature-1");
		mocks.tasks = [
			task({
				status: "pending_approval",
				revision: 4,
				instructions: "Export CSV with quoted values and UTF-8 headers.",
			}),
		];
		await act(async () => render());
		await act(async () => button("Edit").click());
		const brief = document.querySelector('textarea[aria-label="Design brief"]');
		expect(brief).toBeInstanceOf(HTMLTextAreaElement);
		if (brief instanceof HTMLTextAreaElement)
			expect(brief.value).toBe(
				"Export CSV with quoted values and UTF-8 headers.",
			);
	});
	it.each([
		"watching",
		"blocked",
		"ready",
		"closed",
	] as const)("controls %s PR follow-up without changing its repair budget", async (phase) => {
		const feature = task({ status: "completed", lastRunId: "run-1" });
		if (!feature.factory) throw new Error("Missing factory configuration");
		feature.factory.watchPullRequest = true;
		feature.factory.publishPullRequest = true;
		mocks.tasks = [feature];
		mocks.getFactoryTask.mockResolvedValueOnce({
			runs: [
				{
					runId: "run-1",
					attempt: 1,
					claimedAt: new Date().toISOString(),
					taskId: feature.taskId,
					taskRevision: feature.revision,
					status: "completed",
					createdAt: feature.createdAt,
					updatedAt: feature.updatedAt,
					factory: {
						phase: phase === "closed" ? "ready" : phase,
						repairRound: 2,
						sessions: [],
						candidate: { commit: "candidate", checks: [], reviews: [] },
						workspace: {
							path: "/feature",
							branch: "feat/feature",
							baseBranch: "main",
							baseCommit: "base",
						},
						pullRequestUrl: "https://github.com/owner/repo/pull/9",
						pullRequestWatch:
							phase === "closed"
								? undefined
								: {
										headCommit: "candidate",
										handledFeedbackIds: [],
										paused: phase === "ready",
									},
					},
				},
			],
		});
		mocks.invoke.mockImplementation(async (command) =>
			command === "factory_attention"
				? [
						{
							taskId: feature.taskId,
							revision: feature.revision,
							questions: [],
							needsAttention: phase !== "watching",
						},
					]
				: command === "get_desktop_settings"
					? {}
					: [],
		);
		await act(async () =>
			root.render(
				<FactoryView drafts={drafts} onOpenSession={vi.fn(async () => {})} />,
			),
		);
		// Without run details, each is a delivery, not a stop.
		expect(onLine("feature-1").group).toBe("delivered");
		await openCard("feature-1");
		await act(async () => selectTab("Verification"));
		if (phase === "closed") {
			expect(document.body.textContent).not.toContain("Resume PR follow-up");
			expect(document.body.textContent).not.toContain("Pause PR follow-up");
			return;
		}
		await act(async () =>
			button(
				phase === "watching" ? "Pause PR follow-up" : "Resume PR follow-up",
			).click(),
		);
		expect(mocks.invoke).toHaveBeenCalledWith("task.factory.watch", {
			taskId: "feature-1",
			expectedRevision: 3,
			enabled: phase !== "watching",
			allWorkspaces: true,
		});
		// The repair budget is the card's; following up never edits it.
		expect(mocks.updateAgendaTask).not.toHaveBeenCalled();
	});
});

describe("Factory home", () => {
	const handsOff = () => {
		const base = task().factory;
		if (!base) throw new Error("Missing factory configuration");
		return {
			...base,
			autonomy: "hands_off" as const,
			approval: "automatic" as const,
		};
	};
	const outcome = (phase: string, extra: Record<string, unknown> = {}) => ({
		phase,
		repairRound: 0,
		activeRoles: [],
		activeSessions: [],
		followupPaused: false,
		...extra,
	});
	const render = (props: { onAskFactory?: () => void } = {}) =>
		act(async () =>
			root.render(
				<FactoryView
					drafts={drafts}
					onAskFactory={props.onAskFactory}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
	/** Attention and limits for the given cards, bypassing the sidecar. */
	const withBoard = (items: unknown[], limits: unknown = {}) =>
		mocks.invoke.mockImplementation(async (command) =>
			command === "factory_attention"
				? items
				: command === "factory_get_limits"
					? limits
					: command === "get_desktop_settings"
						? {}
						: command === "factory_get_stages"
							? { file: "absent", stages: [] }
							: [],
		);
	const attention = (taskId: string, extra: Record<string, unknown> = {}) => ({
		taskId,
		revision: 3,
		runId: `run-${taskId}`,
		questions: [],
		needsAttention: false,
		...extra,
	});
	const minutesAgo = (minutes: number) =>
		new Date(Date.now() - minutes * 60_000).toISOString();
	beforeEach(() => sessionStorage.removeItem("factory.destination"));

	it("lays the board out in lifecycle order, every column always, each card once", async () => {
		mocks.tasks = [
			task({
				taskId: "build",
				title: "Building card",
				status: "in_progress",
				currentRunId: "run-build",
			}),
			task({
				taskId: "pr",
				title: "PR card",
				status: "completed",
				lastRunId: "run-pr",
				factory: handsOff(),
			}),
			task({
				taskId: "done",
				title: "Delivered card",
				status: "completed",
				lastRunId: "run-done",
			}),
			task({
				taskId: "failed",
				title: "Failed card",
				status: "failed",
				approvedRevision: 3,
			}),
		];
		withBoard([
			attention("build", { outcome: outcome("implementing") }),
			attention("pr", {
				needsAttention: true,
				outcome: outcome("watching", {
					pullRequestUrl: "https://github.com/owner/repo/pull/7",
				}),
			}),
			attention("done", {
				outcome: outcome("ready", {
					humanApproval: { commit: "c", approvedAt: "2026-01-01T00:00:00Z" },
				}),
			}),
			{ taskId: "failed", revision: 3, questions: [], needsAttention: true },
		]);
		await render();
		// Three columns in lifecycle order, each a region named by its heading
		// and count, empty or not; the queue is Working's lower part.
		expect(groups()).toEqual(["working", "needsYou", "delivered"]);
		const board = container.querySelector('[aria-label="Factory board"]');
		expect(board?.getAttribute("data-factory-grouping")).toBe("status");
		expect(
			Array.from(container.querySelectorAll("[data-factory-group] h2")).map(
				(heading) => heading.textContent,
			),
		).toEqual(["Working1", "Needs you1", "Delivered2"]);
		// Nothing queued: no queue divider.
		expect(container.querySelector("[data-factory-section]")).toBeNull();
		expect(filledGroups()).toEqual(["working", "needsYou", "delivered"]);
		for (const id of ["build", "pr", "done", "failed"])
			expect(listed(id)).toBe(1);
		// Nothing collapses at full width; nothing from the list home is left.
		for (const selector of [
			"[data-factory-line]",
			"[data-factory-strip]",
			"[data-factory-more]",
			"[data-row-chip]",
		])
			expect(container.querySelector(selector)).toBeNull();
		// The stage is a stepper on the card, never a column.
		expect(
			homeRow("build")
				.querySelector('[data-factory-stages] [role="img"]')
				?.getAttribute("aria-label"),
		).toBe("Build, stage 2 of 5");
		expect(onLine("build")).toMatchObject({
			group: "working",
			station: "build",
			label: "Building card, Building",
		});
		expect(onLine("failed")).toMatchObject({
			group: "needsYou",
			station: "build",
			label: "Failed card, Stopped at Build",
			stopped: true,
		});
		const deliveries = section("Delivered");
		expect(deliveries).toContain("PR card");
		expect(deliveries).toContain("reviewed by you");
		// Draft PRs open outside the app, from the row.
		await act(async () => labelled("Open draft PR: PR card").click());
		expect(openExternalUrl).toHaveBeenCalledWith(
			"https://github.com/owner/repo/pull/7",
		);
		// A branch-only delivery has no action; its proof line says so.
		expect(onLine("done").text).toContain("on a branch, no PR");
		expect(
			homeRow("done").querySelector("button:not([data-factory-task])"),
		).toBeNull();
		// A retry that can work runs from the row.
		await act(async () => labelled("Try again: Failed card").click());
		expect(mocks.startFactoryQueue).toHaveBeenCalledWith([
			expect.objectContaining({ taskId: "failed" }),
		]);
		expect(container.textContent).toContain("Trying “Failed card” again.");
		// One All history link, in the Delivered heading.
		const history = Array.from(container.querySelectorAll("button")).filter(
			(item) => item.textContent === "All history",
		);
		expect(history).toHaveLength(1);
		expect(
			history[0]?.closest('[data-factory-group="delivered"]'),
		).not.toBeNull();
		await act(async () => history[0]?.click());
		const finishedTab = button("Finished (3)");
		expect(finishedTab.getAttribute("role")).toBe("tab");
		expect(finishedTab.getAttribute("aria-selected")).toBe("true");
		// A filter, never drawn as the primary action.
		expect(
			[...container.querySelectorAll("button")].some((item) =>
				item.className.split(" ").includes("bg-primary"),
			),
		).toBe(false);
	});

	it("puts a delivery that waits for review in Needs you only, with Review", async () => {
		const url = "https://github.com/owner/repo/pull/15672";
		mocks.tasks = [
			task({
				taskId: "findings",
				title: "Findings card",
				status: "failed",
				approvedRevision: 3,
				lastRunId: "run-findings",
				updatedAt: new Date().toISOString(),
				factory: handsOff(),
			}),
		];
		withBoard([
			attention("findings", {
				needsAttention: true,
				outcome: outcome("blocked", {
					pullRequestUrl: url,
					unresolvedFindings: {
						commit: "c",
						findings: ["Reviewer 1: a", "Reviewer 1: b", "Reviewer 1: c"],
						pullRequestOpen: true,
					},
					humanReview: { required: true, reason: "review findings unresolved" },
				}),
			}),
		]);
		await render();
		expect(filledGroups()).toEqual(["needsYou"]);
		expect(listed("findings")).toBe(1);
		const row = onLine("findings");
		expect(row).toMatchObject({ station: "delivered", stopped: false });
		expect(row.text).toContain(
			"Draft PR open · reviewer has 3 unresolved findings",
		);
		// Amber edge: a decision, not a stop. No second, competing action.
		expect(homeRow("findings").className).toContain("amber");
		expect(
			container.querySelector('[aria-label="Open draft PR: Findings card"]'),
		).toBeNull();
		expect(hasButton("Try again")).toBe(false);
	});

	it("offers Try again only when the engine will run again", async () => {
		const base = task();
		mocks.tasks = [
			task({
				taskId: "fault",
				title: "Fault card",
				status: "failed",
				// Edited since approval: only the plan fault makes it retryable.
				approvedRevision: 2,
				factory: base.factory && {
					...base.factory,
					checks: [
						{
							name: "API",
							command: "bun test",
							kind: "test",
							artifacts: ["/tmp/api.log"],
						},
					],
				},
			}),
			task({
				taskId: "stuck",
				title: "Stuck card",
				status: "failed",
				approvedRevision: 3,
				error: "The plan's checks still need fixing: Check API.",
			}),
			task({
				taskId: "limit",
				title: "Repair limit card",
				status: "failed",
				approvedRevision: 3,
				error:
					"Repair limit (2) reached.\n- src/onboarding.ts: the checklist still renders twice",
			}),
			task({
				taskId: "scoping",
				title: "Scoping card",
				status: "pending_approval",
				error:
					"Design did not complete: Plan repair limit (2) reached. The plan reviewers still had objections.",
			}),
			task({
				taskId: "rescope",
				title: "Rescope card",
				status: "pending_approval",
				error: "Design did not complete: the designer crashed.",
			}),
		];
		withBoard(
			mocks.tasks.map((item) => ({
				taskId: item.taskId,
				revision: 3,
				questions: [],
				needsAttention: true,
			})),
		);
		await render();
		/** A card's one quick action, or null when opening it is the action. */
		const quick = (taskId: string) => {
			const actions = homeRow(taskId).querySelectorAll(
				"[data-factory-quick-action] button",
			);
			expect(actions.length).toBeLessThanOrEqual(1);
			return actions[0]?.textContent ?? null;
		};
		expect(quick("fault")).toBe("Try again");
		expect(quick("rescope")).toBe("Try scoping again");
		// A repair limit gets one more round from a person's retry.
		expect(quick("limit")).toBe("Try again");
		// A retry cannot fix these: Edit plan is on the card, which opens.
		expect(quick("stuck")).toBeNull();
		expect(quick("scoping")).toBeNull();
		expect(container.textContent).not.toContain("Edit plan");
		// Stopped cards carry the red edge and the stop at their stage.
		expect(homeRow("limit").className).toContain("destructive");
		expect(onLine("limit")).toMatchObject({
			label: "Repair limit card, Stopped at Build",
			stopped: true,
		});
		expect(onLine("fault").text).toContain(
			"The plan's checks need fixing. Try again sends it back to scoping.",
		);
		expect(onLine("stuck").text).toContain(
			"Factory could not fix the plan's checks on its own. Edit the plan to fix them.",
		);
		expect(onLine("scoping").text).toContain(
			"The plan checkers still had objections after 2 rounds of fixes.",
		);
		// The plan's checks belong to Build.
		expect(onLine("fault").station).toBe("build");
		await act(async () => labelled("Try again: Fault card").click());
		expect(mocks.designFactoryTask).toHaveBeenCalledWith("fault");
		expect(mocks.startFactoryQueue).not.toHaveBeenCalled();
		expect(container.textContent).toContain(
			"Sending “Fault card” back to scoping: its checks need fixing.",
		);
		await act(async () => labelled("Try scoping again: Rescope card").click());
		expect(mocks.designFactoryTask).toHaveBeenCalledWith("rescope");
		await act(async () => labelled("Try again: Repair limit card").click());
		expect(mocks.startFactoryQueue).toHaveBeenCalledWith([
			expect.objectContaining({ taskId: "limit" }),
		]);
		await act(async () => row("Needs you", "stuck").click());
		expect(sessionStorage.getItem("factory.selectedTask")).toBe("stuck");
	});

	it("shows running work with its live line and Watch, without opening anything", async () => {
		mocks.tasks = [
			task({
				taskId: "build",
				title: "Building card",
				status: "in_progress",
				currentRunId: "run-build",
			}),
			task({
				taskId: "checks",
				title: "Checking card",
				status: "in_progress",
				currentRunId: "run-checks",
			}),
		];
		withBoard(
			[
				attention("build", {
					outcome: outcome("implementing", {
						activeSessions: [
							{
								sessionId: "builder-session",
								role: "builder",
								startedAt: "2026-01-01T00:00:00Z",
							},
						],
					}),
				}),
				attention("checks", { outcome: outcome("verifying") }),
			],
			{ supported: true, concurrency: 5 },
		);
		const onOpenSession = vi.fn(async () => {});
		await act(async () =>
			root.render(
				<FactoryView drafts={drafts} onOpenSession={onOpenSession} />,
			),
		);
		expect(filledGroups()).toEqual(["working"]);
		expect(
			container.querySelector('[data-factory-group="working"] h2')
				?.parentElement?.textContent,
		).toBe("Working2of 5");
		const build = homeRow("build");
		expect(
			build.querySelector('[data-testid="factory-live-line"]')?.textContent,
		).toContain("Builder · Working");
		// The plan's checks run in Build.
		expect(onLine("checks")).toMatchObject({ station: "build" });
		expect(onLine("checks").text).toContain("Running checks");
		// Watch is the card's one quick action, a sibling of the card button.
		const actions = build.querySelectorAll(
			"[data-factory-quick-action] button",
		);
		expect(actions).toHaveLength(1);
		const watch = actions[0] as HTMLButtonElement;
		expect(watch.textContent).toBe("Watch");
		expect(watch.closest("[data-factory-task]")).toBeNull();
		// The card's only other control is the card itself.
		expect(build.querySelectorAll("button")).toHaveLength(2);
		await act(async () => watch.click());
		expect(onOpenSession).toHaveBeenCalledWith("builder-session");
		expect(sessionStorage.getItem("factory.selectedTask")).toBeNull();
	});

	it("ends a delivered card's line with what became of its PR", async () => {
		const pr = {
			draft: {},
			ready: { pullRequestReady: true },
			merged: {
				pullRequestOutcome: { state: "merged", headChanged: false, at: "x" },
			},
			changed: {
				pullRequestOutcome: { state: "merged", headChanged: true, at: "x" },
			},
			closed: {
				pullRequestOutcome: { state: "closed", headChanged: false, at: "x" },
			},
		};
		mocks.tasks = Object.keys(pr).map((taskId) =>
			task({
				taskId,
				status: "completed",
				lastRunId: `run-${taskId}`,
				factory: handsOff(),
			}),
		);
		withBoard(
			Object.entries(pr).map(([taskId, extra]) =>
				attention(taskId, {
					outcome: outcome("ready", {
						pullRequestUrl: `https://github.com/o/r/pull/${taskId}`,
						humanApproval: { commit: "c", approvedAt: "x" },
						...extra,
					}),
				}),
			),
		);
		await render();
		const ending = (taskId: string) =>
			container
				.querySelector(`[data-factory-card="${taskId}"] [data-factory-proof]`)
				?.textContent?.split(" · ")
				.at(-1);
		expect(Object.keys(pr).map(ending)).toEqual([
			"draft PR",
			"ready for review",
			"merged",
			"merged after changes",
			"closed without merging",
		]);
		// Only an open draft's button says draft.
		expect(
			Object.keys(pr).map(
				(taskId) =>
					container.querySelector(
						`[data-factory-card="${taskId}"] [data-factory-quick-action] button`,
					)?.textContent,
			),
		).toEqual(["Open draft PR", "Open PR", "Open PR", "Open PR", "Open PR"]);
		// The quick action sits in the card's first row, in its flow, after
		// the age: never over the title or the line below it.
		const card = container.querySelector('[data-factory-card="draft"]');
		const action = card?.querySelector("[data-factory-quick-action]");
		expect(action?.parentElement?.hasAttribute("data-factory-card-top")).toBe(
			true,
		);
		expect(action?.previousElementSibling?.textContent).toMatch(/\d/);
		expect(action?.className).not.toMatch(/\babsolute\b|\bbottom-/);
		expect(action?.className).not.toContain("shadow-[");
		// Its context line: three lines at most, the whole text as its tooltip.
		const context = card?.querySelector("[data-factory-context]");
		expect(context?.className).toContain("line-clamp-3");
		expect(context?.getAttribute("title")).toBe(context?.textContent);
	});

	it("caps Delivered at the 20 most recent, with today's count as its tooltip", async () => {
		// "Today" is the local day: run at noon so five minutes ago is today.
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(2026, 10, 11, 12));
		onTestFinished(() => {
			vi.useRealTimers();
		});
		mocks.tasks = Array.from({ length: 22 }, (_, index) =>
			task({
				taskId: `d${index}`,
				title: `Delivery ${index}`,
				status: "completed",
				lastRunId: `run-d${index}`,
				// Two were delivered days ago.
				updatedAt: minutesAgo(index < 5 ? index + 1 : 3 * 24 * 60 + index),
				factory: handsOff(),
			}),
		);
		withBoard(
			mocks.tasks.map((item) =>
				attention(item.taskId, {
					outcome: outcome("watching", {
						pullRequestUrl: `https://github.com/owner/repo/pull/${item.taskId}`,
						// Sampled by core, and never rated.
						audit: { selectedAt: "x", selectionReason: "delivered" },
					}),
				}),
			),
		);
		await render();
		expect(filledGroups()).toEqual(["delivered"]);
		expect(
			container.querySelectorAll('[data-factory-list="delivered"] li'),
		).toHaveLength(20);
		const count = container.querySelector(
			'[data-factory-group="delivered"] [data-factory-count]',
		);
		expect(count?.textContent).toBe("20");
		expect(count?.getAttribute("title")).toBe("5 today");
		expect(section("Delivered")).toContain("20 most recent");
		expect(listed("d21")).toBe(0);
		// The single way to History from the board.
		expect(
			Array.from(container.querySelectorAll("button")).filter(
				(item) => item.textContent === "All history",
			),
		).toHaveLength(1);
		// An unrated delivery asks nothing and needs no one.
		expect(container.textContent).not.toMatch(/feedback|rating/i);
		expect(section("Needs you")).toBe("Needs you0Nothing needs you.");
	});

	it("reads today's spend again once card work spends, and not while nothing changes", async () => {
		mocks.tasks = [
			task({
				taskId: "build",
				title: "Building card",
				status: "in_progress",
				currentRunId: "run-build",
			}),
		];
		const cost = (totalCost: number) => [
			attention("build", {
				outcome: outcome("implementing", {
					usage: {
						totals: {
							inputTokens: 0,
							outputTokens: 0,
							cacheReadTokens: 0,
							cacheWriteTokens: 0,
							totalCost,
						},
						unknownSessionIds: [],
					},
				}),
			}),
		];
		const limitReads = () =>
			mocks.invoke.mock.calls.filter(
				([command]) => command === "factory_get_limits",
			).length;
		withBoard(cost(1), { supported: true, concurrency: 3, spentTodayUsd: 4 });
		vi.useFakeTimers();
		try {
			await render();
			const refreshAttention = () =>
				act(async () => {
					for (const [event, handler] of mocks.subscribe.mock.calls)
						if (event === "task.updated") handler();
				});
			await refreshAttention();
			await act(async () => vi.advanceTimersByTimeAsync(10_000));
			expect(limitReads()).toBe(1);
			withBoard(cost(1.5), {
				supported: true,
				concurrency: 3,
				spentTodayUsd: 4.5,
			});
			await refreshAttention();
			await act(async () => vi.advanceTimersByTimeAsync(10_000));
			expect(limitReads()).toBe(2);
			expect(
				container.querySelector("[data-factory-spend]")?.textContent,
			).toContain("$4.50");
		} finally {
			vi.useRealTimers();
		}
	});

	it("shows a banner only when paused, at the spending limit, or unreachable", async () => {
		mocks.tasks = [
			task({
				taskId: "build",
				title: "Building card",
				status: "in_progress",
				currentRunId: "run-build",
			}),
		];
		const items = [attention("build", { outcome: outcome("implementing") })];
		withBoard(items, {
			supported: true,
			concurrency: 3,
			dailyCostUsd: 50,
			spentTodayUsd: 12.4,
		});
		await render();
		expect(container.querySelector("[data-factory-banner]")).toBeNull();
		expect(container.querySelector('[role="alert"]')).toBeNull();
		// Today's spend sits in the header.
		expect(container.querySelector("[data-factory-spend]")?.textContent).toBe(
			"$12.40 of $50 today",
		);
		await act(async () => root.unmount());
		root = createRoot(container);
		withBoard(items, {
			supported: true,
			concurrency: 3,
			dailyCostUsd: 50,
			spentTodayUsd: 50,
		});
		await render();
		const limit = container.querySelector('[data-factory-banner="limit"]');
		expect(limit?.textContent).toContain(
			"Stopped at the spending limit: $50 of $50 spent today.",
		);
		await act(async () => button("Change the limit").click());
		expect(sessionStorage.getItem("factory.destination")).toBe("settings");
		// It opens General with the daily limit focused.
		expect(
			document.activeElement?.closest('[data-setting="dailyCostUsd"]'),
		).toBeTruthy();
		await act(async () => root.unmount());
		root = createRoot(container);
		sessionStorage.removeItem("factory.destination");
		// A spend the Hub does not report is left out.
		withBoard(items, { supported: true, concurrency: 3, paused: true });
		await render();
		expect(container.querySelector("[data-factory-spend]")).toBeNull();
		expect(
			container.querySelector('[data-factory-banner="paused"]')?.textContent,
		).toBe(FACTORY_BOARD.paused);
		// Resume is the header's one toggle, not repeated in the banner.
		expect(
			container.querySelector('[data-factory-banner="paused"] button'),
		).toBeNull();
		expect(
			container.querySelector('[data-factory-pause="resume"]')?.textContent,
		).toBe("Resume");
		expect(
			Array.from(container.querySelectorAll("button")).filter((item) =>
				/Resume/.test(item.textContent ?? ""),
			),
		).toHaveLength(1);
	});

	it("keeps a column's order while the pointer or focus is in it", async () => {
		const delivered = (taskId: string, minutes: number) =>
			task({
				taskId,
				title: `Card ${taskId}`,
				status: "completed",
				updatedAt: minutesAgo(minutes),
			});
		mocks.tasks = [delivered("a", 10), delivered("b", 20)];
		await render();
		const order = () =>
			Array.from(
				container.querySelectorAll(
					'[data-factory-list="delivered"] [data-factory-task]',
				),
			).map((item) => item.getAttribute("data-factory-task"));
		expect(order()).toEqual(["a", "b"]);
		const rowA = () =>
			container.querySelector<HTMLElement>(
				'[data-factory-list="delivered"] [data-factory-task="a"]',
			);
		await act(async () => rowA()?.focus());
		// b is delivered again, newest now, while focus is in the list.
		mocks.tasks = [delivered("a", 10), delivered("b", 1)];
		await render();
		expect(order()).toEqual(["a", "b"]);
		// Once focus leaves, the newest comes first.
		await act(async () => rowA()?.blur());
		await render();
		expect(order()).toEqual(["b", "a"]);
	});

	it("keeps three open columns when the factory is empty, with nothing but the header's way in", async () => {
		const onAskFactory = vi.fn();
		await render({ onAskFactory });
		expect(
			container.textContent?.split(FACTORY_BOARD.empty.nothing),
		).toHaveLength(2);
		expect(groups()).toEqual(["working", "needsYou", "delivered"]);
		expect(section("Working")).toContain(FACTORY_BOARD.empty.nothing);
		// Its one instruction shows at every width: nothing collapses.
		mocks.boardWidth = 600;
		await render({ onAskFactory });
		expect(container.querySelector("[data-factory-strip]")).toBeNull();
		expect(section("Working")).toContain(FACTORY_BOARD.empty.nothing);
		expect(container.querySelector("[data-factory-pause]")).toBeNull();
		const asks = Array.from(container.querySelectorAll("button")).filter(
			(item) => item.textContent?.trim() === "Ask Factory",
		);
		expect(asks).toHaveLength(1);
		await act(async () => asks[0]?.click());
		expect(onAskFactory).toHaveBeenCalledOnce();
	});
});

describe("Factory work-at-once limit", () => {
	/** Answers the limit commands and leaves the rest to the default mock. */
	function withLimits(
		limits: (command: string, args: unknown) => Promise<unknown>,
	) {
		const fallback = mocks.invoke.getMockImplementation();
		mocks.invoke.mockImplementation(async (command, args) =>
			command === "factory_get_limits" || command === "factory_set_limits"
				? limits(command, args)
				: fallback?.(command, args),
		);
	}
	const render = () =>
		act(async () =>
			root.render(
				<FactoryView drafts={drafts} onOpenSession={vi.fn(async () => {})} />,
			),
		);
	const limitSelect = () => {
		const select = document.getElementById("factory-concurrency");
		if (!(select instanceof HTMLSelectElement))
			throw new Error("Missing work-at-once limit");
		return select;
	};
	const choose = (value: string) =>
		act(async () => {
			const select = limitSelect();
			select.value = value;
			select.dispatchEvent(new Event("change", { bubbles: true }));
		});

	it("applies a new limit at once and keeps the Hub's answer", async () => {
		let resolveSet: (value: unknown) => void = () => {};
		withLimits(async (command) =>
			command === "factory_get_limits"
				? { supported: true, concurrency: 2 }
				: new Promise((resolve) => {
						resolveSet = resolve;
					}),
		);
		await render();
		await act(async () => button("of 2").click());
		expect(document.body.textContent).toContain("Work on up to");
		expect(document.body.textContent).toContain(
			"Other work waits in the queue and starts as slots free up.",
		);
		expect(limitSelect().value).toBe("2");
		await choose("5");
		expect(limitSelect().value).toBe("5");
		expect(mocks.invoke).toHaveBeenCalledWith("factory_set_limits", {
			concurrency: 5,
		});
		await act(async () => resolveSet({ supported: true, concurrency: 5 }));
		expect(limitSelect().value).toBe("5");
		expect(limitSelect().disabled).toBe(false);
	});

	it("rolls back a rejected limit and says why", async () => {
		withLimits(async (command) => {
			if (command === "factory_get_limits")
				return { supported: true, concurrency: 2 };
			throw new Error(
				"Factory could not change how much work runs at once: Hub offline",
			);
		});
		await render();
		await act(async () => button("of 2").click());
		await choose("6");
		expect(limitSelect().value).toBe("2");
		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			"Factory could not change how much work runs at once: Hub offline",
		);
	});

	it("lists a split's parent beside running work without a slot and keeps a waiting part's reason in the queue", async () => {
		const part = (title: string, taskId: string) => ({
			title,
			brief: `${title}.`,
			paths: [`src/${taskId}`],
			dependsOn: [],
			taskId,
		});
		mocks.tasks = [
			task({
				taskId: "parent",
				factoryNumber: 40,
				title: "Export and link activity",
				status: "completed",
				factorySplit: {
					splitId: "split-1",
					revision: 3,
					approvedAt: "2026-01-01T00:00:00Z",
					goal: "Export and link activity",
					createdAt: "2026-01-01T00:00:01Z",
					parts: [
						part("Add CSV export", "p1"),
						{ ...part("Link the export", "p2"), dependsOn: [0] },
					],
				},
			}),
			task({
				taskId: "p1",
				factoryNumber: 41,
				title: "Add CSV export",
				status: "in_progress",
				factoryParentTaskId: "parent",
			}),
			task({
				taskId: "p2",
				factoryNumber: 42,
				title: "Link the export",
				status: "pending_approval",
				factoryQueued: "design",
				factoryQueuedAt: "2026-01-01T00:00:02Z",
				factoryParentTaskId: "parent",
				factoryBlockedBy: { taskIds: ["p1"], met: {} },
			}),
		];
		withLimits(async () => ({ supported: true, concurrency: 1 }));
		await render();
		const working = container.querySelector('[data-factory-list="working"]');
		const parent = working?.querySelector('[data-factory-card="parent"]');
		expect(parent?.getAttribute("data-factory-row")).toBe("working");
		expect(parent?.textContent).toContain("0 of 2 parts delivered");
		// The parent runs nothing: one card holds the one slot.
		expect(
			container.querySelector('[data-factory-group="working"] h2')
				?.parentElement?.textContent,
		).toBe("Working1of 1· 1 queued");
		const waiting = working?.querySelector('[data-factory-card="p2"]');
		expect(waiting?.getAttribute("data-factory-row")).toBe("waiting");
		expect(waiting?.textContent).toContain("Waiting for F41 to merge");
		expect(waiting?.textContent).not.toContain("Waiting for a free slot");
		await act(async () =>
			(
				waiting?.querySelector('[data-factory-parent="parent"]') as HTMLElement
			).click(),
		);
		expect(sessionStorage.getItem("factory.selectedTask")).toBe("parent");
	});

	it("shows one waiting line when queued work is held back by the limit", async () => {
		const base = task();
		const handsOff = base.factory && {
			...base.factory,
			autonomy: "hands_off" as const,
			approval: "automatic" as const,
		};
		const scoping = factoryDesignProgressSchema.parse({
			revision: 3,
			repairRound: 0,
			agents: {},
			designerSessionId: "designer",
			findings: [],
			phase: "designing",
		});
		const card = (taskId: string, overrides: Partial<AgendaTaskRecord>) =>
			task({
				taskId,
				title: `Card ${taskId}`,
				status: "pending_approval",
				factory: handsOff,
				...overrides,
			});
		mocks.tasks = [
			card("a", { factoryDesignProgress: scoping }),
			card("b", { factoryDesignProgress: scoping }),
			card("c", { factoryQueued: "design" }),
			card("d", { factoryQueued: "design" }),
			card("e", { factoryQueued: "design" }),
			// Held work waits for the user, not for a slot.
			card("f", { factory: handsOff && { ...handsOff, hold: true } }),
		];
		let concurrency = 2;
		withLimits(async () => ({ supported: true, concurrency }));
		await render();
		// The Working heading carries the limit and how many wait.
		const heading = (group: string) =>
			container.querySelector(`[data-factory-group="${group}"] h2`)
				?.parentElement?.textContent;
		expect(heading("working")).toBe("Working2of 2· 4 queued");
		const divider = container.querySelector("[data-factory-section]");
		expect(divider?.textContent).toBe("Queue4");
		// A section label, not a control.
		expect(divider?.querySelector("button")).toBeNull();
		expect(divider?.className).toContain("uppercase");
		// Every slot in use: still a link, with a warning icon.
		expect(button("of 2").querySelector("svg")).not.toBeNull();
		const rows = (label: string) =>
			Array.from(
				container.querySelectorAll(
					'[data-factory-list="working"] li[data-factory-row="waiting"]',
				),
			).filter((item) => item.textContent?.includes(label));
		expect(rows("Waiting for a free slot")).toHaveLength(3);
		expect(rows("On hold")).toHaveLength(1);

		// The limit opens in place, without leaving the home.
		await act(async () => button("of 2").click());
		expect(limitSelect().value).toBe("2");
		expect(sessionStorage.getItem("factory.destination")).toBe("activity");
		await choose("3");
		expect(mocks.invoke).toHaveBeenCalledWith("factory_set_limits", {
			concurrency: 3,
		});
		concurrency = 3;

		// With free slots, nothing waits on the limit.
		await act(async () => root.unmount());
		root = createRoot(container);
		concurrency = 4;
		await render();
		expect(heading("working")).toBe("Working2of 4· 4 queued");
		expect(button("of 4").querySelector("svg")).toBeNull();
		expect(rows("Waiting for a free slot")).toHaveLength(0);
		expect(rows("Waiting to start")).toHaveLength(3);
		// Running cards first, then the divider, then the queue; each once.
		const items = Array.from(
			container.querySelectorAll<HTMLElement>(
				'[data-factory-list="working"] > li',
			),
		);
		const dividerAt = items.findIndex((item) =>
			item.hasAttribute("data-factory-section"),
		);
		expect(
			items.slice(0, dividerAt).map((item) => item.dataset.factoryRow),
		).toEqual(["working", "working"]);
		expect(
			items.slice(dividerAt + 1).map((item) => item.dataset.factoryRow),
		).toEqual(["waiting", "waiting", "waiting", "waiting"]);
		for (const id of ["a", "b", "c", "d", "e", "f"]) expect(listed(id)).toBe(1);

		// A limit lowered below what runs: the name stays, "of 1" stays a
		// link with an amber warning icon and says why.
		await act(async () => root.unmount());
		root = createRoot(container);
		concurrency = 1;
		await render();
		expect(heading("working")).toBe("Working2of 1· 4 queued");
		const limit = container.querySelector("[data-factory-working-limit]");
		expect(limit?.getAttribute("data-factory-working-limit")).toBe("over");
		expect(limit?.getAttribute("title")).toContain("limit of 1");
		expect(limit?.className).toContain("text-accent-foreground");
		expect(limit?.className).not.toContain("text-warning-text");
		expect(limit?.querySelector("svg")?.getAttribute("class")).toContain(
			"text-warning-text",
		);
		expect(
			container.querySelector(
				'[data-factory-group="working"] [data-factory-column-title]',
			)?.className,
		).toContain("shrink-0");
	});
});

describe("Activity master-detail and short ids", () => {
	const render = (props: { requestedTaskId?: string } = {}) =>
		act(async () =>
			root.render(
				<FactoryView
					drafts={drafts}
					onOpenSession={vi.fn(async () => {})}
					{...props}
				/>,
			),
		);
	const rail = () => container.querySelector("nav[data-factory-rail]");
	const cardColumn = () =>
		container.querySelector('[data-factory-layout="master-detail"]')
			?.lastElementChild?.textContent ?? "";
	beforeEach(() => sessionStorage.removeItem("factory.destination"));

	it("keeps the list as a rail beside the card at wide container widths and swaps the card from it", async () => {
		mocks.tasks = [
			task({ status: "failed", factoryNumber: 42 }),
			task({
				taskId: "other",
				title: "Other work",
				status: "failed",
				factoryNumber: 7,
			}),
		];
		await render();
		await act(async () => row("Needs you", "feature-1").click());
		// A container query on the Factory view, not the viewport, lays it out:
		// a 72px id rail from 960px, the 16rem rail with titles from 1120px.
		const view = container.querySelector('[data-testid="factory-view"]');
		expect(view?.className).toContain("@container/factory");
		const layout = container.querySelector(
			'[data-factory-layout="master-detail"]',
		);
		expect(layout?.className).toContain(
			"@min-[960px]/factory:grid-cols-[4.5rem_minmax(0,1fr)]",
		);
		expect(layout?.className).toContain(
			"@min-[1120px]/factory:grid-cols-[16rem_minmax(0,1fr)]",
		);
		const list = rail();
		expect(list?.className.split(" ")).toContain("hidden");
		expect(list?.className).toContain("@min-[960px]/factory:flex");
		// A block viewport keeps rows to the rail's width, so titles truncate.
		expect(
			list?.querySelector('[data-slot="scroll-area-viewport"]')?.className,
		).toContain(PAGE_FRAME_FIT_VIEWPORT);
		// The card gets the full remaining width.
		expect(container.querySelector(".max-w-5xl")).toBeNull();
		expect(cardColumn()).toContain("Export activity");
		const current = list?.querySelector('[data-factory-task="feature-1"]');
		expect(current?.getAttribute("aria-current")).toBe("true");
		expect(current?.getAttribute("aria-label")).toBe(
			"F42 Export activity, Stopped",
		);
		const other = list?.querySelector('[data-factory-task="other"]');
		if (!(other instanceof HTMLButtonElement))
			throw new Error("Missing rail row");
		other.focus();
		await act(async () => other.click());
		// The same rail stays; only the card changes.
		expect(rail()).toBe(list);
		expect(document.activeElement).toBe(other);
		expect(other.getAttribute("aria-current")).toBe("true");
		expect(current?.getAttribute("aria-current")).toBeNull();
		// Selected differs from hovered in fill, weight and the accent bar,
		// drawn on the whole row so its live line is inside them.
		const classes = (item: Element | null | undefined) =>
			item?.closest("li")?.className.split(" ") ?? [];
		expect(classes(other)).toEqual(
			expect.arrayContaining([
				"bg-surface-hover",
				"font-medium",
				"before:bg-primary",
			]),
		);
		expect(classes(current)).toContain(
			"has-[>button:hover]:bg-surface-hover-lighter",
		);
		expect(classes(current)).not.toContain("bg-surface-hover");
		expect(classes(current)).not.toContain("before:bg-primary");
		expect(sessionStorage.getItem("factory.selectedTask")).toBe("other");
		expect(cardColumn()).toContain("Other work");
		expect(cardColumn()).not.toContain("Export activity");
		// The rail's header keeps Factory (the home) and Ask Factory only;
		// Settings is on the home.
		expect(
			list?.querySelector(`button[aria-label="Factory settings"]`),
		).toBeNull();
		await act(async () => labelled("Show all Activity").click());
		expect(rail()).toBeNull();
		expect(sessionStorage.getItem("factory.selectedTask")).toBeNull();
		expect(labelled("Factory settings")).toBeTruthy();
	});

	it("opens Ask Factory from the rail header and reports the card on screen", async () => {
		mocks.tasks = [task({ status: "failed", factoryNumber: 42 })];
		const onAskFactory = vi.fn();
		const onSelectedTaskChange = vi.fn();
		await act(async () =>
			root.render(
				<FactoryView
					drafts={drafts}
					onAskFactory={onAskFactory}
					askFactoryOpen
					onSelectedTaskChange={onSelectedTaskChange}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
		expect(onSelectedTaskChange).toHaveBeenLastCalledWith(null);
		// Open, the header toggle is pressed rather than filled.
		const header = button("Ask Factory");
		expect(header.getAttribute("aria-pressed")).toBe("true");
		expect(header.className.split(" ")).not.toContain("bg-primary");
		expect(header.className.split(" ")).toContain("bg-surface-hover");
		await act(async () => row("Needs you", "feature-1").click());
		expect(onSelectedTaskChange).toHaveBeenLastCalledWith({
			taskId: "feature-1",
			shortId: "F42",
		});
		const ask = rail()?.querySelector('button[aria-label="Ask Factory"]');
		if (!(ask instanceof HTMLButtonElement))
			throw new Error("Missing rail Ask Factory");
		expect(ask.getAttribute("aria-expanded")).toBe("true");
		await act(async () => ask.click());
		expect(onAskFactory).toHaveBeenCalledOnce();
		const back = [...container.querySelectorAll("button")].find((candidate) =>
			/back to factory/i.test(candidate.textContent ?? ""),
		);
		await act(async () => back?.click());
		expect(onSelectedTaskChange).toHaveBeenLastCalledWith(null);
	});

	it("keeps list then card navigation with Back below the wide layout", async () => {
		mocks.tasks = [task({ status: "failed", factoryNumber: 42 })];
		await render();
		await act(async () => row("Needs you", "feature-1").click());
		// Only the hidden rail repeats the list; the Activity page is gone.
		expect(container.querySelector("h1")?.textContent).not.toBe("Factory");
		expect(
			container.querySelectorAll('[data-factory-task="feature-1"]'),
		).toHaveLength(1);
		expect(
			rail()?.contains(container.querySelector("[data-factory-task]")),
		).toBe(true);
		await act(async () => button("Back to Factory").click());
		expect(rail()).toBeNull();
		expect(sessionStorage.getItem("factory.selectedTask")).toBeNull();
		expect(document.activeElement).toBe(row("Needs you", "feature-1"));
	});

	it("opens Activity when asked from outside instead of a remembered card", async () => {
		mocks.tasks = [task({ status: "failed" })];
		sessionStorage.setItem("factory.selectedTask", "feature-1");
		sessionStorage.setItem("factory.destination", "history");
		const opened = vi.fn();
		await act(async () =>
			root.render(
				<FactoryView
					drafts={drafts}
					onOpenSession={vi.fn(async () => {})}
					requestedTaskId={FACTORY_ACTIVITY_REQUEST}
					onRequestedTaskOpened={opened}
				/>,
			),
		);
		expect(opened).toHaveBeenCalled();
		expect(rail()).toBeNull();
		expect(sessionStorage.getItem("factory.selectedTask")).toBeNull();
		expect(sessionStorage.getItem("factory.destination")).toBe("activity");
		expect(row("Needs you", "feature-1")).toBeTruthy();
	});

	it("shows a card's short id before its title on Activity, board and History rows", async () => {
		mocks.tasks = [
			task({ status: "failed", factoryNumber: 42 }),
			task({
				taskId: "done",
				title: "Delivered work",
				status: "completed",
				factoryNumber: 9,
			}),
			task({ taskId: "plain", title: "Unnumbered work", status: "failed" }),
		];
		await render();
		const failed = homeRow("feature-1");
		const idChip = failed.querySelector("[data-factory-id]");
		expect(idChip?.textContent).toBe("F42");
		expect(idChip?.className).toContain("font-mono");
		// The id is a quiet handle above the title; both start the card's name.
		expect(failed.querySelector("[data-factory-id]")?.textContent).toBe("F42");
		expect(failed.querySelector("p")?.textContent).toBe("Export activity");
		expect(row("Needs you", "feature-1").getAttribute("aria-label")).toBe(
			"F42 Export activity, Stopped at Scope",
		);
		expect(homeRow("plain").querySelector("[data-factory-id]")).toBeNull();
		expect(row("Needs you", "plain").getAttribute("aria-label")).toBe(
			"Unnumbered work, Stopped at Scope",
		);
		// And History.
		sessionStorage.setItem("factory.destination", "history");
		await act(async () => root.unmount());
		root = createRoot(container);
		await render();
		const history = container.querySelector('table [data-factory-task="done"]');
		expect(history?.textContent).toBe("F9 Delivered work");
	});
});

describe("Factory home fits the width it has", () => {
	beforeEach(() => sessionStorage.removeItem("factory.destination"));
	const render = () =>
		act(async () =>
			root.render(
				<FactoryView
					drafts={drafts}
					onAskFactory={vi.fn()}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
	/** Attention for the given cards, bypassing the sidecar. */
	const withAttention = (items: unknown[], extra?: Record<string, unknown>) =>
		mocks.invoke.mockImplementation(async (command) =>
			command === "factory_attention"
				? items
				: command === "get_desktop_settings"
					? {}
					: command in (extra ?? {})
						? extra?.[command]
						: [],
		);

	it("leaves the scrolling page for a fixed-height board whose columns scroll", async () => {
		mocks.tasks = [
			task({ status: "failed", factoryNumber: 25, approvedRevision: 3 }),
		];
		await render();
		const view = container.querySelector('[data-testid="factory-view"]');
		expect(view?.className).toContain("flex-1");
		expect(view?.className).toContain("min-h-0");
		// No PageFrame (a scrolling page) on the home; one 48px header row.
		expect(container.querySelector("[data-page-frame-fit]")).toBeNull();
		expect(container.querySelector("header")?.className).toContain("h-12");
		expect(container.querySelector("h1")?.textContent).toBe("Factory");
		// The board scrolls sideways with snap; columns keep a minimum width
		// and scroll their own cards.
		const board = container.querySelector("[data-factory-home]");
		for (const name of ["overflow-x-auto", "overflow-y-hidden", "snap-x"])
			expect(board?.className.split(" ")).toContain(name);
		const column = container.querySelector('[data-factory-group="needsYou"]');
		expect(column?.className).toContain("min-w-[220px]");
		// No maximum: columns share the whole width, so a wide window has no dead space.
		expect(column?.className).not.toContain("max-w-");
		expect(
			column?.querySelector("[data-factory-list]")?.className.split(" "),
		).toContain("overflow-y-auto");
		// No viewport breakpoints are left on the home.
		expect(container.innerHTML).not.toMatch(/\b(sm|md|lg|xl):[a-z]/);
		// The card: id, stage; title; the reason and its age.
		const failed = homeRow("feature-1");
		expect(failed.querySelector("[data-factory-id]")?.textContent).toBe("F25");
		expect(failed.querySelector("[data-factory-stages]")?.textContent).toBe(
			"Build",
		);
		expect(failed.querySelector("p")?.className).toContain("line-clamp-4");
		expect(failed.querySelector("[data-factory-detail]")?.textContent).toMatch(
			/^Stopped at Build\d+d$/,
		);
		// One repository: it is not repeated on every card.
		expect(failed.querySelector("[data-factory-project]")).toBeNull();
	});

	it("names the repository on cards only when they span more than one", async () => {
		mocks.tasks = [
			task({ taskId: "a", title: "Card A", workspaceRoot: "/code/acme-app" }),
			task({ taskId: "b", title: "Card B", workspaceRoot: "/code/acme-api" }),
		];
		await render();
		expect(
			homeRow("a").querySelector("[data-factory-project]")?.textContent,
		).toContain("acme-app");
		expect(
			homeRow("b").querySelector("[data-factory-project]")?.textContent,
		).toContain("acme-api");
	});

	it("keeps one header control per action, labelled wherever it fits", async () => {
		mocks.tasks = [task({ status: "failed" })];
		await render();
		const settings = labelled("Factory settings");
		expect(settings.hasAttribute("data-factory-settings")).toBe(true);
		expect(settings.textContent).toBe("Settings");
		for (const name of ["Factory settings", "Pause new work", "Display"])
			expect(
				container.querySelectorAll(`button[aria-label="${name}"]`),
			).toHaveLength(1);
		expect(container.querySelectorAll("button[data-ask-factory]")).toHaveLength(
			1,
		);
		// Narrower, Pause and Settings keep their names but show icons only.
		mocks.boardWidth = 840;
		await render();
		expect(labelled("Factory settings").textContent).toBe("");
		expect(labelled("Factory settings").title).toBe("Factory settings");
		expect(labelled("Pause new work").textContent).toBe("");
		// Below 552px the spend leaves the header.
		mocks.boardWidth = 500;
		await render();
		expect(container.querySelector("[data-factory-spend]")).toBeNull();
	});

	it("collapses the outer columns to strips as the board narrows, never Needs you", async () => {
		mocks.tasks = [
			task({ taskId: "queued", title: "Queued card" }),
			task({ taskId: "failed", title: "Failed card", status: "failed" }),
			task({
				taskId: "done",
				title: "Delivered card",
				status: "completed",
				lastRunId: "run-done",
			}),
		];
		await render();
		const strips = () =>
			Array.from(
				container.querySelectorAll<HTMLElement>("[data-factory-strip]"),
			).map((item) => item.dataset.factoryGroup);
		expect(strips()).toEqual([]);
		// 840px (a 1100px window): the three columns all fit.
		mocks.boardWidth = 840;
		await render();
		expect(strips()).toEqual([]);
		expect(listed("queued")).toBe(1);
		// 650px (a 1280px window beside Ask Factory): Delivered is a strip
		// with its count; Working and Needs you stay open.
		mocks.boardWidth = 650;
		await render();
		expect(strips()).toEqual(["delivered"]);
		const delivered = container.querySelector<HTMLButtonElement>(
			'[data-factory-strip][data-factory-group="delivered"]',
		);
		expect(delivered?.getAttribute("aria-expanded")).toBe("false");
		expect(delivered?.getAttribute("aria-label")).toBe(
			"Show Delivered, 1 card",
		);
		expect(listed("done")).toBe(0);
		expect(groups()).toEqual(["working", "needsYou", "delivered"]);
		// Expanding the strip keeps the other columns; it gets a collapse chevron.
		await act(async () => delivered?.click());
		expect(strips()).toEqual([]);
		expect(listed("done")).toBe(1);
		expect(labelled("Collapse Delivered")).toBeTruthy();
		// Needs you has no collapse control at any width.
		expect(
			container.querySelector('button[aria-label="Collapse Needs you"]'),
		).toBeNull();
		// The person's choice holds at this width and is saved…
		await render();
		expect(strips()).toEqual([]);
		expect(
			JSON.parse(localStorage.getItem("cline.code.factory-board-view.v1") ?? "")
				.collapsedTier,
		).toBe("narrow");
		// …until the width changes tier.
		mocks.boardWidth = 500;
		await render();
		expect(strips()).toEqual(["delivered"]);
	});

	it("keeps the rail beside a card, with only Factory and Ask Factory in its header", async () => {
		mocks.tasks = [
			task({ status: "failed", factoryNumber: 3 }),
			task({
				taskId: "build",
				title: "Building card with a very long title that has to truncate",
				status: "in_progress",
				currentRunId: "run-build",
			}),
			task({ taskId: "queued", title: "Queued card" }),
		];
		withAttention([
			{ taskId: "feature-1", revision: 3, questions: [], needsAttention: true },
			{
				taskId: "build",
				revision: 3,
				runId: "run-build",
				questions: [],
				needsAttention: false,
				outcome: {
					phase: "implementing",
					repairRound: 0,
					activeRoles: [],
					activeSessions: [],
					followupPaused: false,
				},
			},
		]);
		await render();
		await act(async () => row("Needs you", "feature-1").click());
		const rail = container.querySelector("nav[data-factory-rail]");
		const header = rail?.firstElementChild;
		expect(
			Array.from(header?.querySelectorAll("button") ?? []).map((item) =>
				item.getAttribute("aria-label"),
			),
		).toEqual(["Show all Activity", "Ask Factory"]);
		// The same groups, in the board's order.
		expect(
			Array.from(rail?.querySelectorAll("section[aria-label]") ?? []).map(
				(item) => item.getAttribute("aria-label"),
			),
		).toEqual(["Working", "Queue", "Needs you"]);
		expect(
			rail?.querySelector('[data-factory-task="build"] .truncate')?.textContent,
		).toContain("Building card");
		// "Build", not "Build · Building".
		expect(
			rail?.querySelector('[data-factory-task="build"] .truncate + span')
				?.textContent,
		).toBe("Build");
	});

	it("shows paused work in the narrow rail as an indicator, with Resume beside the card", async () => {
		mocks.tasks = [task({ status: "failed" })];
		withAttention([], {
			factory_get_limits: { supported: true, concurrency: 2, paused: true },
		});
		await render();
		await act(async () => row("Needs you", "feature-1").click());
		const rail = container.querySelector("nav[data-factory-rail]");
		const indicator = rail?.querySelector('[data-factory-paused="indicator"]');
		expect(indicator?.getAttribute("role")).toBe("img");
		expect(indicator?.getAttribute("aria-label")).toBe(
			"New work is paused. Resume it from the banner beside the card.",
		);
		expect(indicator?.querySelector("button")).toBeNull();
		expect(indicator?.className).toContain("@min-[1120px]/factory:hidden");
		// Beside a card there is no header toggle, so the banner offers Resume.
		const cardBanner = container.querySelector(
			'[data-factory-layout="master-detail"] > :last-child [data-factory-paused="banner"]',
		);
		expect(cardBanner?.textContent).toContain("Resume");
		expect(cardBanner?.parentElement?.className).toContain(
			"@min-[1120px]/factory:hidden",
		);
	});

	it("shows a card that could not be read as one row and every other card normally", async () => {
		mocks.tasks = [
			task({ taskId: "broken", title: "Broken card", factoryNumber: 12 }),
			task({ taskId: "failed", title: "Failed card", status: "failed" }),
		];
		withAttention([
			{
				taskId: "broken",
				questions: [],
				needsAttention: false,
				unreadable: { reason: "acceptanceCriteria: Required" },
			},
			{ taskId: "failed", revision: 3, questions: [], needsAttention: true },
		]);
		await render();
		expect(container.querySelector('[role="alert"]')).toBeNull();
		const broken = onLine("broken");
		expect(broken.group).toBe("needsYou");
		expect(broken.text).toContain("F12");
		expect(broken.text).toContain("This card could not be read");
		expect(broken.text).toContain("Broken card");
		// The raw reason stays off the board, under the card's Details.
		expect(broken.text).not.toContain("acceptanceCriteria");
		expect(row("Needs you", "failed")).toBeTruthy();
		expect(container.textContent).not.toContain("Status not loaded yet");
	});

	it("never shows raw validation output when Factory's reply cannot be read", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		mocks.tasks = [task()];
		const raw = JSON.stringify(
			[{ code: "invalid_type", path: ["tasks", 0], message: "Required" }],
			null,
			2,
		);
		mocks.invoke.mockImplementation(async (command) => {
			if (command === "factory_attention") throw new Error(raw);
			return command === "get_desktop_settings" ? {} : [];
		});
		await render();
		const alert = container.querySelector('[role="alert"]');
		expect(alert?.textContent).toContain(
			"Factory sent status the app could not read.",
		);
		expect(alert?.textContent).not.toContain("invalid_type");
		expect(alert?.textContent).not.toContain("Can't reach Factory");
		expect(warn).toHaveBeenCalledWith("Factory status could not be read", raw);
		warn.mockRestore();
	});
});

describe("Factory board display", () => {
	beforeEach(() => sessionStorage.removeItem("factory.destination"));
	const render = () =>
		act(async () =>
			root.render(
				<FactoryView drafts={drafts} onOpenSession={vi.fn(async () => {})} />,
			),
		);
	const cards = () => [
		task({ taskId: "queued", title: "Queued card", workspaceRoot: "/c/app" }),
		task({
			taskId: "failed",
			title: "Failed card",
			status: "failed",
			workspaceRoot: "/c/api",
		}),
		task({
			taskId: "running",
			title: "Running card",
			status: "in_progress",
			currentRunId: "run-running",
			workspaceRoot: "/c/app",
		}),
		task({
			taskId: "done",
			title: "Delivered card",
			status: "completed",
			lastRunId: "run-done",
			workspaceRoot: "/c/api",
		}),
	];
	const ids = ["queued", "failed", "running", "done"];
	/** Opens the Display menu; Radix opens on pointerdown. */
	async function openDisplay() {
		const trigger = labelled("Display");
		await act(async () => {
			trigger.dispatchEvent(
				new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
			);
			await Promise.resolve();
		});
	}
	function menuItem(text: string): HTMLElement {
		const found = Array.from(
			document.querySelectorAll<HTMLElement>('[role^="menuitem"]'),
		).find((item) => item.textContent?.trim() === text);
		if (!found) throw new Error(`Missing menu item ${text}`);
		return found;
	}
	async function choose(text: string) {
		await act(async () => menuItem(text).click());
	}
	const saved = () =>
		JSON.parse(localStorage.getItem("cline.code.factory-board-view.v1") ?? "");

	it("groups by Status, Stage or Project, each card once in every grouping", async () => {
		mocks.tasks = cards();
		await render();
		expect(groups()).toEqual(["working", "needsYou", "delivered"]);
		await openDisplay();
		expect(menuItem("Status").getAttribute("aria-checked")).toBe("true");
		await choose("Stage");
		expect(groups()).toEqual([
			"waiting",
			"scope",
			"build",
			"verify",
			"review",
			"delivered",
		]);
		for (const id of ids) expect(listed(id)).toBe(1);
		// A stopped card stays at its stage, flagged in place; the column names
		// the stage, so no card repeats it in a stepper.
		const failed = homeRow("failed");
		expect(
			failed.closest<HTMLElement>("[data-factory-group]")?.dataset.factoryGroup,
		).toBe("scope");
		expect(failed.className).toContain("destructive");
		expect(
			container.querySelector("[data-factory-home] [data-factory-stages]"),
		).toBeNull();
		expect(saved()).toMatchObject({ version: 1, grouping: "stage" });
		await openDisplay();
		await choose("Project");
		expect(groups()).toEqual(["project:api", "project:app"]);
		for (const id of ids) expect(listed(id)).toBe(1);
		// What needs you leads each project column; the project is the column.
		expect(
			container
				.querySelector('[data-factory-group="project:api"] [data-factory-task]')
				?.getAttribute("data-factory-task"),
		).toBe("failed");
		expect(container.querySelector("[data-factory-project]")).toBeNull();
		// All history moves to the menu when no Delivered column carries it.
		await openDisplay();
		expect(menuItem("All history")).toBeTruthy();
	});

	it("hides, reorders and resets columns; Needs you always shows", async () => {
		mocks.tasks = cards();
		await render();
		await openDisplay();
		// The always-on column says why it cannot be turned off.
		const pinned = "Needs youAlways shown, so nothing that needs you is hidden";
		expect(menuItem(pinned).getAttribute("aria-disabled")).toBe("true");
		await choose("Delivered");
		expect(groups()).toEqual(["working", "needsYou"]);
		await choose("Delivered");
		await choose(pinned);
		expect(groups()).toContain("needsYou");
		// Move Delivered left of Needs you, from the Reorder submenu.
		const sub = menuItem("Reorder columns");
		await act(async () => {
			sub.focus();
			sub.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
			);
		});
		await choose("Move Delivered left");
		expect(groups()).toEqual(["working", "delivered", "needsYou"]);
		// Kept across a remount.
		await act(async () => root.unmount());
		root = createRoot(container);
		await render();
		expect(groups()).toEqual(["working", "delivered", "needsYou"]);
		// The queue as its own column, first, for a four-column board.
		await openDisplay();
		await choose("Queue as its own column");
		expect(groups()).toEqual(["waiting", "working", "delivered", "needsYou"]);
		expect(
			container.querySelector(
				'[data-factory-group="waiting"] [data-factory-column-title]',
			)?.textContent,
		).toBe("Queue");
		expect(listed("queued")).toBe(1);
		expect(saved()).toMatchObject({ queueColumn: true });
		await choose("Reset to default");
		expect(groups()).toEqual(["working", "needsYou", "delivered"]);
	});

	it("falls back to the default view when the saved one cannot be read", async () => {
		mocks.tasks = cards();
		for (const value of [
			"{not json",
			JSON.stringify({ version: 2, grouping: "stage", columns: [] }),
			JSON.stringify({ version: 1, grouping: "colour", columns: [] }),
			JSON.stringify({
				version: 1,
				grouping: "stage",
				columns: [{ id: "x", hidden: "yes" }],
			}),
		]) {
			localStorage.setItem("cline.code.factory-board-view.v1", value);
			await act(async () => root.unmount());
			root = createRoot(container);
			await render();
			expect(groups()).toEqual(["working", "needsYou", "delivered"]);
		}
		// Needs you cannot be hidden, even by a saved view.
		localStorage.setItem(
			"cline.code.factory-board-view.v1",
			JSON.stringify({
				version: 1,
				grouping: "status",
				columns: [
					{
						id: "needsYou",
						title: "Needs you",
						match: { kind: "status", values: ["needsYou"] },
						hidden: true,
					},
				],
			}),
		);
		await act(async () => root.unmount());
		root = createRoot(container);
		await render();
		expect(groups()).toContain("needsYou");
		expect(listed("failed")).toBe(1);
	});
});

describe("Factory card priority", () => {
	const render = () =>
		act(async () =>
			root.render(
				<FactoryView drafts={drafts} onOpenSession={vi.fn(async () => {})} />,
			),
		);
	beforeEach(() => sessionStorage.removeItem("factory.destination"));
	const priority = (
		level: NonNullable<AgendaTaskRecord["factoryPriority"]>["level"],
		by: NonNullable<AgendaTaskRecord["factoryPriority"]>["by"] = "person",
		reason?: string,
	): AgendaTaskRecord["factoryPriority"] => ({
		level,
		by,
		at: "2026-01-02T00:00:00Z",
		...(reason ? { reason } : {}),
	});
	/** A stopped card (urgency 0) or a plan to approve (urgency 2). */
	const stopped = (taskId: string, overrides: Partial<AgendaTaskRecord> = {}) =>
		task({
			taskId,
			title: `Card ${taskId}`,
			status: "failed",
			approvedRevision: 3,
			...overrides,
		});
	const plan = (taskId: string, overrides: Partial<AgendaTaskRecord> = {}) =>
		task({
			taskId,
			title: `Card ${taskId}`,
			status: "pending_approval",
			...overrides,
		});
	const order = (list: string) =>
		Array.from(
			container.querySelectorAll<HTMLElement>(
				`[data-factory-list="${list}"] li[data-factory-card]`,
			),
		).map((item) => item.dataset.factoryCard);

	it("orders Needs you as the agenda lists it when no card has a priority", async () => {
		// Within an urgency, the agenda's order (sortAgendaTasks): status,
		// then when available, then the oldest; whatever order cards arrive in.
		const at = (day: number) => `2026-01-0${day}T00:00:00Z`;
		mocks.tasks = [
			plan("plan-new", { createdAt: at(5), availableAt: at(5) }),
			plan("plan-old", { createdAt: at(1), availableAt: at(1) }),
			stopped("stop-new", { createdAt: at(4), availableAt: at(4) }),
			stopped("stop-old", { createdAt: at(2), availableAt: at(2) }),
		];
		await render();
		expect(order("needsYou")).toEqual([
			"stop-old",
			"stop-new",
			"plan-old",
			"plan-new",
		]);
		expect(container.querySelector("[data-factory-priority]")).toBeNull();
	});

	it("orders Needs you by priority, then urgency, with no priority as Medium", async () => {
		mocks.tasks = [
			plan("plan-high", { factoryPriority: priority("high") }),
			stopped("stop-none"),
			plan("plan-low", { factoryPriority: priority("low") }),
			stopped("stop-low", { factoryPriority: priority("low") }),
			plan("plan-medium", { factoryPriority: priority("medium", "agent") }),
			plan("plan-urgent", { factoryPriority: priority("urgent") }),
		];
		await render();
		expect(order("needsYou")).toEqual([
			"plan-urgent",
			"plan-high",
			"stop-none",
			"plan-medium",
			"stop-low",
			"plan-low",
		]);
		// The rail beside an open card lists the same order.
		await act(async () => row("Needs you", "stop-none").click());
		expect(
			Array.from(
				container.querySelectorAll<HTMLElement>(
					"nav[data-factory-rail] [data-factory-task]",
				),
			).map((item) => item.dataset.factoryTask),
		).toEqual([
			"plan-urgent",
			"plan-high",
			"stop-none",
			"plan-medium",
			"stop-low",
			"plan-low",
		]);
		// Its rows show the priority too; a row without one keeps the slot.
		const railRow = (id: string) =>
			container.querySelector<HTMLElement>(
				`nav[data-factory-rail] [data-factory-task="${id}"]`,
			);
		expect(
			railRow("plan-urgent")
				?.querySelector("[data-factory-priority]")
				?.getAttribute("aria-label"),
		).toBe("Urgent priority");
		expect(
			railRow("stop-none")?.querySelector("[data-factory-priority]"),
		).toBeNull();
	});

	it("lists the queue in the engine's order: priority, then when queued", async () => {
		const queued = (
			taskId: string,
			at: string | undefined,
			level?: Parameters<typeof priority>[0],
		) =>
			task({
				taskId,
				title: `Card ${taskId}`,
				status: "approved",
				factoryQueued: at ? "run" : undefined,
				factoryQueuedAt: at,
				...(level ? { factoryPriority: priority(level) } : {}),
			});
		mocks.tasks = [
			queued("held", undefined),
			queued("late-urgent", "2026-01-03T00:00:00Z", "urgent"),
			queued("second", "2026-01-02T00:00:00Z"),
			queued("first", "2026-01-01T00:00:00Z"),
			queued("low", "2026-01-01T00:00:00Z", "low"),
		];
		await render();
		expect(order("working")).toEqual([
			"late-urgent",
			"first",
			"second",
			"held",
			"low",
		]);
	});

	it("shows the priority before the id, with no control on the card", async () => {
		mocks.tasks = [
			stopped("urgent", {
				factoryNumber: 1,
				factoryPriority: priority("urgent"),
			}),
			stopped("high", {
				factoryNumber: 2,
				factoryPriority: priority("high", "agent"),
			}),
			stopped("medium", {
				factoryNumber: 3,
				factoryPriority: priority("medium", "scoper", "Affects every export"),
			}),
			stopped("low", { factoryNumber: 4, factoryPriority: priority("low") }),
			stopped("none", { factoryNumber: 5 }),
		];
		await render();
		const top = (id: string) =>
			homeRow(id).querySelector<HTMLElement>("[data-factory-card-top]");
		const glyph = (id: string) =>
			top(id)?.querySelector<HTMLElement>("[data-factory-priority]");
		const filled = (id: string) =>
			Array.from(glyph(id)?.querySelectorAll("rect") ?? []).filter(
				(bar) => bar.getAttribute("fill-opacity") === "1",
			).length;
		expect(glyph("urgent")?.getAttribute("aria-label")).toBe("Urgent priority");
		expect(glyph("urgent")?.querySelector("circle")).not.toBeNull();
		expect(glyph("high")?.getAttribute("aria-label")).toBe("High priority");
		expect(filled("high")).toBe(3);
		expect(filled("medium")).toBe(2);
		expect(filled("low")).toBe(1);
		// None shows nothing and keeps no space: the id leads the row.
		expect(glyph("none")).toBeNull();
		expect(
			top("none")?.firstElementChild?.hasAttribute("data-factory-id"),
		).toBe(true);
		// The icon leads the row, before the id.
		expect(
			top("high")?.firstElementChild?.querySelector("[data-factory-priority]"),
		).toBe(glyph("high"));
		// Display only: no menu or control on any card.
		for (const id of ["urgent", "high", "medium", "low", "none"]) {
			expect(homeRow(id).querySelector("[aria-haspopup]")).toBeNull();
			expect(
				homeRow(id).querySelector("[data-factory-priority-control]"),
			).toBeNull();
		}
		// Its tooltip says who set it.
		if (!("ResizeObserver" in globalThis))
			Object.assign(globalThis, {
				ResizeObserver: class {
					observe() {}
					unobserve() {}
					disconnect() {}
				},
			});
		const tooltip = async (id: string) => {
			await act(async () => {
				glyph(id)?.dispatchEvent(
					new MouseEvent("pointermove", { bubbles: true }),
				);
				// The tooltip opens after its (zero) delay, on a timer.
				await new Promise((resolve) => setTimeout(resolve, 0));
			});
			const text = document.querySelector(
				'[data-slot="tooltip-content"]',
			)?.textContent;
			await act(async () => {
				glyph(id)?.dispatchEvent(
					new MouseEvent("pointerleave", { bubbles: true }),
				);
			});
			return text;
		};
		expect(await tooltip("urgent")).toContain("Urgent priority · set by you");
		expect(await tooltip("high")).toContain("High priority · set by an agent");
		expect(await tooltip("medium")).toContain(
			"Medium priority · estimated: Affects every export",
		);
		// Clicking the icon still opens the card.
		await act(async () =>
			(glyph("high")?.parentElement as HTMLElement | null)?.click(),
		);
		expect(sessionStorage.getItem("factory.selectedTask")).toBe("high");
	});
});
