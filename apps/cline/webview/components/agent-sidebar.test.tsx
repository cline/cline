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

const { invoke, retryConnection, subscribeTransportState } = vi.hoisted(() => ({
	invoke: vi.fn(),
	retryConnection: vi.fn(),
	subscribeTransportState: vi.fn((handler: (state: string) => void) => {
		handler("connected");
		return () => undefined;
	}),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke, retryConnection, subscribeTransportState },
}));

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
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText: vi.fn(async () => undefined) },
	});
	invoke.mockReset();
	retryConnection.mockReset();
	subscribeTransportState.mockClear();
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
			source: "core",
			isScheduled: true,
		};
		const regular = { ...makeThread("regular", 1), source: "core" };

		await act(async () => {
			root.render(
				<SidebarProvider>
					<AgentSidebar
						activeSessionId={null}
						activeBotId="cline"
						bots={[{ id: "cline", name: "Cline" }]}
						canCreateBot={true}
						onCreateBot={vi.fn()}
						onSwitchBot={vi.fn()}
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
						activeBotId="cline"
						bots={[{ id: "cline", name: "Cline" }]}
						canCreateBot={true}
						onCreateBot={vi.fn()}
						onSwitchBot={vi.fn()}
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
						activeBotId="cline"
						bots={[{ id: "cline", name: "Cline" }]}
						canCreateBot={true}
						onCreateBot={vi.fn()}
						onSwitchBot={vi.fn()}
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

	it("keeps the Gateway control visible after account state loads", async () => {
		invoke.mockResolvedValue(signedInUser);

		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider>
						<AgentSidebar
							activeSessionId={null}
							activeBotId="cline"
							bots={[{ id: "cline", name: "Cline" }]}
							canCreateBot={true}
							onCreateBot={vi.fn()}
							onSwitchBot={vi.fn()}
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

		const gatewayButton = await vi.waitFor(() => {
			const button = container.querySelector(
				'button[aria-label="Gateway unavailable"]',
			);
			expect(button).not.toBeNull();
			return button;
		});
		const settingsButton = container.querySelector('[aria-label="Settings"]');
		expect(gatewayButton?.parentElement).toBe(settingsButton?.parentElement);
		expect(settingsButton?.textContent).toBe("");
	});

	it("opens Settings from the footer action", async () => {
		const setView = vi.fn();
		const onSettingsSectionChange = vi.fn();
		invoke.mockResolvedValue(signedInUser);

		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider>
						<AgentSidebar
							activeSessionId={null}
							activeBotId="cline"
							bots={[{ id: "cline", name: "Cline" }]}
							canCreateBot={true}
							onCreateBot={vi.fn()}
							onSwitchBot={vi.fn()}
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

		const settingsButton = await vi.waitFor(() => {
			const button = container.querySelector('[aria-label="Settings"]');
			expect(button).not.toBeNull();
			return button;
		});
		await click(settingsButton as Element);

		expect(onSettingsSectionChange).not.toHaveBeenCalled();
		expect(setView).toHaveBeenCalledWith("settings");
	});

	it("shows the desktop app version and an actionable connected Gateway indicator", async () => {
		invoke.mockImplementation(async (command: string) => {
			if (command === "get_process_context") {
				return {
					appVersion: "1.2.3",
					gateway: {
						dataDir: "/Users/test/.cline/gateway/desktop",
						error: null,
						historyDatabase: "/Users/test/.cline/gateway/desktop/gateway.db",
						status: "connected",
						namespace: "desktop",
						webSocketAddress: "ws://127.0.0.1:3126/",
						webSocketProtocol: "cline-desktop-v1",
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
							activeBotId="cline"
							bots={[{ id: "cline", name: "Cline" }]}
							canCreateBot={true}
							onCreateBot={vi.fn()}
							onSwitchBot={vi.fn()}
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
			expect(document.body.textContent).toContain("v1.2.3");
		});
		expect(invoke).toHaveBeenCalledWith("get_process_context");
		const statusButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Gateway connected"]',
		);
		expect(statusButton).not.toBeNull();
		expect(
			statusButton?.querySelector('[aria-hidden="true"]')?.className,
		).toContain("bg-emerald-500");
		await click(statusButton as Element);
		expect(document.body.textContent).toContain("Bundled Gateway v1.2.3");
		expect(document.body.textContent).not.toContain("Ready in the desktop");
		expect(document.body.textContent).toContain("ws://127.0.0.1:3126/");
		expect(document.body.textContent).toContain(
			"/Users/test/.cline/gateway/desktop/gateway.db",
		);
		const checkAgainButton = buttonWithText("Check again", document.body);
		const popoverSettingsButton = buttonWithText("Settings", document.body);
		expect(checkAgainButton.className).toContain("w-full");
		expect(popoverSettingsButton.className).toContain("w-full");
		expect(checkAgainButton.parentElement).toBe(
			popoverSettingsButton.parentElement,
		);
		expect(checkAgainButton.parentElement?.className).toContain("grid");
		const copyAddressButton = document.body.querySelector(
			'[aria-label="Copy Gateway WebSocket address"]',
		);
		expect(copyAddressButton).not.toBeNull();
		await click(copyAddressButton as Element);
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
			"ws://127.0.0.1:3126/",
		);
	});

	it("shows a disconnected Gateway reason and retries from the footer", async () => {
		invoke.mockImplementation(async (command: string) => {
			if (command === "get_process_context") {
				return {
					appVersion: "1.2.3",
					gateway: {
						error: "Gateway connection closed",
						status: "disconnected",
						namespace: "desktop",
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
							activeBotId="cline"
							bots={[{ id: "cline", name: "Cline" }]}
							canCreateBot={true}
							onCreateBot={vi.fn()}
							onSwitchBot={vi.fn()}
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

		const statusButton = await vi.waitFor(() => {
			const button = container.querySelector<HTMLButtonElement>(
				'button[aria-label="Gateway unavailable"]',
			);
			expect(button).not.toBeNull();
			return button as HTMLButtonElement;
		});
		expect(
			statusButton.querySelector('[aria-hidden="true"]')?.className,
		).toContain("bg-destructive");
		await click(statusButton);
		expect(document.body.textContent).toContain("Bundled Gateway v1.2.3");
		expect(document.body.textContent).toContain("Gateway connection closed");
		await click(buttonWithText("Retry connection", document.body));
		expect(retryConnection).toHaveBeenCalledOnce();
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
							activeBotId="cline"
							bots={[{ id: "cline", name: "Cline" }]}
							canCreateBot={true}
							onCreateBot={vi.fn()}
							onSwitchBot={vi.fn()}
							canNavigateBack
							canNavigateForward
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
							activeBotId="cline"
							bots={[{ id: "cline", name: "Cline" }]}
							canCreateBot={true}
							onCreateBot={vi.fn()}
							onSwitchBot={vi.fn()}
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

		const logo = container.querySelector(
			'[aria-label="Cline — switch or create bot"]',
		);
		const newSession = container.querySelector('[aria-label="New Session"]');
		expect(logo).not.toBeNull();
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
							activeBotId="cline"
							bots={[{ id: "cline", name: "Cline" }]}
							canCreateBot={true}
							onCreateBot={vi.fn()}
							onSwitchBot={vi.fn()}
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

		expect(
			container.querySelector('[aria-label="Cline — switch or create bot"]'),
		).not.toBeNull();
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
							activeBotId="cline"
							bots={[{ id: "cline", name: "Cline" }]}
							canCreateBot={true}
							onCreateBot={vi.fn()}
							onSwitchBot={vi.fn()}
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
			"Cline — switch or create bot",
			"General",
			"Account",
			"Expand sidebar",
			"Settings",
		];
		for (const label of leftAlignedButtons) {
			const button = container.querySelector(`[aria-label="${label}"]`);
			expect(button?.className).not.toContain("mx-auto");
		}
		expect(container.querySelector('[aria-label="Agents"]')).toBeNull();
		expect(
			container.querySelector('[aria-label="Expand sidebar"]')?.className,
		).toContain("mt-auto");
		expect(
			container.querySelector('[aria-label="Settings sections"]')?.className,
		).toContain("items-start");
	});

	it("shows an icon-only Settings button beside the version/status row when signed out", async () => {
		await act(async () => {
			root.render(
				<AccountProvider>
					<SidebarProvider>
						<AgentSidebar
							activeSessionId={null}
							activeBotId="cline"
							bots={[{ id: "cline", name: "Cline" }]}
							canCreateBot={true}
							onCreateBot={vi.fn()}
							onSwitchBot={vi.fn()}
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
		).toBe("");
		expect(container.textContent).toContain("Gateway");
	});
});
