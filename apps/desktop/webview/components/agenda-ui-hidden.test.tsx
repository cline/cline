// @vitest-environment jsdom

// Covers the shipped state of the Agenda feature: the sidebar has no Agenda
// UI at all, and with AGENDA_UI_ENABLED false (the real flag value) the
// welcome quick actions stay hidden and no agenda commands are issued. The
// feature-flag mock in welcome-chat.test.tsx forces the flag on to keep
// exercising the dormant welcome-screen UI.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSidebar } from "@/components/agent-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { WelcomeScreen } from "@/components/views/chat/welcome-chat";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import type { UseSessionHistoryResult } from "@/hooks/use-session-history";

const desktopMocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	listAgendaTasks: vi.fn(),
	getAgendaAutomationPolicy: vi.fn(),
	subscribe: vi.fn(() => () => undefined),
	subscribeTransportState: vi.fn(() => () => undefined),
}));
vi.mock("@/lib/desktop-client", () => ({ desktopClient: desktopMocks }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	desktopMocks.invoke.mockRejectedValue(new Error("not available in test"));
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: vi.fn(() => ({
			matches: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	});
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

function makeSessionHistory(): UseSessionHistoryResult {
	return {
		deleteThread: vi.fn(),
		forkThread: vi.fn(),
		hasLoadedHistory: true,
		isLoadingMore: false,
		loadAllSessions: vi.fn(async () => true),
		loadOlderSessions: vi.fn(),
		loadMoreSessions: vi.fn(),
		mayHaveMoreSessions: false,
		openThread: vi.fn(),
		pendingAction: null,
		renameThread: vi.fn(),
		threads: [],
		unreadSessionIds: new Set<string>(),
	} as unknown as UseSessionHistoryResult;
}

describe("Agenda UI hidden by default", () => {
	it("renders the sidebar without any Agenda UI and issues no agenda commands", async () => {
		await act(async () => {
			root.render(
				<SidebarProvider>
					<AgentSidebar
						onHome={vi.fn()}
						onSettingsSectionChange={vi.fn()}
						sessionHistory={makeSessionHistory()}
						setView={vi.fn()}
						settingsSection="General"
						view="chat"
					/>
				</SidebarProvider>,
			);
			await Promise.resolve();
		});

		expect(container.querySelector('[aria-label="Show Agenda"]')).toBeNull();
		expect(container.querySelector('[aria-label="Agenda"]')).toBeNull();
		expect(
			container.querySelector('[aria-label="Search sessions"]'),
		).not.toBeNull();
		expect(desktopMocks.listAgendaTasks).not.toHaveBeenCalled();
		expect(desktopMocks.getAgendaAutomationPolicy).not.toHaveBeenCalled();
	});

	it("renders the welcome screen without agenda quick actions or agenda fetches", async () => {
		await act(async () => {
			root.render(
				<WorkspaceProvider
					value={{
						workspaceRoot: "/projects/project-1",
						workspaces: ["/projects/project-1"],
						listWorkspaces: vi.fn(async () => ["/projects/project-1"]),
						refreshWorkspaces: vi.fn(async () => undefined),
						switchWorkspace: vi.fn(async () => true),
						pickWorkspaceDirectory: vi.fn(async () => null),
						selectChat: vi.fn(async () => true),
					}}
				>
					<WelcomeScreen
						active
						body={null}
						composer={null}
						gitBranch="main"
						onListGitBranches={vi.fn(async () => ({
							current: "main",
							branches: ["main"],
						}))}
						onSwitchGitBranch={vi.fn(async () => true)}
					/>
				</WorkspaceProvider>,
			);
			await Promise.resolve();
		});

		expect(container.querySelector("[data-welcome-hero]")).not.toBeNull();
		expect(desktopMocks.listAgendaTasks).not.toHaveBeenCalled();
	});
});
