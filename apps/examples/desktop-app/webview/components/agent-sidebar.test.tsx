// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSidebar } from "@/components/agent-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import type {
	SessionThread,
	UseSessionHistoryResult,
} from "@/hooks/use-session-history";

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
						sessionHistory={sessionHistory}
						setView={vi.fn()}
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
});
