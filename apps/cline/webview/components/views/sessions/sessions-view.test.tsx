// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	formatCompactTokens,
	paginationItems,
	SessionsView,
} from "@/components/views/sessions/sessions-view";
import type { SessionThread } from "@/hooks/use-session-history";
import type { SessionHistoryItem } from "@/lib/session-history";

let container: HTMLDivElement;
let root: Root;

const thread: SessionThread = {
	id: "session-1",
	title: "help me rewrite this sql",
	codebase: "ai-data-suite",
	workspacePath: "/Users/dev/ai-data-suite",
	time: "1d",
	provider: "cline-pass",
	model: "cline-pass/glm-5.2-with-a-very-long-identifier",
	inputTokens: 13_837_938,
	outputTokens: 132_579,
	status: "completed",
	isScheduled: false,
};

const session: SessionHistoryItem = {
	sessionId: thread.id,
	status: "completed",
	provider: thread.provider,
	model: thread.model,
	cwd: thread.workspacePath,
	workspaceRoot: thread.workspacePath,
	startedAt: new Date("2026-07-24T10:00:00Z").toISOString(),
	endedAt: new Date("2026-07-26T10:00:00Z").toISOString(),
};

function renderView({
	openThread = vi.fn(),
	loadAllSessions = vi.fn(async () => true),
	loadOlderSessions = vi.fn(),
	mayHaveMoreSessions = false,
	threads = [thread],
}: {
	openThread?: ReturnType<typeof vi.fn>;
	loadAllSessions?: ReturnType<typeof vi.fn>;
	loadOlderSessions?: ReturnType<typeof vi.fn>;
	mayHaveMoreSessions?: boolean;
	threads?: SessionThread[];
} = {}) {
	const history = {
		deleteThread: vi.fn(),
		forkThread: vi.fn(),
		isLoadingHistory: false,
		isLoadingMore: false,
		loadAllSessions,
		loadOlderSessions,
		mayHaveMoreSessions,
		openThread,
		pendingAction: null,
		renameThread: vi.fn(),
		setThreadPinned: vi.fn(),
		sessionById: new Map(
			threads.map((item) => [item.id, { ...session, sessionId: item.id }]),
		),
		threads,
	};
	return {
		history,
		loadAllSessions,
		loadOlderSessions,
		openThread,
		render: () =>
			act(async () => {
				root.render(
					<SessionsView
						history={
							history as unknown as React.ComponentProps<
								typeof SessionsView
							>["history"]
						}
					/>,
				);
			}),
	};
}

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

describe("formatCompactTokens", () => {
	it("abbreviates millions and thousands and leaves small counts alone", () => {
		expect(formatCompactTokens(13_837_938)).toBe("13.8m");
		expect(formatCompactTokens(132_579)).toBe("132.6k");
		expect(formatCompactTokens(17_218)).toBe("17.2k");
		expect(formatCompactTokens(11)).toBe("11");
		expect(formatCompactTokens(0)).toBe("0");
	});
});

describe("SessionsView table", () => {
	it("labels the title and time columns", async () => {
		const view = renderView();
		await view.render();

		const headers = Array.from(
			container.querySelectorAll("div > span:not(.sr-only)"),
		)
			.slice(0, 6)
			.map((node) => node.textContent);
		expect(headers).toEqual([
			"Title",
			"Workspace",
			"Model",
			"Tokens",
			"Cost",
			"Time",
		]);
	});

	it("shows compact token counts and truncates the model to a fixed row height", async () => {
		const view = renderView();
		await view.render();

		const row = container.querySelector<HTMLDivElement>('[role="button"]');
		expect(row?.textContent).toContain("13.8m/132.6k");
		const modelCell = Array.from(row?.children ?? []).find((node) =>
			node.textContent?.includes(thread.model),
		);
		expect(modelCell?.className).toContain("truncate");
		// Full value stays reachable on hover.
		expect(modelCell?.getAttribute("title")).toBe(
			`${thread.provider}:${thread.model}`,
		);
		expect(row?.parentElement?.className).toContain("h-14");
		expect(row?.parentElement?.className).not.toContain("min-h-14");
	});

	it("marks favorited sessions with a star", async () => {
		const plain = renderView();
		await plain.render();
		expect(container.querySelector('[aria-label="Favorited"]')).toBeNull();

		await act(async () => root.unmount());
		root = createRoot(container);

		const favorited = renderView({
			threads: [{ ...thread, pinned: true }],
		});
		await favorited.render();
		expect(container.querySelector('[aria-label="Favorited"]')).not.toBeNull();
	});

	it("opens a session on click but not while text is selected", async () => {
		const view = renderView({});
		await view.render();

		const row = container.querySelector<HTMLDivElement>('[role="button"]');
		expect(row).not.toBeNull();

		vi.spyOn(window, "getSelection").mockReturnValue({
			toString: () => "rewrite this sql",
		} as unknown as Selection);
		await act(async () => {
			row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(view.openThread).not.toHaveBeenCalled();

		vi.spyOn(window, "getSelection").mockReturnValue({
			toString: () => "",
		} as unknown as Selection);
		await act(async () => {
			row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(view.openThread).toHaveBeenCalledWith(thread.id);
	});

	it("loads complete history before treating search results as exhaustive", async () => {
		const view = renderView({ mayHaveMoreSessions: true });
		await view.render();

		const search = container.querySelector<HTMLInputElement>(
			'input[aria-label="Search sessions"]',
		);
		expect(search).not.toBeNull();
		await act(async () => {
			if (search) {
				const setValue = Object.getOwnPropertyDescriptor(
					HTMLInputElement.prototype,
					"value",
				)?.set;
				setValue?.call(search, "older match");
				search.dispatchEvent(new Event("input", { bubbles: true }));
			}
		});

		expect(view.loadAllSessions).toHaveBeenCalledOnce();
	});

	it("loads complete history for filters and oldest-first sorting", async () => {
		const view = renderView({ mayHaveMoreSessions: true });
		await view.render();

		const filterButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Filter sessions"]',
		);
		await act(async () => {
			filterButton?.dispatchEvent(
				new MouseEvent("pointerdown", {
					bubbles: true,
					cancelable: true,
					button: 0,
				}),
			);
		});
		expect(view.loadAllSessions).toHaveBeenCalledOnce();

		view.loadAllSessions.mockClear();
		const sortButton = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Sort sessions"]',
		);
		await act(async () => {
			sortButton?.dispatchEvent(
				new MouseEvent("pointerdown", {
					bubbles: true,
					cancelable: true,
					button: 0,
				}),
			);
		});
		const oldestItem = Array.from(
			document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
		).find((item) => item.textContent === "Oldest first");
		expect(oldestItem).not.toBeUndefined();
		await act(async () => {
			oldestItem?.click();
		});

		expect(view.loadAllSessions).toHaveBeenCalledOnce();
	});
});

describe("SessionsView pagination", () => {
	const manyThreads = Array.from({ length: 25 }, (_, index) => ({
		...thread,
		id: `session-${index}`,
		title: `Session ${index}`,
	}));

	const rowTitles = () =>
		Array.from(container.querySelectorAll('[role="button"]')).map(
			(row) => row.querySelector("span > span:last-child")?.textContent,
		);

	const clickButton = async (label: string) => {
		const button = container.querySelector<HTMLButtonElement>(
			`button[aria-label="${label}"]`,
		);
		expect(button).not.toBeNull();
		await act(async () => {
			button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
	};

	const clickNext = () => clickButton("Next page");

	it("shows ten sessions per page", async () => {
		const view = renderView({ threads: manyThreads });
		await view.render();

		expect(rowTitles()).toHaveLength(10);
		expect(rowTitles()[0]).toBe("Session 0");
		expect(container.textContent).toContain("1-10 of 25");

		await clickNext();
		expect(rowTitles()[0]).toBe("Session 10");
		expect(container.textContent).toContain("11-20 of 25");
	});

	it("only asks the backend for older sessions at the last page", async () => {
		const view = renderView({
			threads: manyThreads,
			mayHaveMoreSessions: true,
		});
		await view.render();

		await clickNext();
		await clickNext();
		expect(view.loadOlderSessions).not.toHaveBeenCalled();

		await clickNext();
		expect(view.loadOlderSessions).toHaveBeenCalledTimes(1);
	});

	it("stays on the last page when no older sessions come back", async () => {
		const view = renderView({
			threads: manyThreads,
			mayHaveMoreSessions: true,
		});
		await view.render();

		await clickNext();
		await clickNext();
		await clickNext();

		expect(container.textContent).toContain("21-25 of 25");
		expect(rowTitles()).toHaveLength(5);
	});

	it("jumps to a numbered page and back to the first page in one click", async () => {
		const view = renderView({ threads: manyThreads });
		await view.render();

		const pageButtons = Array.from(
			container.querySelectorAll('button[aria-label^="Page "]'),
		).map((button) => button.textContent);
		expect(pageButtons).toEqual(["1", "2", "3"]);
		expect(container.textContent).not.toContain("Page 1 of");

		await clickButton("Page 3");
		expect(rowTitles()[0]).toBe("Session 20");
		expect(
			container
				.querySelector('button[aria-label="Page 3"]')
				?.getAttribute("aria-current"),
		).toBe("page");

		await clickButton("First page");
		expect(rowTitles()[0]).toBe("Session 0");
		expect(
			container.querySelector<HTMLButtonElement>(
				'button[aria-label="First page"]',
			)?.disabled,
		).toBe(true);
	});
});

describe("paginationItems", () => {
	it("lists every page while the pager is short", () => {
		expect(paginationItems(1, 3)).toEqual([1, 2, 3]);
		expect(paginationItems(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
	});

	it("keeps first, last and a window around the current page", () => {
		expect(paginationItems(1, 12)).toEqual([1, 2, 3, 4, 5, "gap-end", 12]);
		expect(paginationItems(6, 12)).toEqual([
			1,
			"gap-start",
			5,
			6,
			7,
			"gap-end",
			12,
		]);
		expect(paginationItems(12, 12)).toEqual([1, "gap-start", 8, 9, 10, 11, 12]);
	});
});
