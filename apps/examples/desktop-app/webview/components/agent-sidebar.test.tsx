// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	AgentSidebar,
	getSessionOverviewItems,
	getSessionOverviewTitle,
} from "@/components/agent-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AccountProvider } from "@/contexts/account-context";
import {
	resetScheduleRunNotificationsForTesting,
	useHasUnreadScheduleRun,
} from "@/hooks/use-schedule-run-notifications";
import type {
	SessionThread,
	UseSessionHistoryResult,
} from "@/hooks/use-session-history";
import type { DesktopAppView } from "@/lib/desktop-app-state";
import { MODEL_SELECTION_STORAGE_KEY } from "@/lib/model-selection";
import { TASK_WORKTREE_DELETE_WARNING } from "@/lib/work-in-selection";
import { registerTaskWorktreeRoot } from "@/lib/workspace-paths";

const desktopMocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	subscribe: vi.fn(
		(_event: string, _listener: (payload: unknown) => void): (() => void) =>
			() =>
				undefined,
	),
	subscribeTransportState: vi.fn(() => () => undefined),
}));
const { invoke } = desktopMocks;
vi.mock("@/lib/desktop-client", () => ({ desktopClient: desktopMocks }));

let container: HTMLDivElement;
let root: Root;
const subscriptions = new Set<{
	event: string;
	listener: (payload: unknown) => void;
}>();

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
		hasLoadedHistory?: boolean;
		isLoadingMore?: boolean;
	} = {},
): UseSessionHistoryResult {
	return {
		deleteThread: vi.fn(),
		forkThread: vi.fn(),
		hasLoadedHistory: options.hasLoadedHistory ?? true,
		isLoadingMore: options.isLoadingMore ?? false,
		loadAllSessions: vi.fn(async () => true),
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

async function emitDesktopEvent(event: string, payload: unknown = {}) {
	await act(async () => {
		for (const { event: subscribedEvent, listener } of subscriptions) {
			if (subscribedEvent === event) listener(payload);
		}
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

function buttonWithText(text: string, rootNode: ParentNode = container) {
	const button = [
		...rootNode.querySelectorAll<HTMLButtonElement>("button"),
	].find((candidate) => candidate.textContent?.includes(text));
	expect(button).toBeDefined();
	return button as HTMLButtonElement;
}

async function switchToProjectSort(): Promise<void> {
	// The sort control is a direct toggle: one click flips to project mode.
	await click(
		container.querySelector('[aria-label="Sort sessions: Time"]') as Element,
	);
	await vi.waitFor(() => {
		expect(
			container.querySelector('[aria-label="Sort sessions: Project"]'),
		).not.toBeNull();
	});
}

function sessionIsVisible(title: string): boolean {
	return [...container.querySelectorAll<HTMLButtonElement>("button")].some(
		(button) => button.querySelector("span")?.textContent === title,
	);
}

function sessionRow(title: string): HTMLButtonElement {
	const row = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
		(button) => button.querySelector("span")?.textContent === title,
	);
	expect(row).toBeDefined();
	return row as HTMLButtonElement;
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
	if (typeof window.localStorage.clear !== "function") {
		Object.defineProperty(window, "localStorage", {
			configurable: true,
			value: window.sessionStorage,
		});
	}
	window.localStorage.clear();
	resetScheduleRunNotificationsForTesting();
	invoke.mockReset();
	invoke.mockRejectedValue(new Error("No Cline account auth token found"));
	desktopMocks.subscribe.mockReset();
	subscriptions.clear();
	desktopMocks.subscribe.mockImplementation((event, listener) => {
		const subscription = { event, listener };
		subscriptions.add(subscription);
		return () => subscriptions.delete(subscription);
	});
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
	HTMLElement.prototype.scrollIntoView = vi.fn();
	// cmdk (the search dialog) observes its list size; jsdom has no
	// ResizeObserver implementation.
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
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
	it("preserves row context-menu rename focus, Escape, and Enter through the shared row", async () => {
		const thread = makeThread("alpha", 1);
		const history = makeSessionHistory([thread], vi.fn());
		await act(async () => {
			root.render(
				<SidebarProvider>
					<AgentSidebar
						activeSessionId={thread.id}
						onHome={vi.fn()}
						onOpenCustomize={vi.fn()}
						onSettingsSectionChange={vi.fn()}
						sessionHistory={history}
						setView={vi.fn()}
						settingsSection="General"
						view="chat"
					/>
				</SidebarProvider>,
			);
		});
		const startRename = async () => {
			await act(async () => {
				buttonWithText(thread.title).dispatchEvent(
					new MouseEvent("contextmenu", {
						bubbles: true,
						cancelable: true,
						button: 2,
					}),
				);
			});
			const rename = [...document.querySelectorAll('[role="menuitem"]')].find(
				(element) => element.textContent?.includes("Rename"),
			);
			if (!rename) throw new Error("Missing Rename menu item");
			await click(rename);
			const input = container.querySelector<HTMLInputElement>("input");
			if (!input) throw new Error("Missing rename input");
			expect(document.activeElement).toBe(input);
			expect(input.selectionStart).toBe(0);
			expect(input.selectionEnd).toBe(0);
			return input;
		};
		let input = await startRename();
		await act(async () =>
			input.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			),
		);
		expect(container.querySelector("input")).toBeNull();
		expect(history.renameThread).not.toHaveBeenCalled();
		input = await startRename();
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set;
			setter?.call(input, "Renamed session");
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await act(async () =>
			input.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					cancelable: true,
				}),
			),
		);
		expect(history.renameThread).toHaveBeenCalledWith(
			thread.id,
			"Renamed session",
		);
	});

	it("omits scheduled sessions from time and project views", async () => {
		const scheduled = {
			...makeThread("scheduled", 1),
			source: "hub-schedule",
			isScheduled: true,
		};
		const pinnedScheduled = {
			...makeThread("scheduled", 2),
			isScheduled: true,
			pinned: true,
		};
		const pinned = { ...makeThread("pinned", 1), pinned: true };
		const regular = makeThread("regular", 1);

		await act(async () => {
			root.render(
				<SidebarProvider>
					<AgentSidebar
						activeSessionId={scheduled.id}
						onHome={vi.fn()}
						onOpenCustomize={vi.fn()}
						onSettingsSectionChange={vi.fn()}
						sessionHistory={makeSessionHistory(
							[scheduled, pinnedScheduled, pinned, regular],
							vi.fn(),
						)}
						setView={vi.fn()}
						settingsSection="General"
						view="chat"
					/>
				</SidebarProvider>,
			);
		});

		expect(sessionIsVisible("scheduled session 1")).toBe(false);
		expect(sessionIsVisible("scheduled session 2")).toBe(false);
		expect(sessionIsVisible("pinned session 1")).toBe(true);
		expect(sessionIsVisible("regular session 1")).toBe(true);
		const pinnedHeader = buttonWithText("Pinned");
		const tasksHeader = buttonWithText("Tasks");
		expect(
			pinnedHeader.compareDocumentPosition(tasksHeader) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		await switchToProjectSort();
		expect(sessionIsVisible("scheduled session 1")).toBe(false);
		expect(sessionIsVisible("scheduled session 2")).toBe(false);
		expect(sessionIsVisible("pinned session 1")).toBe(true);
		expect(sessionIsVisible("regular session 1")).toBe(true);
	});

	it("deletes a session through the row's hover trash button", async () => {
		const deleteThread = vi.fn(async () => undefined);
		const sessionHistory = makeSessionHistory(
			[makeThread("alpha", 1)],
			vi.fn(),
		);
		(sessionHistory as { deleteThread: unknown }).deleteThread = deleteThread;

		await act(async () => {
			root.render(
				<SidebarProvider>
					<AgentSidebar
						activeSessionId={null}
						onHome={vi.fn()}
						onOpenCustomize={vi.fn()}
						onSettingsSectionChange={vi.fn()}
						sessionHistory={sessionHistory}
						setView={vi.fn()}
						settingsSection="General"
						view="chat"
					/>
				</SidebarProvider>,
			);
		});

		// The trash affordance is a sibling of the row button (buttons cannot
		// nest) and opens the same confirmation dialog as the context menu.
		const deleteButton = container.querySelector<HTMLButtonElement>(
			'[aria-label="Delete alpha session 1"]',
		);
		expect(deleteButton).not.toBeNull();
		expect(deleteButton?.closest("button")).toBe(deleteButton);
		await click(deleteButton as HTMLButtonElement);

		const confirm = await vi.waitFor(() => {
			const button = [...document.body.querySelectorAll("button")].find(
				(candidate) => candidate.textContent === "Delete",
			);
			expect(button).toBeDefined();
			return button as HTMLButtonElement;
		});
		expect(document.body.textContent).toContain("Delete session?");
		// A regular workspace: nothing but history goes away.
		expect(document.body.textContent).not.toContain("git worktree");
		await click(confirm);
		expect(deleteThread).toHaveBeenCalledWith("alpha-1");
	});

	it("warns that deleting a task-worktree session also removes its worktree", async () => {
		registerTaskWorktreeRoot("/home/host/cline-dir/worktrees");
		try {
			const thread = {
				...makeThread("alpha", 1),
				workspacePath: "/home/host/cline-dir/worktrees/ab12c/alpha",
			};
			const sessionHistory = makeSessionHistory([thread], vi.fn());

			await act(async () => {
				root.render(
					<SidebarProvider>
						<AgentSidebar
							activeSessionId={null}
							onHome={vi.fn()}
							onOpenCustomize={vi.fn()}
							onSettingsSectionChange={vi.fn()}
							sessionHistory={sessionHistory}
							setView={vi.fn()}
							settingsSection="General"
							view="chat"
						/>
					</SidebarProvider>,
				);
			});

			await click(
				container.querySelector(
					'[aria-label="Delete alpha session 1"]',
				) as HTMLButtonElement,
			);

			await vi.waitFor(() => {
				expect(document.body.textContent).toContain("Delete session?");
			});
			expect(document.body.textContent).toContain(TASK_WORKTREE_DELETE_WARNING);
		} finally {
			registerTaskWorktreeRoot("");
		}
	});

	it("pins sessions to the top of their project group in project sort", async () => {
		const pinned = { ...makeThread("alpha", 3), pinned: true };
		const threads = [makeThread("alpha", 1), makeThread("alpha", 2), pinned];

		await act(async () => {
			root.render(
				<SidebarProvider>
					<AgentSidebar
						activeSessionId={null}
						onHome={vi.fn()}
						onOpenCustomize={vi.fn()}
						onSettingsSectionChange={vi.fn()}
						sessionHistory={makeSessionHistory(threads, vi.fn())}
						setView={vi.fn()}
						settingsSection="General"
						view="chat"
					/>
				</SidebarProvider>,
			);
		});

		await switchToProjectSort();

		// The pinned session leads its project group despite being the oldest
		// entry in history order, and carries the pin icon inline; project
		// sort has no Pinned section header.
		const pinnedRow = sessionRow("alpha session 3");
		expect(pinnedRow.querySelector('[aria-label="Pinned"]')).not.toBeNull();
		for (const title of ["alpha session 1", "alpha session 2"]) {
			expect(
				pinnedRow.compareDocumentPosition(sessionRow(title)) &
					Node.DOCUMENT_POSITION_FOLLOWING,
			).toBeTruthy();
		}
		expect(container.textContent).not.toContain("Pinned");
	});

	it("loads older history only on explicit Show more clicks", async () => {
		const tasks = Array.from({ length: 5 }, (_, index) =>
			makeThread("plain", index + 1),
		);
		const loadOlderSessions = vi.fn(async () => false);
		const renderSidebar = async (isLoadingMore: boolean) => {
			await act(async () => {
				root.render(
					<SidebarProvider>
						<AgentSidebar
							activeSessionId={null}
							onHome={vi.fn()}
							onOpenCustomize={vi.fn()}
							onSettingsSectionChange={vi.fn()}
							sessionHistory={makeSessionHistory(tasks, vi.fn(), {
								isLoadingMore,
								loadOlderSessions,
								mayHaveMoreSessions: true,
							})}
							setView={vi.fn()}
							settingsSection="General"
							view="chat"
						/>
					</SidebarProvider>,
				);
			});
		};

		await renderSidebar(false);
		await click(buttonWithText("Show more"));
		expect(loadOlderSessions).toHaveBeenCalledOnce();

		// A settled fetch never triggers an automatic follow-up request; only
		// another explicit click asks for more history.
		await renderSidebar(true);
		await renderSidebar(false);
		expect(loadOlderSessions).toHaveBeenCalledOnce();

		await click(buttonWithText("Show more"));
		expect(loadOlderSessions).toHaveBeenCalledTimes(2);
	});

	it("keeps a flat session list when nothing is pinned", async () => {
		await act(async () => {
			root.render(
				<SidebarProvider>
					<AgentSidebar
						activeSessionId={null}
						onHome={vi.fn()}
						onOpenCustomize={vi.fn()}
						onSettingsSectionChange={vi.fn()}
						sessionHistory={makeSessionHistory(
							[makeThread("plain", 1)],
							vi.fn(),
						)}
						setView={vi.fn()}
						settingsSection="General"
						view="chat"
					/>
				</SidebarProvider>,
			);
		});

		expect(sessionIsVisible("plain session 1")).toBe(true);
		expect(container.textContent).not.toContain("Pinned");
		expect(container.textContent).not.toContain("Scheduled");
		expect(container.textContent).not.toContain("Tasks");
	});

	it("defaults to all sources and filters by the selected client source", async () => {
		const desktop = { ...makeThread("desktop", 1), source: "desktop" };
		const cli = { ...makeThread("cli", 1), source: "cli" };
		const scheduled = {
			...makeThread("scheduled", 1),
			isScheduled: true,
			source: "hub-schedule",
		};

		await act(async () => {
			root.render(
				<SidebarProvider>
					<AgentSidebar
						activeSessionId={null}
						onHome={vi.fn()}
						onOpenCustomize={vi.fn()}
						onSettingsSectionChange={vi.fn()}
						sessionHistory={makeSessionHistory(
							[desktop, cli, scheduled],
							vi.fn(),
						)}
						setView={vi.fn()}
						settingsSection="General"
						view="chat"
					/>
				</SidebarProvider>,
			);
		});

		expect(sessionIsVisible("desktop session 1")).toBe(true);
		expect(sessionIsVisible("cli session 1")).toBe(true);
		expect(sessionIsVisible("scheduled session 1")).toBe(false);

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
		expect(
			[
				...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
			].some((option) => option.textContent === "Hub Schedule"),
		).toBe(false);
		await click(cliOption);

		expect(sessionIsVisible("desktop session 1")).toBe(false);
		expect(sessionIsVisible("cli session 1")).toBe(true);
	});

	it("keeps the loading state until the first history response arrives", async () => {
		await act(async () => {
			root.render(
				<SidebarProvider>
					<AgentSidebar
						activeSessionId={null}
						onHome={vi.fn()}
						onOpenCustomize={vi.fn()}
						onSettingsSectionChange={vi.fn()}
						sessionHistory={makeSessionHistory([], vi.fn(), {
							hasLoadedHistory: false,
						})}
						setView={vi.fn()}
						settingsSection="General"
						view="chat"
					/>
				</SidebarProvider>,
			);
		});

		// Before the backend has answered, an empty list means "still loading",
		// never "no sessions": the definitive copy would read as lost history.
		expect(container.textContent).toContain("Loading session history...");
		expect(container.textContent).not.toContain("No sessions found in history");
	});

	it("shows the empty state only after the backend answered with zero sessions", async () => {
		await act(async () => {
			root.render(
				<SidebarProvider>
					<AgentSidebar
						activeSessionId={null}
						onHome={vi.fn()}
						onOpenCustomize={vi.fn()}
						onSettingsSectionChange={vi.fn()}
						sessionHistory={makeSessionHistory([], vi.fn(), {
							hasLoadedHistory: true,
						})}
						setView={vi.fn()}
						settingsSection="General"
						view="chat"
					/>
				</SidebarProvider>,
			);
		});

		expect(container.textContent).toContain("No sessions found in history");
		expect(container.textContent).not.toContain("Loading session history...");
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

	it("labels a cloud session by repository", () => {
		expect(
			getSessionOverviewItems({
				...makeThread("cloud", 1),
				origin: "cloud",
				repoUrl: "https://github.com/cline/cline",
				workspacePath: "https://github.com/cline/cline",
			}),
		).toContainEqual([
			"Repository",
			"https://github.com/cline/cline",
			"https://github.com/cline/cline",
		]);
	});

	it("shows the full first line of the session title", () => {
		const firstLine =
			"This is a complete session title that is intentionally longer than seventy characters for the hover overview";
		expect(getSessionOverviewTitle(`${firstLine}\nSecond line`)).toBe(
			firstLine,
		);
	});

	it("defaults to a time-sorted list and groups by project after switching sort", async () => {
		const threads = [
			...Array.from({ length: 35 }, (_, index) =>
				makeThread("alpha", index + 1),
			),
			...Array.from({ length: 35 }, (_, index) =>
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
						onOpenCustomize={vi.fn()}
						onSettingsSectionChange={vi.fn()}
						sessionHistory={sessionHistory}
						setView={vi.fn()}
						settingsSection="General"
						view="chat"
					/>
				</SidebarProvider>,
			);
		});

		// The default view is a flat time-sorted list showing the first page
		// of 30 rows.
		expect(
			container.querySelector('[aria-label="Sort sessions: Time"]'),
		).not.toBeNull();
		expect(sessionIsVisible("alpha session 30")).toBe(true);
		expect(sessionIsVisible("alpha session 31")).toBe(false);
		expect(sessionIsVisible("beta session 1")).toBe(false);

		// The first page grows purely from already-loaded sessions (70 loaded,
		// 60 requested), so no history fetch is needed.
		await click(buttonWithText("Show more"));
		expect(sessionIsVisible("alpha session 31")).toBe(true);
		expect(loadMoreSessions).not.toHaveBeenCalled();
		expect(loadOlderSessions).not.toHaveBeenCalled();

		await switchToProjectSort();
		expect(container.textContent).toContain("alpha");
		expect(container.textContent).toContain("beta");
		expect(sessionIsVisible("beta session 30")).toBe(true);
		expect(sessionIsVisible("beta session 31")).toBe(false);
		expect(sessionIsVisible("alpha session 31")).toBe(false);

		// Expanding one project leaves the others' pagination untouched.
		await click(buttonWithText("Show more in alpha"));
		expect(sessionIsVisible("alpha session 31")).toBe(true);
		expect(sessionIsVisible("beta session 31")).toBe(false);
		expect(loadMoreSessions).not.toHaveBeenCalled();

		// The trailing Show more button grows the loaded history window.
		const globalShowMore = [
			...container.querySelectorAll<HTMLButtonElement>("button"),
		].find((button) => button.textContent?.trim() === "Show more");
		expect(globalShowMore).toBeDefined();
		await click(globalShowMore as HTMLButtonElement);
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
							onOpenCustomize={vi.fn()}
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
							onOpenCustomize={vi.fn()}
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

	it("opens the General settings section from the gear in any section", async () => {
		invoke.mockResolvedValue(signedInUser);
		const onSettingsSectionChange = vi.fn();

		const renderSidebar = async (settingsSection: "Account" | "General") => {
			await act(async () => {
				root.render(
					<AccountProvider>
						<SidebarProvider>
							<AgentSidebar
								activeSessionId={null}
								onHome={vi.fn()}
								onOpenCustomize={vi.fn()}
								onSettingsSectionChange={onSettingsSectionChange}
								sessionHistory={makeSessionHistory([], vi.fn())}
								setView={vi.fn()}
								settingsSection={settingsSection}
								view="settings"
							/>
						</SidebarProvider>
					</AccountProvider>,
				);
			});
			return vi.waitFor(() => {
				const button = container.querySelector('[aria-label="Settings"]');
				expect(button).not.toBeNull();
				return button as HTMLButtonElement;
			});
		};

		// The Account screen leaves the gear un-highlighted, but clicking it
		// still navigates to General rather than acting as a no-op.
		// (split on spaces: the variant's hover:bg-surface-hover would match a
		// plain substring check)
		const gearOnAccount = await renderSidebar("Account");
		expect(gearOnAccount.className.split(" ")).not.toContain(
			"bg-surface-hover",
		);
		await click(gearOnAccount);
		expect(onSettingsSectionChange).toHaveBeenCalledWith("General");

		const gearOnGeneral = await renderSidebar("General");
		expect(gearOnGeneral.className.split(" ")).toContain("bg-surface-hover");
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
							onOpenCustomize={vi.fn()}
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
							onOpenCustomize={vi.fn()}
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
							onOpenCustomize={vi.fn()}
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

	it("stacks New, Schedule, and Customize as full-width rows below the logo", async () => {
		const onHome = vi.fn();
		const onOpenCustomize = vi.fn();
		const onSettingsSectionChange = vi.fn();
		const setView = vi.fn();
		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider>
						<AgentSidebar
							activeSessionId={null}
							onHome={onHome}
							onOpenCustomize={onOpenCustomize}
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

		const logo = container.querySelector('[aria-label="Cline home"]');
		const actionsNav = container.querySelector(
			'[aria-label="Sidebar actions"]',
		);
		expect(logo).not.toBeNull();
		expect(actionsNav).not.toBeNull();
		// The rows read as labeled full-width entries stacked outside the
		// logo row, not ambiguous icons in the header cluster.
		const rows = [
			...(actionsNav?.querySelectorAll<HTMLButtonElement>("button") ?? []),
		];
		expect(rows.map((row) => row.textContent)).toEqual([
			"Session",
			"Schedule",
			"Customize",
		]);
		for (const row of rows) {
			expect(row.className).toContain("w-full");
		}
		expect(actionsNav?.contains(logo as Element)).toBe(false);

		await click(buttonWithText("Session", actionsNav as ParentNode));
		expect(onHome).toHaveBeenCalledOnce();
		await click(buttonWithText("Schedule", actionsNav as ParentNode));
		expect(setView).toHaveBeenCalledExactlyOnceWith("schedules");
		await click(buttonWithText("Customize", actionsNav as ParentNode));
		expect(onOpenCustomize).toHaveBeenCalledOnce();
		expect(onSettingsSectionChange).not.toHaveBeenCalled();
	});

	it.each([
		{ defaultOpen: true, event: "schedule.execution_completed" },
		{ defaultOpen: true, event: "schedule.execution_failed" },
		{ defaultOpen: false, event: "schedule.execution_completed" },
	] as const)("keeps the Schedule dot until navigation completes after $event when defaultOpen=$defaultOpen", async ({
		defaultOpen,
		event,
	}) => {
		const setView = vi.fn();
		function RunStatus() {
			const unread = useHasUnreadScheduleRun("schedule-2");
			return (
				<output aria-label="Run status">{unread ? "unread" : "read"}</output>
			);
		}
		const render = (view: DesktopAppView, pageLoaded = false) =>
			act(async () => {
				root.render(
					<AccountProvider>
						<SidebarProvider defaultOpen={defaultOpen}>
							<AgentSidebar
								activeSessionId={null}
								onHome={vi.fn()}
								onOpenCustomize={vi.fn()}
								onSettingsSectionChange={vi.fn()}
								sessionHistory={makeSessionHistory([], vi.fn())}
								setView={setView}
								settingsSection="General"
								view={view}
							/>
							{pageLoaded && <RunStatus />}
						</SidebarProvider>
					</AccountProvider>,
				);
			});
		await render("chat");

		const scheduleButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Schedule"]',
		);
		expect(scheduleButton).not.toBeNull();
		expect(
			scheduleButton?.querySelector('[data-schedule-run-status="unread"]'),
		).toBeNull();

		await emitDesktopEvent(event, {
			executionId: "execution-1",
			scheduleId: "schedule-1",
		});

		const indicator = scheduleButton?.querySelector(
			'[data-schedule-run-status="unread"]',
		);
		expect(indicator?.classList.contains("bg-cline-ui-info-solid")).toBe(true);
		expect(indicator?.classList.contains("absolute")).toBe(!defaultOpen);

		await click(scheduleButton as HTMLButtonElement);
		expect(setView).toHaveBeenCalledExactlyOnceWith("schedules");
		// Requesting navigation can be canceled by an unsaved-changes guard.
		expect(
			scheduleButton?.querySelector('[data-schedule-run-status="unread"]'),
		).not.toBeNull();
		await render("schedules");
		expect(
			scheduleButton?.querySelector('[data-schedule-run-status="unread"]'),
		).toBeNull();
		// The lazy page must receive runs completed before its chunk mounts.
		await emitDesktopEvent(event, { scheduleId: "schedule-2" });
		await render("schedules", true);
		expect(
			container.querySelector('[aria-label="Run status"]')?.textContent,
		).toBe("unread");
		expect(
			scheduleButton?.querySelector('[data-schedule-run-status="unread"]'),
		).toBeNull();
	});

	it.each([
		{ sortMode: "time", pageLabel: "Customize" },
		{ sortMode: "project", pageLabel: "Customize" },
		{ sortMode: "time", pageLabel: "Schedule" },
		{ sortMode: "project", pageLabel: "Schedule" },
	] as const)("preserves the $sortMode session list when $pageLabel opens", async ({
		sortMode,
		pageLabel,
	}) => {
		const onOpenCustomize = vi.fn();
		const onSettingsSectionChange = vi.fn();
		const sessionHistory = makeSessionHistory(
			[makeThread("alpha", 1), makeThread("beta", 1)],
			vi.fn(),
		);
		function NavigationHarness() {
			const [view, setView] = useState<DesktopAppView>("chat");
			return (
				<AgentSidebar
					activeSessionId="alpha-1"
					onHome={vi.fn()}
					onOpenCustomize={() => {
						onOpenCustomize();
						setView("customize");
					}}
					onSettingsSectionChange={onSettingsSectionChange}
					sessionHistory={sessionHistory}
					setView={setView}
					settingsSection="General"
					view={view}
				/>
			);
		}
		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider>
						<NavigationHarness />
					</SidebarProvider>
				</AccountProvider>,
			);
		});
		if (sortMode === "project") {
			await switchToProjectSort();
			await click(buttonWithText("beta"));
			expect(sessionIsVisible("beta session 1")).toBe(false);
		}
		const row = sessionRow("alpha session 1");
		const viewport = row.closest<HTMLElement>(
			'[data-slot="scroll-area-viewport"]',
		);
		if (!viewport) throw new Error("Missing session list viewport");
		viewport.scrollTop = 180;

		const actionsNav = container.querySelector(
			'[aria-label="Sidebar actions"]',
		) as ParentNode;
		const pageRow = buttonWithText(pageLabel, actionsNav);
		expect(
			[...actionsNav.querySelectorAll("button")].map(
				(button) => button.textContent,
			),
		).toEqual(["Session", "Schedule", "Customize"]);
		await click(pageRow);
		expect(onOpenCustomize).toHaveBeenCalledTimes(
			pageLabel === "Customize" ? 1 : 0,
		);
		expect(onSettingsSectionChange).not.toHaveBeenCalled();
		expect(
			container.querySelector('[aria-label="Settings sections"]'),
		).toBeNull();
		expect(pageRow.getAttribute("aria-current")).toBe("page");
		expect(pageRow.className.split(" ")).toContain("bg-surface-hover");
		expect(
			buttonWithText(
				pageLabel === "Customize" ? "Schedule" : "Customize",
				actionsNav,
			).getAttribute("aria-current"),
		).toBeNull();
		expect(
			container.querySelector('[aria-label="Settings"]')?.className.split(" "),
		).not.toContain("bg-surface-hover");
		expect(sessionRow("alpha session 1")).toBe(row);
		expect(row.closest('[data-slot="scroll-area-viewport"]')).toBe(viewport);
		expect(viewport.scrollTop).toBe(180);
		if (sortMode === "project") {
			expect(
				container.querySelector('[aria-label="Sort sessions: Project"]'),
			).not.toBeNull();
			expect(sessionIsVisible("beta session 1")).toBe(false);
		}
		await click(row);
		expect(sessionHistory.openThread).toHaveBeenCalledWith("alpha-1");
	});

	it("groups Cline Account, Local, and BYOK under a Provider row", async () => {
		const onSettingsSectionChange = vi.fn();
		const renderSidebar = async (
			section: "General" | "Local Models",
		): Promise<ParentNode> => {
			await act(async () => {
				root.render(
					<AccountProvider>
						<SidebarProvider>
							<AgentSidebar
								activeSessionId={null}
								onHome={vi.fn()}
								onOpenCustomize={vi.fn()}
								onSettingsSectionChange={onSettingsSectionChange}
								sessionHistory={makeSessionHistory([], vi.fn())}
								setView={vi.fn()}
								settingsSection={section}
								view="settings"
							/>
						</SidebarProvider>
					</AccountProvider>,
				);
			});
			return container.querySelector(
				'[aria-label="Settings sections"]',
			) as ParentNode;
		};

		const closedNav = await renderSidebar("General");
		expect(closedNav.querySelector('[aria-label="BYOK"]')).toBeNull();
		// The Provider row opens the sub-page for the provider the chat uses.
		for (const [lastProvider, expected] of [
			["", "Account"],
			["cline-pass", "Account"],
			["ollama", "Local Models"],
			["anthropic", "Providers"],
		] as const) {
			window.localStorage.setItem(
				MODEL_SELECTION_STORAGE_KEY,
				JSON.stringify({ lastProvider, lastModelByProvider: {} }),
			);
			await click(buttonWithText("Provider", closedNav));
			expect(onSettingsSectionChange).toHaveBeenLastCalledWith(expected);
		}

		const openNav = await renderSidebar("Local Models");
		expect(buttonWithText("Local", openNav).getAttribute("aria-current")).toBe(
			"page",
		);
		expect(buttonWithText("Provider", openNav).className.split(" ")).toContain(
			"bg-surface-hover-lighter",
		);
		await click(buttonWithText("BYOK", openNav));
		expect(onSettingsSectionChange).toHaveBeenCalledWith("Providers");
	});

	it("highlights the New row only while the new-task page is active", async () => {
		const renderSidebar = async (newTaskActive: boolean) => {
			await act(async () => {
				root.render(
					<AccountProvider>
						<SidebarProvider>
							<AgentSidebar
								activeSessionId={null}
								newTaskActive={newTaskActive}
								onHome={vi.fn()}
								onOpenCustomize={vi.fn()}
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
			return buttonWithText(
				"Session",
				container.querySelector('[aria-label="Sidebar actions"]') as ParentNode,
			);
		};

		const activeRow = await renderSidebar(true);
		expect(activeRow.className.split(" ")).toContain("bg-surface-hover");
		expect(activeRow.getAttribute("aria-current")).toBe("page");

		const inactiveRow = await renderSidebar(false);
		expect(inactiveRow.className.split(" ")).not.toContain("bg-surface-hover");
		expect(inactiveRow.getAttribute("aria-current")).toBeNull();
	});

	it("opens the global search command bar from the logo-row icon without loading full history", async () => {
		const sessionHistory = makeSessionHistory(
			[makeThread("alpha", 1), makeThread("beta", 1)],
			vi.fn(),
		);
		const onOpenSearch = vi.fn();
		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider>
						<AgentSidebar
							activeSessionId={null}
							onHome={vi.fn()}
							onOpenSearch={onOpenSearch}
							onOpenCustomize={vi.fn()}
							onSettingsSectionChange={vi.fn()}
							sessionHistory={sessionHistory}
							setView={vi.fn()}
							settingsSection="General"
							view="chat"
						/>
					</SidebarProvider>
				</AccountProvider>,
			);
		});

		// Search lives behind the logo-row icon, not an inline sidebar input.
		expect(container.querySelector("input")).toBeNull();
		const searchButton = container.querySelector(
			'button[aria-label="Search sessions"]',
		);
		expect(searchButton).not.toBeNull();
		await click(searchButton as Element);
		// The icon opens the indexed command bar owned by the page shell...
		expect(onOpenSearch).toHaveBeenCalledOnce();
		// ...instead of a sidebar-local dialog that eagerly pulled the entire
		// session history just to filter titles client-side.
		expect(sessionHistory.loadAllSessions).not.toHaveBeenCalled();
		expect(document.querySelector('[data-slot="command-input"]')).toBeNull();
	});

	it("uses only the Cline logo for home in the collapsed sidebar", async () => {
		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider defaultOpen={false}>
						<AgentSidebar
							activeSessionId={null}
							onHome={vi.fn()}
							onOpenCustomize={vi.fn()}
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
		expect(
			container.querySelector('[aria-label="Sidebar actions"]'),
		).toBeNull();
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
							onOpenCustomize={vi.fn()}
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

	it.each([
		"chat",
		"sessions",
		"settings",
		"customize",
		"schedules",
	] as const)("keeps Customize and Schedule separate in the collapsed %s sidebar", async (view) => {
		const onOpenCustomize = vi.fn();
		const onSettingsSectionChange = vi.fn();
		const setView = vi.fn();
		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider defaultOpen={false}>
						<AgentSidebar
							activeSessionId={null}
							onHome={vi.fn()}
							onOpenCustomize={onOpenCustomize}
							onSettingsSectionChange={onSettingsSectionChange}
							sessionHistory={makeSessionHistory([], vi.fn())}
							setView={setView}
							settingsSection="General"
							view={view}
						/>
					</SidebarProvider>
				</AccountProvider>,
			);
		});

		const settingsNav = container.querySelector(
			'[aria-label="Settings sections"]',
		);
		expect(settingsNav !== null).toBe(view === "settings");
		const customizeButtons = container.querySelectorAll(
			'button[aria-label="Customize"]',
		);
		expect(customizeButtons).toHaveLength(1);
		const customizeButton = customizeButtons[0] as HTMLButtonElement;
		expect(settingsNav?.contains(customizeButton) ?? false).toBe(false);
		expect(customizeButton.getAttribute("aria-current")).toBe(
			view === "customize" ? "page" : null,
		);
		expect(
			customizeButton.className.split(" ").includes("bg-surface-hover"),
		).toBe(view === "customize");
		await click(customizeButton);
		expect(onOpenCustomize).toHaveBeenCalledOnce();
		const scheduleButtons = container.querySelectorAll(
			'button[aria-label="Schedule"]',
		);
		expect(scheduleButtons).toHaveLength(1);
		const scheduleButton = scheduleButtons[0] as HTMLButtonElement;
		expect(settingsNav?.contains(scheduleButton) ?? false).toBe(false);
		expect(scheduleButton.getAttribute("aria-current")).toBe(
			view === "schedules" ? "page" : null,
		);
		expect(
			scheduleButton.className.split(" ").includes("bg-surface-hover"),
		).toBe(view === "schedules");
		await click(scheduleButton);
		expect(setView).toHaveBeenCalledExactlyOnceWith("schedules");
		expect(onSettingsSectionChange).not.toHaveBeenCalled();
	});

	it("shows only the labeled Settings button when signed out", async () => {
		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider>
						<AgentSidebar
							activeSessionId={null}
							onHome={vi.fn()}
							onOpenCustomize={vi.fn()}
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
