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

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({ desktopClient: { invoke } }));

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

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	window.localStorage.clear();
	invoke.mockReset();
	invoke.mockRejectedValue(new Error("No Cline account auth token found"));
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
	it("filters scheduled sessions without changing their titles", async () => {
		const scheduled = {
			...makeThread("scheduled", 1),
			source: "hub-schedule",
		};
		const regular = makeThread("regular", 1);

		await act(async () => {
			root.render(
				<SidebarProvider>
					<AgentSidebar
						activeSessionId={null}
						isHomeActive
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
			["ID", "cline-5"],
			["Updated", "5m"],
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
						isHomeActive
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
		invoke.mockResolvedValue({
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
		});

		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider>
						<AgentSidebar
							activeSessionId={null}
							isHomeActive
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
	});

	it("opens the Account settings section when the footer account row is clicked", async () => {
		const setView = vi.fn();
		const onSettingsSectionChange = vi.fn();

		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider>
						<AgentSidebar
							activeSessionId={null}
							isHomeActive
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

		const accountButton = container.querySelector(
			'[aria-label="Account settings"]',
		);
		expect(accountButton).not.toBeNull();
		await click(accountButton as Element);

		expect(onSettingsSectionChange).toHaveBeenCalledWith("Account");
		expect(setView).toHaveBeenCalledWith("settings");
	});

	it("shows the desktop app version in a popover when the Cline logo is clicked", async () => {
		const onHome = vi.fn();
		invoke.mockImplementation(async (command: string) => {
			if (command === "get_process_context") {
				return { appVersion: "1.2.3" };
			}
			throw new Error("No Cline account auth token found");
		});

		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider>
						<AgentSidebar
							activeSessionId={null}
							isHomeActive
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

		await click(logoButton as Element);

		await vi.waitFor(() => {
			expect(document.body.textContent).toContain("Version 1.2.3");
		});
		expect(onHome).toHaveBeenCalled();
		expect(invoke).toHaveBeenCalledWith("get_process_context");
	});

	it("falls back to a signed-out footer without account data", async () => {
		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider>
						<AgentSidebar
							activeSessionId={null}
							isHomeActive
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
			expect(container.textContent).toContain("Cline Desktop");
		});
		expect(container.textContent).not.toContain("Local");
	});
});
