// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionHistory } from "./use-session-history";

const { invokeMock, subscribeMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
	subscribeMock: vi.fn(() => () => undefined),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		invoke: invokeMock,
		subscribe: subscribeMock,
	},
}));

type SessionHistoryHook = ReturnType<typeof useSessionHistory>;
type PendingList = {
	limit: number;
	resolve: (rows: unknown[]) => void;
	reject: (error: Error) => void;
};

function sessionRow(sessionId: string) {
	return {
		sessionId,
		status: "completed",
		provider: "cline",
		model: "glm-5.2",
		cwd: "/workspace",
		workspaceRoot: "/workspace",
		startedAt: "2026-07-20T10:00:00.000Z",
		endedAt: "2026-07-20T11:00:00.000Z",
	};
}

let container: HTMLDivElement;
let root: Root;
let current: SessionHistoryHook;
let pendingLists: PendingList[];

function HookHarness() {
	current = useSessionHistory({});
	return null;
}

/** Runs queued timers and lets the resulting promise chains settle. */
async function flush(ms = 1) {
	await act(async () => {
		vi.advanceTimersByTime(ms);
		await Promise.resolve();
	});
}

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	vi.useFakeTimers();
	pendingLists = [];
	invokeMock.mockReset();
	subscribeMock.mockClear();
	invokeMock.mockImplementation(
		async (command: string, args?: { limit?: number }) => {
			if (command === "list_discovered_sessions") {
				return await new Promise<unknown[]>((resolve, reject) => {
					pendingLists.push({ limit: args?.limit ?? 0, resolve, reject });
				});
			}
			return [];
		},
	);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("useSessionHistory refresh coalescing", () => {
	it("reuses an in-flight refresh that already covers the requested limit", async () => {
		await act(async () => {
			root.render(<HookHarness />);
		});
		await flush();
		expect(pendingLists).toHaveLength(1);
		expect(pendingLists[0].limit).toBe(50);

		let second: Promise<void> | undefined;
		await act(async () => {
			second = current.refreshSessions();
		});
		expect(pendingLists).toHaveLength(1);

		await act(async () => {
			pendingLists[0].resolve([]);
			await second;
		});
	});

	it("does not let an in-flight smaller refresh satisfy a load-more", async () => {
		await act(async () => {
			root.render(<HookHarness />);
		});
		await flush();
		expect(pendingLists).toHaveLength(1);
		expect(pendingLists[0].limit).toBe(50);

		// Click "next" while the periodic refresh is still running.
		let loadMore: Promise<void> | undefined;
		await act(async () => {
			loadMore = current.loadMoreSessions(100);
		});

		// The in-flight request only asked for 50 rows, so it must not be
		// reused: the larger batch has to be requested before load-more resolves.
		await act(async () => {
			pendingLists[0].resolve([]);
			await Promise.resolve();
		});
		expect(pendingLists).toHaveLength(2);
		expect(pendingLists[1].limit).toBe(100);

		let settled = false;
		void loadMore?.then(() => {
			settled = true;
		});
		await act(async () => {
			await Promise.resolve();
		});
		expect(settled).toBe(false);

		await act(async () => {
			pendingLists[1].resolve([]);
			await loadMore;
		});
		expect(pendingLists).toHaveLength(2);
	});
});

describe("useSessionHistory failed refresh", () => {
	async function renderWithSessions() {
		await act(async () => {
			root.render(<HookHarness />);
		});
		await flush();
		await act(async () => {
			pendingLists[0].resolve(
				Array.from({ length: 50 }, (_, index) =>
					sessionRow(`session-${index}`),
				),
			);
			await Promise.resolve();
		});
	}

	it("keeps the loaded history when the list request fails", async () => {
		await renderWithSessions();
		expect(current.sessions).toHaveLength(50);
		expect(current.mayHaveMoreSessions).toBe(true);

		let loadMore: Promise<boolean> | undefined;
		await act(async () => {
			loadMore = current.loadMoreSessions(100);
			await Promise.resolve();
		});
		expect(pendingLists[1].limit).toBe(100);

		let loaded: boolean | undefined;
		await act(async () => {
			pendingLists[1].reject(new Error("transport closed"));
			loaded = await loadMore;
		});

		// A rejected request must not read as "no sessions": the list stays put
		// and the backend is still considered to have more.
		expect(loaded).toBe(false);
		expect(current.sessions).toHaveLength(50);
		expect(current.threads).toHaveLength(50);
		expect(current.mayHaveMoreSessions).toBe(true);
	});

	it("retries the same batch after a failure instead of skipping it", async () => {
		await renderWithSessions();

		await act(async () => {
			const attempt = current.loadMoreSessions(100);
			await Promise.resolve();
			pendingLists[1].reject(new Error("transport closed"));
			await attempt;
		});

		await act(async () => {
			const retry = current.loadOlderSessions();
			await Promise.resolve();
			pendingLists[2].resolve([]);
			await retry;
		});
		expect(pendingLists[2].limit).toBe(100);
	});
});
