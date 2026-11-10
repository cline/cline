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
import { handleFactoryCommand } from "../../../../sidecar/factory-commands";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FactoryView } from "./factory-view";
import { factoryPresetSchema } from "@/lib/factory-presets";

const mocks = vi.hoisted(() => ({
	tasks: [] as AgendaTaskRecord[],
	refresh: vi.fn(async () => {}),
	toast: vi.fn(),
	createTask: vi.fn(),
	startFactoryQueue: vi.fn(async () => ({ queued: 1 })),
	updateAgendaTask: vi.fn(),
	approveAgendaTask: vi.fn(),
	getFactoryTask: vi.fn(async () => ({ runs: [] as AgendaTaskRunRecord[] })),
	designFactoryTask: vi.fn(async () => ({ sessionId: "design-1" })),
	invoke: vi.fn(
		async (_command: string, _args?: unknown): Promise<unknown> => [],
	),
	subscribe: vi.fn(() => () => {}),
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
			publishPullRequest: false,
		},
		...overrides,
	};
}
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	vi.clearAllMocks();
	mocks.invoke.mockImplementation(async (command) =>
		command === "get_desktop_settings" ? {} : [],
	);
	mocks.createTask.mockImplementation(async (input: HubTaskCreateInput) => {
		const created = task({ taskId: input.taskId, status: "pending_approval" });
		mocks.tasks = [...mocks.tasks, created];
		return created;
	});
	mocks.tasks = [];
	if (typeof window.localStorage.clear !== "function") {
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			value: window.sessionStorage,
		});
	}
	window.localStorage.clear();
	sessionStorage.clear();
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
	it("selects the saved default, displays its participants, and copies it into queued work", async () => {
		const preset = factoryPresetSchema.parse({
			name: "Focused",
			config: {
				approval: "automatic",
				maxRepairRounds: 1,
				agents: {
					designer: {
						modelSelection: { providerId: "test", modelId: "draft-model" },
					},
					planReviewers: [],
					implementers: [
						{ instructions: "Build the API" },
						{ profile: "ui-agent" },
					],
					reviewers: [{}],
					verifier: { instructions: "Exercise the feature" },
				},
			},
		});
		mocks.invoke.mockImplementation(async (command) =>
			command === "get_desktop_settings"
				? { factoryPresets: [preset], factoryDefaultPreset: preset.name }
				: [],
		);
		await act(async () =>
			root.render(
				<FactoryView
					workspacePaths={["/repo"]}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
		await act(async () => button("Add work").click());
		const workflow = document.querySelector("#feature-workflow");
		if (!(workflow instanceof HTMLSelectElement))
			throw new Error("Missing workflow picker");
		expect(workflow.value).toBe("Focused");
		expect(document.body.textContent).toContain("test / draft-model");
		expect(document.body.textContent).toContain("Profile: ui-agent");
		await act(async () => {
			changeInput("#feature-name", "Export data");
			changeInput("#feature-request", "Export CSV data.");
			const start = document.querySelector('input[type="checkbox"]');
			if (!(start instanceof HTMLInputElement))
				throw new Error("Missing scoping choice");
			start.click();
		});
		await act(async () => button("Add to queue").click());
		const input: HubTaskCreateInput = mocks.createTask.mock.calls[0][0];
		expect(input.factory).toEqual(expect.objectContaining(preset.config));
		expect(input.factory?.agents).not.toBe(preset.config.agents);
		expect(input.factory?.publishPullRequest).toBe(false);
		expect(input.queueFactoryDesign).toBe(false);
		expect(mocks.designFactoryTask).not.toHaveBeenCalled();
	});

	it("requires an explicit choice when the stored default is missing or was filtered as invalid", async () => {
		mocks.invoke.mockImplementation(async (command) =>
			command === "get_desktop_settings"
				? { factoryDefaultPreset: "Unavailable", factoryPresets: [] }
				: [],
		);
		await act(async () =>
			root.render(
				<FactoryView
					workspacePaths={["/repo"]}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
		await act(async () => button("Add work").click());
		await act(async () => {
			changeInput("#feature-name", "Export data");
			changeInput("#feature-request", "Export CSV data.");
		});
		expect(document.body.textContent).toContain("missing or invalid");
		expect(button("Add and scope").disabled).toBe(true);
		await act(async () => {
			const workflow = document.querySelector("#feature-workflow");
			if (!(workflow instanceof HTMLSelectElement))
				throw new Error("Missing workflow picker");
			workflow.value = "";
			workflow.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect(button("Add and scope").disabled).toBe(false);
	});

	it("blocks creation while workflows load or fail and allows retry", async () => {
		let finish: (value: unknown) => void = () => {
			throw new Error("Load not started");
		};
		mocks.invoke.mockImplementation(async (command) =>
			command === "get_desktop_settings"
				? new Promise((resolve) => {
						finish = resolve;
					})
				: [],
		);
		await act(async () =>
			root.render(
				<FactoryView
					workspacePaths={["/repo"]}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
		await act(async () => button("Add work").click());
		await act(async () => {
			changeInput("#feature-name", "Export data");
			changeInput("#feature-request", "Export CSV data.");
		});
		expect(button("Add and scope").disabled).toBe(true);
		await act(async () => finish({}));
		expect(button("Add and scope").disabled).toBe(false);
		await act(async () => button("Close").click());
		mocks.invoke.mockImplementation(async (command) => {
			if (command === "get_desktop_settings")
				throw new Error("Storage unavailable");
			return [];
		});
		await act(async () => button("Add work").click());
		expect(document.body.textContent).toContain("Storage unavailable");
		expect(button("Add and scope").disabled).toBe(true);
		mocks.invoke.mockImplementation(async (command) =>
			command === "get_desktop_settings" ? {} : [],
		);
		await act(async () => button("Retry workflows").click());
		expect(document.body.textContent).not.toContain("Storage unavailable");
	});

	it("manages implementers and saves the default centrally without creating work", async () => {
		mocks.invoke.mockImplementation(async (command, args) =>
			command === "get_desktop_settings"
				? {}
				: command === "factory_save_preset"
					? [factoryPresetSchema.parse(args)]
					: [],
		);
		await act(async () =>
			root.render(
				<FactoryView
					workspacePaths={[]}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
		await act(async () => button("Workflows").click());
		expect(document.body.textContent).toContain("Factory workflows");
		const removeOnly = document.querySelector(
			'[aria-label="Remove implementer 1"]',
		);
		if (!(removeOnly instanceof HTMLButtonElement))
			throw new Error("Missing implementer removal");
		expect(removeOnly.disabled).toBe(true);
		await act(async () => button("Add implementer").click());
		await act(async () => button("Add implementer").click());
		await act(async () => button("Add implementer").click());
		expect(button("Add implementer").disabled).toBe(true);
		for (const index of [4, 3, 2]) {
			await act(async () => {
				const remove = document.querySelector(
					`[aria-label="Remove implementer ${index}"]`,
				);
				if (!(remove instanceof HTMLButtonElement))
					throw new Error("Missing implementer removal");
				remove.click();
			});
		}
		await act(async () => button("Add implementer").click());
		await act(async () =>
			changeInput(
				'[aria-label="Implementer 2 instructions"]',
				"Build the interface",
			),
		);
		await act(async () => changeInput('[aria-label="Preset name"]', "Focused"));
		const defaultChoice = document.querySelector('input[type="checkbox"]');
		if (!(defaultChoice instanceof HTMLInputElement))
			throw new Error("Missing default choice");
		await act(async () => defaultChoice.click());
		await act(async () => button("Save preset").click());
		expect(mocks.invoke).toHaveBeenCalledWith(
			"factory_save_preset",
			expect.objectContaining({
				name: "Focused",
				useByDefault: true,
				config: expect.objectContaining({
					agents: expect.objectContaining({
						implementers: [{}, { instructions: "Build the interface" }],
					}),
				}),
			}),
		);
		expect(mocks.createTask).not.toHaveBeenCalled();
		expect(
			mocks.invoke.mock.calls.filter(
				([command]) => command === "get_desktop_settings",
			),
		).toHaveLength(1);
		await act(async () => changeInput('[aria-label="Preset name"]', ""));
		expect(button("Save preset").disabled).toBe(true);
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
				<FactoryView
					workspacePaths={[]}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
		expect(container.textContent).not.toContain("Archived feature");
		await act(async () => button("Outcomes").click());
		expect(container.textContent).not.toContain("Archived feature");
		await act(async () => button("Archived (1)").click());
		expect(container.textContent).toContain("Archived feature");
		expect(container.textContent).not.toContain("Active feature");
		expect(container.textContent).not.toContain("Needs you (");
		await act(async () => button("Archived feature").click());
		expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
			"Archived feature",
		);
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
				<FactoryView
					workspacePaths={[]}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
		const column = (name: string) =>
			container.querySelector(`section[aria-label="${name}"]`)?.textContent ??
			"";
		expect(column("Queued")).toContain("Queued feature");
		expect(column("Queued")).toContain("Unknown feature");
		expect(column("Queued")).toContain("Stale feature");
		expect(column("Queued")).toContain("Old revision feature");
		expect(column("Queued")).toContain("Loading outcome…");
		for (const label of [
			"Scoping feature",
			"Scoping",
			"Reviewing plan",
			"Parallel feature",
			"1 verifier · 1 reviewer",
			"Waiting for CI / PR follow-up",
		])
			expect(column("Working")).toContain(label);
		for (const label of [
			"Question feature",
			"Answer a question",
			"Failed feature",
			"Resolve failure",
			"Ready feature",
			"Ready for signoff",
			"Sampled feature",
			"Review sampled finding",
			"Blocked feature",
			"Resolve blocker",
		])
			expect(column("Needs you")).toContain(label);
		expect(column("Done")).toContain("Stamped feature");
		expect(column("Done")).not.toContain("Ready feature");
		expect(column("Done")).not.toContain("Sampled feature");
		expect(container.textContent).not.toContain("Cancelled feature");
		expect(container.textContent).not.toContain("Expired feature");
		expect(container.textContent).toContain("Needs you (5)");
		await act(async () => button("Scoping feature").click());
		expect(button("Preparing plan…").disabled).toBe(true);
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
				<FactoryView
					workspacePaths={[]}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
		await act(async () => button("Export activity").click());
		await act(async () => {
			const summary = Array.from(document.querySelectorAll("summary")).find(
				(item) => item.textContent?.trim() === "Configuration",
			);
			if (!summary) throw new Error("Missing configuration");
			summary.click();
		});
		const select = document.querySelector(
			'[aria-label="Apply workflow preset"]',
		);
		if (!(select instanceof HTMLSelectElement))
			throw new Error("Missing preset picker");
		await act(async () => {
			select.value = "Focused";
			select.dispatchEvent(new Event("change", { bubbles: true }));
		});
		await act(async () =>
			changeInput('[aria-label="Implementer 1 maxIterations"]', "7"),
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
		expect(document.body.textContent).toContain("2 final reviewers");
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
		expect(document.body.textContent).toContain("1 final reviewers");
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
				<FactoryView
					workspacePaths={[]}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
		await act(async () => button("Export activity").click());
		await act(async () => selectTab("Verification"));
		expect(document.body.textContent).toContain(
			"revision 3 (previous execution — not current evidence)",
		);
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
				<FactoryView
					workspacePaths={[]}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
		expect(container.textContent).not.toContain("Ordinary reminder");
		await act(async () => button("Start queue").click());
		expect(mocks.startFactoryQueue).toHaveBeenCalledWith([approved]);
		expect(container.textContent).toContain("1 feature queued");
	});
	it("approves the saved revision and starts the design interview without leaving the feature", async () => {
		mocks.tasks = [task({ status: "pending_approval" })];
		mocks.updateAgendaTask.mockResolvedValue(task({ revision: 4 }));
		mocks.approveAgendaTask.mockResolvedValue(task({ revision: 5 }));
		const openSession = vi.fn(async () => {});
		await act(async () =>
			root.render(
				<FactoryView workspacePaths={[]} onOpenSession={openSession} />,
			),
		);
		await act(async () => button("Export activity").click());
		await act(async () => button("Approve and run").click());
		expect(mocks.updateAgendaTask).not.toHaveBeenCalled();
		expect(mocks.approveAgendaTask).toHaveBeenCalledWith({
			taskId: "feature-1",
			expectedRevision: 3,
			allWorkspaces: true,
		});
		await act(async () => button("Interview with agent").click());
		expect(mocks.designFactoryTask).toHaveBeenCalledWith("feature-1");
		await act(async () => button("Interview with agent").click());
		expect(mocks.updateAgendaTask).not.toHaveBeenCalled();
		expect(openSession).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain("Questions will appear here");
		await act(async () => button("Open design conversation").click());
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
				<FactoryView
					workspacePaths={[]}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
		await act(async () => button("Needs you (1)").click());
		expect(container.textContent).not.toContain("Unblocked feature");
		await act(async () => button("Export activity").click());
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
		expect(container.textContent).toContain("Needs you (0)");
	});
	it("loads an agent-saved brief into the open feature without copying from chat", async () => {
		mocks.tasks = [task({ status: "pending_approval" })];
		const render = () =>
			root.render(
				<FactoryView
					workspacePaths={[]}
					onOpenSession={vi.fn(async () => {})}
				/>,
			);
		await act(async () => render());
		await act(async () => button("Export activity").click());
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
	it("imports an issue into editable fields and opens an existing feature instead of duplicating it", async () => {
		mocks.tasks = [task()];
		mocks.invoke.mockImplementation(async (command) =>
			command === "factory_import_issue"
				? {
						title: "Import activity",
						description: "Accept CSV uploads",
						source: {
							provider: "github",
							id: "owner/repo#7",
							url: "https://github.com/owner/repo/issues/7",
						},
					}
				: command === "get_desktop_settings"
					? {}
					: [],
		);
		await act(async () =>
			root.render(
				<FactoryView
					workspacePaths={["/repo"]}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
		await act(async () => button("Add work").click());
		await act(async () => selectTab("GitHub / Linear issue"));
		await act(async () =>
			changeInput("#feature-issue", "https://github.com/owner/repo/issues/7"),
		);
		await act(async () => button("Import").click());
		expect(mocks.invoke).toHaveBeenCalledWith("factory_import_issue", {
			url: "https://github.com/owner/repo/issues/7",
			cwd: "/repo",
		});
		const title = document.querySelector("#feature-name");
		const request = document.querySelector("#feature-request");
		if (
			!(title instanceof HTMLInputElement) ||
			!(request instanceof HTMLTextAreaElement)
		)
			throw new Error("Missing feature fields");
		expect(title.value).toBe("Import activity");
		expect(request.value).toBe("Accept CSV uploads");
		mocks.invoke.mockResolvedValueOnce({
			title: "Import activity",
			description: "Accept CSV uploads",
			source: {
				provider: "github",
				id: "owner/repo#7",
				url: "https://github.com/owner/repo/issues/7",
			},
			existingTaskId: "feature-1",
		});
		await act(async () => button("Import").click());
		expect(document.querySelector("#feature-name")).toBeNull();
		expect(document.body.textContent).toContain("Plan");
	});
	it.each([
		{
			provider: "github",
			id: "I_example",
			url: "https://github.com/example/repo/issues/7",
		},
		{
			provider: "linear",
			id: "issue-example",
			url: "https://linear.app/example/issue/APP-7",
		},
	])("adds imported $provider work to the queue with its source and without starting an agent", async (source) => {
		mocks.invoke.mockImplementation(async (command) =>
			command === "factory_import_issue"
				? {
						title: "Investigate slow search",
						description: "Reproduce the reported delay.",
						source,
					}
				: command === "get_desktop_settings"
					? {}
					: [],
		);
		await act(async () =>
			root.render(
				<FactoryView
					workspacePaths={["/repo"]}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
		await act(async () => button("Add work").click());
		await act(async () => selectTab("GitHub / Linear issue"));
		await act(async () => changeInput("#feature-issue", source.url));
		expect(button("Add and scope").disabled).toBe(true);
		await act(async () => button("Import").click());
		await act(async () => changeInput("#feature-repository", "/other"));
		expect(button("Add and scope").disabled).toBe(true);
		await act(async () => button("Import").click());
		const checkbox = document.querySelector('input[type="checkbox"]');
		if (!(checkbox instanceof HTMLInputElement))
			throw new Error("Missing scoping choice");
		await act(async () => checkbox.click());
		expect(button("Add to queue").disabled).toBe(false);
		expect(button("Add to queue").form?.checkValidity()).toBe(true);
		await act(async () => button("Add to queue").click());
		expect(mocks.createTask).toHaveBeenCalledTimes(1);
		expect(mocks.createTask).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Investigate slow search",
				instructions: "Reproduce the reported delay.",
				workspaceRoot: "/other",
				cwd: "/other",
				factory: expect.objectContaining({
					sourceIssue: source,
					publishPullRequest: false,
				}),
			}),
		);
		expect(mocks.designFactoryTask).not.toHaveBeenCalled();
	});

	it("opens existing work returned by creation without restarting scoping", async () => {
		const existing = task();
		mocks.tasks = [existing];
		mocks.createTask.mockResolvedValueOnce(existing);
		mocks.invoke.mockImplementation(async (command) =>
			command === "factory_import_issue"
				? {
						title: "Imported request",
						description: "An issue already tracked by the factory.",
						source: {
							provider: "github",
							id: "example/repo#7",
							url: "https://github.com/example/repo/issues/7",
						},
					}
				: command === "get_desktop_settings"
					? {}
					: [],
		);
		await act(async () =>
			root.render(
				<FactoryView
					workspacePaths={["/repo"]}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
		await act(async () => button("Add work").click());
		await act(async () => selectTab("GitHub / Linear issue"));
		await act(async () =>
			changeInput("#feature-issue", "https://github.com/example/repo/issues/7"),
		);
		await act(async () => button("Import").click());
		expect(button("Add and scope").disabled).toBe(false);
		await act(async () => button("Add and scope").click());
		expect(mocks.createTask).toHaveBeenCalledTimes(1);
		expect(mocks.createTask).toHaveBeenCalledWith(
			expect.objectContaining({ taskId: expect.stringMatching(/^task_/) }),
		);
		expect(mocks.designFactoryTask).not.toHaveBeenCalled();
		expect(document.querySelector("#feature-name")).toBeNull();
		const detail = document.querySelector('[role="dialog"]');
		expect(detail?.textContent).toContain(existing.title);
		expect(detail?.textContent).toContain(existing.instructions);
	});

	it("adds a direct request once and reports scoping startup failure without offering a duplicate submission", async () => {
		mocks.designFactoryTask.mockRejectedValueOnce(
			new Error("Provider unavailable"),
		);
		await act(async () =>
			root.render(
				<FactoryView
					workspacePaths={["/repo"]}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
		await act(async () => button("Add work").click());
		await act(async () => {
			changeInput("#feature-name", "Investigate search");
			changeInput("#feature-request", "Find why search is slow.");
		});
		expect(button("Add and scope").disabled).toBe(false);
		expect(button("Add and scope").form?.checkValidity()).toBe(true);
		await act(async () => button("Add and scope").click());
		expect(mocks.createTask).toHaveBeenCalledTimes(1);
		expect(mocks.createTask).toHaveBeenCalledWith(
			expect.objectContaining({
				instructions: "Find why search is slow.",
				factory: expect.objectContaining({ sourceIssue: undefined }),
			}),
		);
		const created = await mocks.createTask.mock.results[0].value;
		expect(created.taskId).toEqual(expect.stringMatching(/^task_/));
		expect(mocks.designFactoryTask).toHaveBeenCalledWith(created.taskId);
		expect(mocks.toast).toHaveBeenCalledWith({
			title: "Scoping could not start",
			description:
				"Work was added, but scoping could not start: Provider unavailable",
			variant: "destructive",
		});
		expect(document.querySelector("#feature-name")).toBeNull();
		expect(container.textContent).toContain(
			"Work was added, but scoping could not start: Provider unavailable",
		);
	});

	it("ignores a late import after closing Add work and surfaces import failures on retry", async () => {
		mocks.tasks = [task()];
		let finish: (value: unknown) => void = () => {
			throw new Error("Import not started");
		};
		mocks.invoke.mockImplementation(async (command) =>
			command === "factory_import_issue"
				? new Promise((resolve) => {
						finish = resolve;
					})
				: command === "get_desktop_settings"
					? {}
					: [],
		);
		await act(async () =>
			root.render(
				<FactoryView
					workspacePaths={["/repo"]}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
		await act(async () => button("Add work").click());
		await act(async () => selectTab("GitHub / Linear issue"));
		await act(async () =>
			changeInput("#feature-issue", "https://github.com/example/repo/issues/7"),
		);
		await act(async () => button("Import").click());
		expect(button("GitHub / Linear issue").disabled).toBe(true);
		await act(async () => button("Close").click());
		await act(async () => finish({ existingTaskId: "feature-1" }));
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(mocks.createTask).not.toHaveBeenCalled();
		mocks.invoke.mockImplementation(async (command) => {
			if (command === "factory_import_issue")
				throw new Error("Check your Linear credentials and issue access.");
			return command === "get_desktop_settings" ? {} : [];
		});
		await act(async () => button("Add work").click());
		await act(async () => selectTab("GitHub / Linear issue"));
		await act(async () =>
			changeInput("#feature-issue", "https://linear.app/example/issue/APP-7"),
		);
		await act(async () => button("Import").click());
		expect(document.body.textContent).toContain(
			"Check your Linear credentials and issue access.",
		);
		expect(button("Import").disabled).toBe(false);
		expect(button("Add and scope").disabled).toBe(true);
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
				<FactoryView
					workspacePaths={[]}
					onOpenSession={vi.fn(async () => {})}
				/>,
			),
		);
		expect(container.textContent).toContain(
			`Needs you (${phase === "watching" ? 0 : 1})`,
		);
		await act(async () => button("Export activity").click());
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
		expect(document.body.textContent).toContain("Repair round 2 of 2");
	});
});
