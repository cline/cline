// @vitest-environment jsdom

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
	window.localStorage.clear();
	invoke.mockReset();
	invoke.mockRejectedValue(new Error("No Cline account auth token found"));
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
	it("marks scheduled sessions with a clock icon in the row", async () => {
		const scheduled = {
			...makeThread("alpha", 1),
			source: "core",
			isScheduled: true,
		};
		const pinnedScheduled = {
			...makeThread("alpha", 2),
			isScheduled: true,
			pinned: true,
		};
		const regular = { ...makeThread("alpha", 3), source: "core" };

		await act(async () => {
			root.render(
				<SidebarProvider>
					<AgentSidebar
						activeSessionId={null}
						onHome={vi.fn()}
						onSettingsSectionChange={vi.fn()}
						sessionHistory={makeSessionHistory(
							[scheduled, pinnedScheduled, regular],
							vi.fn(),
						)}
						setView={vi.fn()}
						settingsSection="General"
						view="chat"
					/>
				</SidebarProvider>,
			);
		});

		// The clock marks scheduled rows inline; a pinned scheduled session
		// shows both indicators at once.
		expect(
			sessionRow("alpha session 1").querySelector('[aria-label="Scheduled"]'),
		).not.toBeNull();
		// The clock leads the row: it renders before the title text.
		// The innermost matching span is the title itself (the outer flex
		// span also carries the title text plus the icon).
		const scheduledTitle = [
			...sessionRow("alpha session 1").querySelectorAll("span"),
		]
			.filter((span) => span.textContent === "alpha session 1")
			.pop();
		expect(scheduledTitle).toBeDefined();
		expect(
			(
				sessionRow("alpha session 1").querySelector(
					'[aria-label="Scheduled"]',
				) as Element
			).compareDocumentPosition(scheduledTitle as Element) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			sessionRow("alpha session 1").querySelector('[aria-label="Pinned"]'),
		).toBeNull();
		expect(
			sessionRow("alpha session 2").querySelector('[aria-label="Scheduled"]'),
		).not.toBeNull();
		expect(
			sessionRow("alpha session 2").querySelector('[aria-label="Pinned"]'),
		).not.toBeNull();
		expect(
			sessionRow("alpha session 3").querySelector('[aria-label="Scheduled"]'),
		).toBeNull();

		// The default time view groups these rows under category sections.
		expect(buttonWithText("Pinned")).toBeDefined();
		expect(buttonWithText("Scheduled")).toBeDefined();
		expect(buttonWithText("Tasks")).toBeDefined();
	});

	it("defaults to Pinned, Scheduled, and Tasks sections sorted by time", async () => {
		const pinned = { ...makeThread("alpha", 1), pinned: true };
		const scheduled = { ...makeThread("beta", 1), isScheduled: true };
		const regular = makeThread("gamma", 1);

		await act(async () => {
			root.render(
				<SidebarProvider>
					<AgentSidebar
						activeSessionId={null}
						onHome={vi.fn()}
						onSettingsSectionChange={vi.fn()}
						sessionHistory={makeSessionHistory(
							[regular, scheduled, pinned],
							vi.fn(),
						)}
						setView={vi.fn()}
						settingsSection="General"
						view="chat"
					/>
				</SidebarProvider>,
			);
		});

		// Sections appear in Pinned, Scheduled, Tasks order.
		const pinnedHeader = buttonWithText("Pinned");
		const scheduledHeader = buttonWithText("Scheduled");
		const tasksHeader = buttonWithText("Tasks");
		expect(
			pinnedHeader.compareDocumentPosition(scheduledHeader) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			scheduledHeader.compareDocumentPosition(tasksHeader) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(sessionIsVisible("alpha session 1")).toBe(true);
		expect(sessionIsVisible("beta session 1")).toBe(true);
		expect(sessionIsVisible("gamma session 1")).toBe(true);

		// Collapsing a section hides only its own rows.
		await click(scheduledHeader);
		expect(sessionIsVisible("beta session 1")).toBe(false);
		expect(sessionIsVisible("alpha session 1")).toBe(true);
		expect(sessionIsVisible("gamma session 1")).toBe(true);
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

	it("keeps a flat session list when nothing is pinned or scheduled", async () => {
		await act(async () => {
			root.render(
				<SidebarProvider>
					<AgentSidebar
						activeSessionId={null}
						onHome={vi.fn()}
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

	it("keeps the loading state until the first history response arrives", async () => {
		await act(async () => {
			root.render(
				<SidebarProvider>
					<AgentSidebar
						activeSessionId={null}
						onHome={vi.fn()}
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
		const onSettingsSectionChange = vi.fn();
		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider>
						<AgentSidebar
							activeSessionId={null}
							onHome={onHome}
							onSettingsSectionChange={onSettingsSectionChange}
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
			"New",
			"Schedule",
			"Customize",
		]);
		for (const row of rows) {
			expect(row.className).toContain("w-full");
		}
		expect(actionsNav?.contains(logo as Element)).toBe(false);

		await click(buttonWithText("New", actionsNav as ParentNode));
		expect(onHome).toHaveBeenCalledOnce();
		await click(buttonWithText("Schedule", actionsNav as ParentNode));
		expect(onSettingsSectionChange).toHaveBeenCalledWith("Schedules");
		await click(buttonWithText("Customize", actionsNav as ParentNode));
		expect(onSettingsSectionChange).toHaveBeenCalledWith("Customize");
	});

	it("shows Installed and Marketplace sub-tabs under the open Customize row", async () => {
		const onSettingsSectionChange = vi.fn();
		const renderSidebar = async (section: "Customize" | "Marketplace") => {
			await act(async () => {
				root.render(
					<AccountProvider>
						<SidebarProvider>
							<AgentSidebar
								activeSessionId={null}
								onHome={vi.fn()}
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
		};

		await renderSidebar("Customize");
		const actionsNav = container.querySelector(
			'[aria-label="Sidebar actions"]',
		) as ParentNode;
		const installedRow = buttonWithText("Installed", actionsNav);
		const marketplaceRow = buttonWithText("Marketplace", actionsNav);
		const customizeRow = buttonWithText("Customize", actionsNav);

		// The active sub-tab carries the full selected background; the parent
		// Customize row stays marked with a subtler highlight so the two
		// simultaneous highlights read differently.
		expect(installedRow.getAttribute("aria-current")).toBe("page");
		expect(installedRow.className.split(" ")).toContain("bg-surface-hover");
		expect(customizeRow.className.split(" ")).toContain(
			"bg-surface-hover-lighter",
		);
		expect(customizeRow.className.split(" ")).not.toContain(
			"bg-surface-hover",
		);
		// Sub-tabs are indented under the parent row.
		expect(installedRow.className.split(" ")).toContain("pl-8!");

		await click(marketplaceRow);
		expect(onSettingsSectionChange).toHaveBeenCalledWith("Marketplace");
		await renderSidebar("Marketplace");
		expect(
			buttonWithText("Marketplace", actionsNav).getAttribute("aria-current"),
		).toBe("page");
		expect(
			buttonWithText("Installed", actionsNav).getAttribute("aria-current"),
		).toBeNull();
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
				"New",
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

	it("opens session search in a dialog from the logo-row icon", async () => {
		const sessionHistory = makeSessionHistory(
			[makeThread("alpha", 1), makeThread("beta", 1)],
			vi.fn(),
		);
		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider>
						<AgentSidebar
							activeSessionId={null}
							onHome={vi.fn()}
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
		// Opening search pulls the full history so unloaded sessions match too.
		expect(sessionHistory.loadAllSessions).toHaveBeenCalledOnce();

		const searchInput = await vi.waitFor(() => {
			const input = document.querySelector<HTMLInputElement>(
				'[data-slot="command-input"]',
			);
			expect(input).not.toBeNull();
			return input as HTMLInputElement;
		});
		expect(searchInput.placeholder).toBe("Search sessions...");

		await changeField(searchInput, "alpha");
		const match = await vi.waitFor(() => {
			const items = [
				...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]'),
			];
			expect(items).toHaveLength(1);
			return items[0] as HTMLElement;
		});
		expect(match.textContent).toContain("alpha session 1");

		await click(match);
		expect(sessionHistory.openThread).toHaveBeenCalledWith("alpha-1");
		await vi.waitFor(() =>
			expect(document.querySelector('[data-slot="command-input"]')).toBeNull(),
		);
	});

	it("uses only the Cline logo for home in the collapsed sidebar", async () => {
		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider defaultOpen={false}>
						<AgentSidebar
							activeSessionId={null}
							onHome={vi.fn()}
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
