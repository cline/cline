// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	formatCompactTokens,
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
	loadOlderSessions = vi.fn(),
	mayHaveMoreSessions = false,
	threads = [thread],
}: {
	openThread?: ReturnType<typeof vi.fn>;
	loadOlderSessions?: ReturnType<typeof vi.fn>;
	mayHaveMoreSessions?: boolean;
	threads?: SessionThread[];
} = {}) {
	const history = {
		deleteThread: vi.fn(),
		forkThread: vi.fn(),
		isLoadingHistory: false,
		isLoadingMore: false,
		loadOlderSessions,
		mayHaveMoreSessions,
		openThread,
		pendingAction: null,
		renameThread: vi.fn(),
		sessionById: new Map(
			threads.map((item) => [item.id, { ...session, sessionId: item.id }]),
		),
		threads,
	};
	return {
		history,
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

	const clickNext = async () => {
		const next = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Next page"]',
		);
		await act(async () => {
			next?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
	};

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
});
