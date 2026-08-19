// @vitest-environment jsdom

import type { AgendaTaskRecord } from "@cline/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	AgentSidebar,
	getSessionOverviewItems,
	getSessionOverviewTitle,
} from "@/components/agent-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AccountProvider } from "@/contexts/account-context";
import type {
	SessionThread,
	UseSessionHistoryResult,
} from "@/hooks/use-session-history";

const desktopMocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	createAgendaTask: vi.fn(),
	listAgendaTasks: vi.fn(),
	approveAgendaTask: vi.fn(),
	cancelAgendaTask: vi.fn(),
	runAgendaTask: vi.fn(),
	getAgendaAutomationPolicy: vi.fn(),
	setAgendaAutomationPolicy: vi.fn(),
	subscribe: vi.fn(() => () => undefined),
	subscribeTransportState: vi.fn(() => () => undefined),
}));
const { invoke } = desktopMocks;
vi.mock("@/lib/desktop-client", () => ({ desktopClient: desktopMocks }));

let container: HTMLDivElement;
let root: Root;

function makeThread(project: string, index: number): SessionThread {
	return {
		id: `${project}-${index}`,
		title: `${project} session ${index}`,
		codebase: project,
		workspacePath: `/projects/${project}`,
		time: `${index}m`,
		provider: "cline",
		model: "test-model",
		status: "completed",
		isScheduled: false,
	};
}

function makeSessionHistory(
	threads: SessionThread[],
	loadMoreSessions: ReturnType<typeof vi.fn>,
	options: {
		loadOlderSessions?: ReturnType<typeof vi.fn>;
		mayHaveMoreSessions?: boolean;
	} = {},
): UseSessionHistoryResult {
	return {
		deleteThread: vi.fn(),
		forkThread: vi.fn(),
		isLoadingHistory: false,
		isLoadingMore: false,
		loadOlderSessions: options.loadOlderSessions ?? vi.fn(),
		loadMoreSessions,
		mayHaveMoreSessions: options.mayHaveMoreSessions ?? false,
		openThread: vi.fn(),
		pendingAction: null,
		renameThread: vi.fn(),
		threads,
		unreadSessionIds: new Set<string>(),
	} as unknown as UseSessionHistoryResult;
}

async function click(element: Element): Promise<void> {
	await act(async () => {
		element.dispatchEvent(
			new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
		);
		element.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);
		await Promise.resolve();
	});
}

async function hover(element: Element): Promise<void> {
	await act(async () => {
		element.dispatchEvent(
			new MouseEvent("pointerover", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

async function changeField(
	element: HTMLInputElement | HTMLTextAreaElement,
	value: string,
): Promise<void> {
	await act(async () => {
		const prototype = Object.getPrototypeOf(element) as object;
		const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
		setter?.call(element, value);
		element.dispatchEvent(new Event("input", { bubbles: true }));
		element.dispatchEvent(new Event("change", { bubbles: true }));
		await Promise.resolve();
	});
}

function buttonWithText(text: string, rootNode: ParentNode = container) {
	const button = [
		...rootNode.querySelectorAll<HTMLButtonElement>("button"),
	].find((candidate) => candidate.textContent?.includes(text));
	expect(button).toBeDefined();
	return button as HTMLButtonElement;
}

function sessionIsVisible(title: string): boolean {
	return [...container.querySelectorAll<HTMLButtonElement>("button")].some(
		(button) => button.querySelector("span")?.textContent === title,
	);
}

const signedInUser = {
	id: "user-1",
	email: "beatrix@cline.bot",
	displayName: "Beatrix",
	photoUrl: "",
	createdAt: "2024-01-01T00:00:00Z",
	updatedAt: "2024-01-01T00:00:00Z",
	organizations: [
		{
			active: true,
			memberId: "member-1",
			name: "Cline Bot Inc",
			organizationId: "org-1",
			roles: ["admin"],
		},
	],
};

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	window.localStorage.clear();
	invoke.mockReset();
	invoke.mockRejectedValue(new Error("No Cline account auth token found"));
	desktopMocks.createAgendaTask.mockReset();
	desktopMocks.listAgendaTasks.mockReset();
	desktopMocks.listAgendaTasks.mockResolvedValue([]);
	desktopMocks.approveAgendaTask.mockReset();
	desktopMocks.cancelAgendaTask.mockReset();
	desktopMocks.runAgendaTask.mockReset();
	desktopMocks.getAgendaAutomationPolicy.mockReset();
	desktopMocks.getAgendaAutomationPolicy.mockResolvedValue({
		scopeKey: "global",
		mode: "manual",
		applyToAgentCreated: true,
		maxConcurrentRuns: 1,
		maxChainDepth: 3,
		maxStartsPerHour: 20,
		updatedAt: "2026-08-13T00:00:00.000Z",
	});
	desktopMocks.setAgendaAutomationPolicy.mockReset();
	desktopMocks.subscribe.mockReset();
	desktopMocks.subscribe.mockImplementation(() => () => undefined);
	desktopMocks.subscribeTransportState.mockReset();
	desktopMocks.subscribeTransportState.mockImplementation(
		() => () => undefined,
	);
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: vi.fn(() => ({
			matches: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	});
	HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
	HTMLElement.prototype.setPointerCapture = vi.fn();
	HTMLElement.prototype.releasePointerCapture = vi.fn();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

describe("AgentSidebar session organization", () => {
	it("shows an unread dot when a new Todo item arrives and clears it on open", async () => {
		const eventHandlers = new Map<string, () => void>();
		desktopMocks.subscribe.mockImplementation(
			(eventName: string, handler: () => void) => {
				eventHandlers.set(eventName, handler);
				return () => eventHandlers.delete(eventName);
			},
		);

		await act(async () => {
			root.render(
				<SidebarProvider>
					<AgentSidebar
						onHome={vi.fn()}
						onSettingsSectionChange={vi.fn()}
						sessionHistory={makeSessionHistory([], vi.fn())}
						setView={vi.fn()}
						settingsSection="General"
						view="chat"
					/>
				</SidebarProvider>,
			);
		});
		await vi.waitFor(() =>
			expect(desktopMocks.listAgendaTasks).toHaveBeenCalled(),
		);
		expect(
			container.querySelector('[data-testid="new-todo-indicator"]'),
		).toBeNull();

		desktopMocks.listAgendaTasks.mockResolvedValue([makeAgendaTask()]);
		await act(async () => {
			eventHandlers.get("task.created")?.();
		});
		await vi.waitFor(() =>
			expect(
				container.querySelector('[data-testid="new-todo-indicator"]'),
			).not.toBeNull(),
		);

		await click(
			container.querySelector('[aria-label="Show Agenda"]') as Element,
		);
		expect(
			container.querySelector('[data-testid="new-todo-indicator"]'),
		).toBeNull();
	});

	it("shows pending Agenda work and requires approval before run", async () => {
		const task = makeAgendaTask();
		desktopMocks.listAgendaTasks.mockResolvedValue([task]);
		desktopMocks.approveAgendaTask.mockResolvedValue({
			...task,
			status: "approved",
			revision: 2,
		});

		await act(async () => {
			root.render(
				<SidebarProvider>
					<AgentSidebar
						onHome={vi.fn()}
						onSettingsSectionChange={vi.fn()}
						sessionHistory={makeSessionHistory([], vi.fn())}
						setView={vi.fn()}
						settingsSection="General"
						view="chat"
						workspaceRoot="/projects/current"
					/>
				</SidebarProvider>,
			);
			await Promise.resolve();
		});
		await click(
			container.querySelector('[aria-label="Show Agenda"]') as Element,
		);

		expect(container.textContent).toContain("Review PR checks");
		expect(container.textContent).toContain("cline");
		expect(container.textContent).not.toContain("P1 · pending approval");
		expect(desktopMocks.listAgendaTasks).toHaveBeenCalledWith({
			statuses: ["pending_approval", "approved", "in_progress", "failed"],
			workspaceRoot: "/projects/current",
			limit: 200,
		});
		const approve = container.querySelector(
			'[aria-label="Approve Review PR checks"]',
		);
		expect(approve).not.toBeNull();
		expect(approve?.className).toContain("text-emerald-500!");
		expect(
			container.querySelector('[aria-label="Cancel Review PR checks"]')
				?.className,
		).toContain("text-destructive!");
		expect(approve?.closest(".group")?.className).toContain("max-w-full");
		expect(
			buttonWithText("Review PR checks").querySelector(".truncate"),
		).not.toBeNull();
		expect(
			container.querySelector('[aria-label="Run Review PR checks"]'),
		).toBeNull();

		await click(buttonWithText("Review PR checks"));
		expect(desktopMocks.approveAgendaTask).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain(
			"Review CI and report failures.",
		);
		expect(buttonWithText("Reject", document)).toBeDefined();
		await click(buttonWithText("Approve", document));
		expect(desktopMocks.approveAgendaTask).toHaveBeenCalledWith({
			taskId: "task-1",
			expectedRevision: 1,
		});
	});

	it("uses each displayed Agenda revision when running or cancelling", async () => {
		const runnable = makeAgendaTask({
			taskId: "task-run",
			title: "Run task",
			status: "approved",
			revision: 4,
		});
		const cancellable = makeAgendaTask({
			taskId: "task-cancel",
			title: "Cancel task",
			status: "approved",
			revision: 9,
		});
		desktopMocks.listAgendaTasks.mockResolvedValue([runnable, cancellable]);
		desktopMocks.runAgendaTask.mockResolvedValue({
			task: { ...runnable, status: "in_progress" },
		});
		desktopMocks.cancelAgendaTask.mockResolvedValue({
			...cancellable,
			status: "cancelled",
		});

		await act(async () => {
			root.render(
				<SidebarProvider>
					<AgentSidebar
						onHome={vi.fn()}
						onSettingsSectionChange={vi.fn()}
						sessionHistory={makeSessionHistory([], vi.fn())}
						setView={vi.fn()}
						settingsSection="General"
						view="chat"
					/>
				</SidebarProvider>,
			);
			await Promise.resolve();
		});
		await click(
			container.querySelector('[aria-label="Show Agenda"]') as Element,
		);

		await click(
			container.querySelector('[aria-label="Run Run task"]') as Element,
		);
		expect(desktopMocks.runAgendaTask).toHaveBeenCalledWith({
			taskId: "task-run",
			expectedRevision: 4,
		});

		await click(
			container.querySelector('[aria-label="Cancel Cancel task"]') as Element,
		);
		expect(desktopMocks.cancelAgendaTask).toHaveBeenCalledWith({
			taskId: "task-cancel",
			expectedRevision: 9,
		});
	});

	it("creates a workspace task with the selected priority, expiry, and model", async () => {
		const created = makeAgendaTask({
			taskId: "task-created",
			title: "Investigate the regression",
		});
		desktopMocks.createAgendaTask.mockResolvedValue(created);
		window.localStorage.setItem(
			"cline.code.model-selection.v1",
			JSON.stringify({
				lastProvider: "openrouter",
				lastModelByProvider: { openrouter: "anthropic/claude-sonnet-4.6" },
			}),
		);

		await act(async () => {
			root.render(
				<SidebarProvider>
					<AgentSidebar
						onHome={vi.fn()}
						onSettingsSectionChange={vi.fn()}
						sessionHistory={makeSessionHistory([], vi.fn())}
						setView={vi.fn()}
						settingsSection="General"
						view="chat"
						workspaceRoot="/projects/current"
					/>
				</SidebarProvider>,
			);
			await Promise.resolve();
		});

		expect(container.querySelector('[aria-label="Agenda"]')).toBeNull();
		await click(
			container.querySelector('[aria-label="Show Agenda"]') as Element,
		);
		await click(
			container.querySelector('[aria-label="Create Todo item"]') as Element,
		);
		const title =
			document.querySelector<HTMLInputElement>("#agenda-task-title");
		const instructions = document.querySelector<HTMLTextAreaElement>(
			"#agenda-task-instructions",
		);
		expect(title).not.toBeNull();
		expect(instructions).not.toBeNull();
		await changeField(title as HTMLInputElement, "Investigate the regression");
		await changeField(
			instructions as HTMLTextAreaElement,
			"Inspect the failing build and implement a fix.",
		);
		await click(buttonWithText("Add to Agenda", document));

		await vi.waitFor(() =>
			expect(desktopMocks.createAgendaTask).toHaveBeenCalledOnce(),
		);
		const input = desktopMocks.createAgendaTask.mock.calls[0]?.[0];
		expect(input).toMatchObject({
			type: "todo",
			title: "Investigate the regression",
			instructions: "Inspect the failing build and implement a fix.",
			scope: "workspace",
			workspaceRoot: "/projects/current",
			priority: 3,
			modelSelection: {
				providerId: "openrouter",
				modelId: "anthropic/claude-sonnet-4.6",
			},
			automationEligible: true,
		});
		expect(Date.parse(input.expiresAt)).toBeGreaterThan(Date.now());
	});

	it("filters scheduled sessions without changing their titles", async () => {
		const scheduled = {
			...makeThread("scheduled", 1),
			source: "core",
			isScheduled: true,
		};
		const regular = { ...makeThread("regular", 1), source: "core" };

		await act(async () => {
			root.render(
				<SidebarProvider>
					<AgentSidebar
						activeSessionId={null}
						onHome={vi.fn()}
						onNewThread={vi.fn()}
						onSettingsSectionChange={vi.fn()}
						sessionHistory={makeSessionHistory([scheduled, regular], vi.fn())}
						setView={vi.fn()}
						settingsSection="General"
						view="chat"
					/>
				</SidebarProvider>,
			);
		});

		expect(sessionIsVisible("scheduled session 1")).toBe(true);
		expect(container.textContent).not.toContain("(schedule)");

		await click(
			container.querySelector('[aria-label="Filter sessions"]') as Element,
		);
		expect(document.body.textContent).not.toContain("Recent");
		const schedulesOption = await vi.waitFor(() => {
			const option = [
				...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
			].find((candidate) => candidate.textContent?.includes("Schedules"));
			expect(option).toBeDefined();
			return option as HTMLElement;
		});
		await click(schedulesOption);

		expect(sessionIsVisible("scheduled session 1")).toBe(true);
		expect(sessionIsVisible("regular session 1")).toBe(false);
	});

	it("defaults to all sources and filters by the selected client source", async () => {
		const desktop = { ...makeThread("desktop", 1), source: "desktop" };
		const cli = { ...makeThread("cli", 1), source: "cli" };

		await act(async () => {
			root.render(
				<SidebarProvider>
					<AgentSidebar
						activeSessionId={null}
						onHome={vi.fn()}
						onSettingsSectionChange={vi.fn()}
						sessionHistory={makeSessionHistory([desktop, cli], vi.fn())}
						setView={vi.fn()}
						settingsSection="General"
						view="chat"
					/>
				</SidebarProvider>,
			);
		});

		expect(sessionIsVisible("desktop session 1")).toBe(true);
		expect(sessionIsVisible("cli session 1")).toBe(true);

		await click(
			container.querySelector('[aria-label="Filter sessions"]') as Element,
		);
		const cliOption = await vi.waitFor(() => {
			const option = [
				...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
			].find((candidate) => candidate.textContent === "CLI");
			expect(option).toBeDefined();
			return option as HTMLElement;
		});
		await click(cliOption);

		expect(sessionIsVisible("desktop session 1")).toBe(false);
		expect(sessionIsVisible("cli session 1")).toBe(true);
	});

	it("builds the hover overview with branch and secondary metadata last", () => {
		const thread = {
			...makeThread("cline", 5),
			gitBranch: "bee/session-overview",
			inputTokens: 3_000_000,
			outputTokens: 9_000,
			totalCostUsd: 3.06,
		};

		expect(getSessionOverviewItems(thread)).toEqual([
			["Workspace", "cline", "/projects/cline"],
			["Branch", "bee/session-overview"],
			["Provider", "cline"],
			["Model", "test-model"],
			["Tokens", "3009k"],
			["Cost", "$3.06"],
		]);
		expect(getSessionOverviewItems(makeThread("cline", 5))).not.toContainEqual([
			"Branch",
			expect.anything(),
		]);
		expect(
			getSessionOverviewItems(thread).some(([label]) => label === "Status"),
		).toBe(false);
	});

	it("shows the full first line of the session title", () => {
		const firstLine =
			"This is a complete session title that is intentionally longer than seventy characters for the hover overview";
		expect(getSessionOverviewTitle(`${firstLine}\nSecond line`)).toBe(
			firstLine,
		);
	});

	it("defaults to time and keeps project expansion scoped to one project", async () => {
		const threads = [
			...Array.from({ length: 12 }, (_, index) =>
				makeThread("alpha", index + 1),
			),
			...Array.from({ length: 12 }, (_, index) =>
				makeThread("beta", index + 1),
			),
		];
		const loadMoreSessions = vi.fn(async () => undefined);
		const loadOlderSessions = vi.fn(async () => undefined);
		const sessionHistory = makeSessionHistory(threads, loadMoreSessions, {
			loadOlderSessions,
			mayHaveMoreSessions: true,
		});

		await act(async () => {
			root.render(
				<SidebarProvider>
					<AgentSidebar
						activeSessionId={null}
						onHome={vi.fn()}
						onNewThread={vi.fn()}
						onSettingsSectionChange={vi.fn()}
						sessionHistory={sessionHistory}
						setView={vi.fn()}
						settingsSection="General"
						view="chat"
					/>
				</SidebarProvider>,
			);
		});

		expect(
			container.querySelector('[aria-label="Sort sessions: Time"]'),
		).not.toBeNull();
		expect(sessionIsVisible("alpha session 10")).toBe(true);
		expect(sessionIsVisible("alpha session 11")).toBe(false);
		expect(sessionIsVisible("beta session 1")).toBe(false);

		await click(buttonWithText("Show more"));
		expect(sessionIsVisible("alpha session 11")).toBe(true);
		expect(loadMoreSessions).toHaveBeenCalledWith(20);

		await click(
			container.querySelector('[aria-label="Sort sessions: Time"]') as Element,
		);
		const projectOption = await vi.waitFor(() => {
			const option = [
				...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
			].find((candidate) => candidate.textContent?.includes("Sort by project"));
			expect(option).toBeDefined();
			return option as HTMLElement;
		});
		await click(projectOption);

		await vi.waitFor(() => {
			expect(
				container.querySelector('[aria-label="Sort sessions: Project"]'),
			).not.toBeNull();
		});
		expect(container.textContent).toContain("alpha");
		expect(container.textContent).toContain("beta");
		expect(sessionIsVisible("alpha session 11")).toBe(false);
		expect(sessionIsVisible("beta session 11")).toBe(false);

		await click(buttonWithText("Show more in alpha"));
		expect(sessionIsVisible("alpha session 11")).toBe(true);
		expect(sessionIsVisible("beta session 11")).toBe(false);

		await click(buttonWithText("Load older projects"));
		expect(loadOlderSessions).toHaveBeenCalledOnce();
	});

	it("shows the signed-in account and active organization in the footer", async () => {
		invoke.mockResolvedValue(signedInUser);

		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider>
						<AgentSidebar
							activeSessionId={null}
							onHome={vi.fn()}
							onNewThread={vi.fn()}
							onSettingsSectionChange={vi.fn()}
							sessionHistory={makeSessionHistory([], vi.fn())}
							setView={vi.fn()}
							settingsSection="General"
							view="chat"
						/>
					</SidebarProvider>
				</AccountProvider>,
			);
		});

		await vi.waitFor(() => {
			expect(container.textContent).toContain("Beatrix");
			expect(container.textContent).toContain("Cline Bot Inc");
		});
		expect(container.textContent).not.toContain("Cline Desktop");
		expect(container.textContent).not.toContain("Local");
		const accountButton = container.querySelector(
			'[aria-label="Account settings"]',
		);
		const settingsButton = container.querySelector('[aria-label="Settings"]');
		expect(accountButton?.parentElement).toBe(settingsButton?.parentElement);
		expect(settingsButton?.textContent).toBe("");
		const accountName = [
			...(accountButton?.querySelectorAll("span") ?? []),
		].find((element) => element.textContent === "Beatrix");
		const organizationName = [
			...(accountButton?.querySelectorAll("span") ?? []),
		].find((element) => element.textContent === "Cline Bot Inc");
		expect(accountName?.nextElementSibling).toBe(organizationName);
		expect(accountName?.parentElement?.className).toContain("flex-col");
	});

	it("opens the Account settings section when the footer account row is clicked", async () => {
		const setView = vi.fn();
		const onSettingsSectionChange = vi.fn();
		invoke.mockResolvedValue(signedInUser);

		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider>
						<AgentSidebar
							activeSessionId={null}
							onHome={vi.fn()}
							onNewThread={vi.fn()}
							onSettingsSectionChange={onSettingsSectionChange}
							sessionHistory={makeSessionHistory([], vi.fn())}
							setView={setView}
							settingsSection="General"
							view="chat"
						/>
					</SidebarProvider>
				</AccountProvider>,
			);
		});

		const accountButton = await vi.waitFor(() => {
			const button = container.querySelector('[aria-label="Account settings"]');
			expect(button).not.toBeNull();
			return button;
		});
		await click(accountButton as Element);

		expect(onSettingsSectionChange).toHaveBeenCalledWith("Account");
		expect(setView).not.toHaveBeenCalled();
	});

	it("shows the desktop app version and connected Hub when the logo is hovered", async () => {
		const onHome = vi.fn();
		invoke.mockImplementation(async (command: string) => {
			if (command === "get_process_context") {
				return {
					appVersion: "1.2.3",
					hub: {
						error: null,
						status: "connected",
						url: "ws://127.0.0.1:25463/hub",
					},
				};
			}
			throw new Error("No Cline account auth token found");
		});

		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider>
						<AgentSidebar
							activeSessionId={null}
							onHome={onHome}
							onNewThread={vi.fn()}
							onSettingsSectionChange={vi.fn()}
							sessionHistory={makeSessionHistory([], vi.fn())}
							setView={vi.fn()}
							settingsSection="General"
							view="chat"
						/>
					</SidebarProvider>
				</AccountProvider>,
			);
		});

		const logoButton = container.querySelector('[aria-label="Cline home"]');
		expect(logoButton).not.toBeNull();
		expect(document.body.textContent).not.toContain("Version 1.2.3");

		await hover(logoButton as Element);

		await vi.waitFor(() => {
			expect(document.body.textContent).toContain("Version 1.2.3");
			expect(document.body.textContent).toContain("Cline Hub @25463");
			expect(document.body.textContent).not.toContain(
				"ws://127.0.0.1:25463/hub",
			);
		});
		expect(onHome).not.toHaveBeenCalled();

		await click(logoButton as Element);
		expect(onHome).toHaveBeenCalled();
		expect(invoke).toHaveBeenCalledWith("get_process_context");
	});

	it("shows a disconnected Hub when process context has no live connection", async () => {
		invoke.mockResolvedValue({
			appVersion: "1.2.3",
			hub: {
				error: "Hub connection closed (code=1006)",
				status: "disconnected",
				url: "ws://127.0.0.1:25463/hub",
			},
		});

		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider>
						<AgentSidebar
							activeSessionId={null}
							onHome={vi.fn()}
							onNewThread={vi.fn()}
							onSettingsSectionChange={vi.fn()}
							sessionHistory={makeSessionHistory([], vi.fn())}
							setView={vi.fn()}
							settingsSection="General"
							view="chat"
						/>
					</SidebarProvider>
				</AccountProvider>,
			);
		});

		const logoButton = container.querySelector('[aria-label="Cline home"]');
		expect(logoButton).not.toBeNull();
		await hover(logoButton as Element);

		await vi.waitFor(() => {
			expect(document.body.textContent).toContain("Cline Hub @25463");
			expect(document.body.textContent).toContain(
				"Hub connection closed (code=1006)",
			);
		});
	});

	it("hosts back and forward navigation in the draggable sidebar title bar", async () => {
		const onNavigateBack = vi.fn();
		const onNavigateForward = vi.fn();

		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider>
						<AgentSidebar
							activeSessionId={null}
							canNavigateBack
							canNavigateForward
							onHome={vi.fn()}
							onNavigateBack={onNavigateBack}
							onNavigateForward={onNavigateForward}
							onNewThread={vi.fn()}
							onSettingsSectionChange={vi.fn()}
							sessionHistory={makeSessionHistory([], vi.fn())}
							setView={vi.fn()}
							settingsSection="General"
							view="chat"
						/>
					</SidebarProvider>
				</AccountProvider>,
			);
		});

		const titleBar = container.querySelector("[data-tauri-drag-region]");
		expect(titleBar).not.toBeNull();
		expect(titleBar?.textContent).not.toContain("Cline");

		await click(
			container.querySelector('[aria-label="Previous page"]') as Element,
		);
		await click(container.querySelector('[aria-label="Next page"]') as Element);
		expect(onNavigateBack).toHaveBeenCalledOnce();
		expect(onNavigateForward).toHaveBeenCalledOnce();
	});

	it("places the logo and icon-only new-session action below the title bar", async () => {
		const onNewThread = vi.fn();
		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider>
						<AgentSidebar
							activeSessionId={null}
							onHome={vi.fn()}
							onNewThread={onNewThread}
							onSettingsSectionChange={vi.fn()}
							sessionHistory={makeSessionHistory([], vi.fn())}
							setView={vi.fn()}
							settingsSection="General"
							view="chat"
						/>
					</SidebarProvider>
				</AccountProvider>,
			);
		});

		const logo = container.querySelector('[aria-label="Cline home"]');
		const showAgenda = container.querySelector('[aria-label="Show Agenda"]');
		const newSession = container.querySelector('[aria-label="New Session"]');
		expect(logo).not.toBeNull();
		expect(showAgenda).not.toBeNull();
		expect(newSession).not.toBeNull();
		expect(newSession?.textContent).toBe("");
		await click(newSession as Element);
		expect(onNewThread).toHaveBeenCalledOnce();
	});

	it("uses only the Cline logo for home in the collapsed sidebar", async () => {
		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider defaultOpen={false}>
						<AgentSidebar
							activeSessionId={null}
							onHome={vi.fn()}
							onNewThread={vi.fn()}
							onSettingsSectionChange={vi.fn()}
							sessionHistory={makeSessionHistory([], vi.fn())}
							setView={vi.fn()}
							settingsSection="General"
							view="chat"
						/>
					</SidebarProvider>
				</AccountProvider>,
			);
		});

		expect(container.querySelector('[aria-label="Cline home"]')).not.toBeNull();
		expect(container.querySelector('[aria-label="New Session"]')).toBeNull();
		expect(
			container.querySelector('[aria-label="Expand sidebar"]')?.className,
		).toContain("mt-auto");
	});

	it("uses a compact overlay-friendly width in collapsed settings", async () => {
		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider defaultOpen={false}>
						<AgentSidebar
							activeSessionId={null}
							onHome={vi.fn()}
							onNewThread={vi.fn()}
							onSettingsSectionChange={vi.fn()}
							sessionHistory={makeSessionHistory([], vi.fn())}
							setView={vi.fn()}
							settingsSection="Account"
							view="settings"
						/>
					</SidebarProvider>
				</AccountProvider>,
			);
		});

		const sidebarWrapper = container.querySelector<HTMLElement>(
			'[data-slot="sidebar-wrapper"]',
		);
		expect(sidebarWrapper?.style.getPropertyValue("--sidebar-width-icon")).toBe(
			"3rem",
		);
		expect(sidebarWrapper?.dataset.state).toBe("collapsed");
		expect(
			container.querySelector('[aria-label="Settings sections"]'),
		).not.toBeNull();
		const leftAlignedButtons = [
			"Cline home",
			"General",
			"Account",
			"Expand sidebar",
			"Settings",
		];
		for (const label of leftAlignedButtons) {
			const button = container.querySelector(`[aria-label="${label}"]`);
			expect(button?.className).not.toContain("mx-auto");
		}
		expect(
			container.querySelector('[aria-label="Expand sidebar"]')?.className,
		).toContain("mt-auto");
		expect(
			container.querySelector('[aria-label="Settings sections"]')?.className,
		).toContain("items-start");
	});

	it("shows only the labeled Settings button when signed out", async () => {
		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider>
						<AgentSidebar
							activeSessionId={null}
							onHome={vi.fn()}
							onNewThread={vi.fn()}
							onSettingsSectionChange={vi.fn()}
							sessionHistory={makeSessionHistory([], vi.fn())}
							setView={vi.fn()}
							settingsSection="General"
							view="chat"
						/>
					</SidebarProvider>
				</AccountProvider>,
			);
		});

		await vi.waitFor(() =>
			expect(container.querySelector('[aria-label="Settings"]')).not.toBeNull(),
		);
		expect(
			container.querySelector('[aria-label="Account settings"]'),
		).toBeNull();
		expect(
			container.querySelector('[aria-label="Settings"]')?.textContent,
		).toContain("Settings");
	});
});

function makeAgendaTask(
	overrides: Partial<AgendaTaskRecord> = {},
): AgendaTaskRecord {
	return {
		taskId: "task-1",
		type: "follow-up",
		status: "pending_approval",
		title: "Review PR checks",
		description: "Confirm that CI passed.",
		instructions: "Review CI and report failures.",
		scope: "workspace",
		workspaceRoot: "/projects/cline",
		resourcePaths: [],
		priority: 1,
		availableAt: "2026-08-13T00:00:00.000Z",
		expiresAt: "2099-08-20T00:00:00.000Z",
		automationEligible: true,
		revision: 1,
		createdBy: { kind: "agent" },
		updatedBy: { kind: "agent" },
		createdAt: "2026-08-13T00:00:00.000Z",
		updatedAt: "2026-08-13T00:00:00.000Z",
		...overrides,
	};
}
