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

describe("useSessionHistory session mapping", () => {
	it("maps nested Core schedule provenance onto sidebar threads", async () => {
		await act(async () => {
			root.render(<HookHarness />);
		});
		await flush();

		await act(async () => {
			pendingLists[0].resolve([
				{
					...sessionRow("scheduled-session"),
					source: "core",
					metadata: {
						sessionHistoryOrigin: {
							mode: "automation",
							trigger: "hub-schedule",
						},
					},
				},
				{
					...sessionRow("regular-session"),
					source: "core",
					metadata: { sessionHistoryOrigin: { mode: "user" } },
				},
			]);
			await Promise.resolve();
		});

		expect(
			current.threads.find((thread) => thread.id === "scheduled-session"),
		).toMatchObject({ source: "core", isScheduled: true });
		expect(
			current.threads.find((thread) => thread.id === "regular-session"),
		).toMatchObject({ source: "core", isScheduled: false });
	});

	it("marks sessions scheduled when a schedule execution names them", async () => {
		// Scheduled runs executed by the local hub don't reliably stamp the
		// hub-schedule trigger into session metadata, so the executions list
		// is the fallback signal.
		invokeMock.mockImplementation(
			async (command: string, args?: { limit?: number }) => {
				if (command === "list_discovered_sessions") {
					return await new Promise<unknown[]>((resolve, reject) => {
						pendingLists.push({ limit: args?.limit ?? 0, resolve, reject });
					});
				}
				if (command === "list_routine_schedules") {
					return {
						activeExecutions: [{ sessionId: "cron-active" }],
						lastExecutions: [{ sessionId: "cron-session" }, {}],
					};
				}
				return [];
			},
		);

		await act(async () => {
			root.render(<HookHarness />);
		});
		await flush();

		await act(async () => {
			pendingLists[0].resolve([
				{
					...sessionRow("cron-session"),
					source: "core",
					metadata: { sessionHistoryOrigin: { mode: "user" } },
				},
				{
					...sessionRow("regular-session"),
					source: "core",
					metadata: { sessionHistoryOrigin: { mode: "user" } },
				},
			]);
			await Promise.resolve();
		});

		expect(
			current.threads.find((thread) => thread.id === "cron-session"),
		).toMatchObject({ isScheduled: true });
		expect(
			current.threads.find((thread) => thread.id === "regular-session"),
		).toMatchObject({ isScheduled: false });
	});
});

describe("useSessionHistory initial load", () => {
	it("reports history as loaded only after the backend has answered", async () => {
		await act(async () => {
			root.render(<HookHarness />);
		});
		await flush();
		expect(pendingLists).toHaveLength(1);
		expect(current.hasLoadedHistory).toBe(false);

		await act(async () => {
			pendingLists[0].resolve([]);
			await Promise.resolve();
		});

		// A zero-session answer is a definitive result, not a loading state.
		expect(current.hasLoadedHistory).toBe(true);
		expect(current.threads).toHaveLength(0);
	});

	it("retries a failed initial fetch quickly instead of waiting for the poll", async () => {
		await act(async () => {
			root.render(<HookHarness />);
		});
		await flush();
		expect(pendingLists).toHaveLength(1);

		await act(async () => {
			pendingLists[0].reject(new Error("transport closed"));
			await Promise.resolve();
		});

		// The rejected request must not read as an empty history.
		expect(current.hasLoadedHistory).toBe(false);

		// The retry fires on the short event cadence (2s), well before the
		// 12s periodic poll.
		await flush(2_000);
		expect(pendingLists).toHaveLength(2);

		await act(async () => {
			pendingLists[1].resolve([sessionRow("recovered-session")]);
			await Promise.resolve();
		});
		expect(current.hasLoadedHistory).toBe(true);
		expect(current.threads).toHaveLength(1);
	});

	it("stops fast retries when the hook unmounts mid-request", async () => {
		await act(async () => {
			root.render(<HookHarness />);
		});
		await flush();
		expect(pendingLists).toHaveLength(1);

		// Unmount while the initial request is still in flight, then fail it:
		// the retry continuation must not re-arm the cleared refresh timer.
		await act(async () => root.unmount());
		await act(async () => {
			pendingLists[0].reject(new Error("transport closed"));
			await Promise.resolve();
		});

		await flush(3_000);
		expect(pendingLists).toHaveLength(1);

		// Fresh root so the shared afterEach unmount stays valid.
		root = createRoot(container);
	});

	it("does not schedule fast retries once history has loaded", async () => {
		await act(async () => {
			root.render(<HookHarness />);
		});
		await flush();
		await act(async () => {
			pendingLists[0].resolve([sessionRow("session-1")]);
			await Promise.resolve();
		});
		expect(current.hasLoadedHistory).toBe(true);

		// Advance to the periodic poll and fail it: no 2s retry may follow.
		await flush(12_000);
		expect(pendingLists).toHaveLength(2);
		await act(async () => {
			pendingLists[1].reject(new Error("transport closed"));
			await Promise.resolve();
		});
		await flush(3_000);
		expect(pendingLists).toHaveLength(2);
	});
});

describe("useSessionHistory refresh coalescing", () => {
	it("reuses an in-flight refresh that already covers the requested limit", async () => {
		await act(async () => {
			root.render(<HookHarness />);
		});
		await flush();
		expect(pendingLists).toHaveLength(1);
		expect(pendingLists[0].limit).toBe(50);

		let second: Promise<boolean> | undefined;
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
		let loadMore: Promise<boolean> | undefined;
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

	it("does not lower a limit an overlapping call already raised", async () => {
		await renderWithSessions();

		// Two "next page" clicks overlap: the first expands to 100 and is still
		// in flight when the second expands to 150.
		let first: Promise<boolean> | undefined;
		let second: Promise<boolean> | undefined;
		await act(async () => {
			first = current.loadMoreSessions(100);
			await Promise.resolve();
			second = current.loadMoreSessions(150);
			await Promise.resolve();
		});
		expect(pendingLists).toHaveLength(2);
		expect(pendingLists[1].limit).toBe(100);

		// The 100-row request fails. Rolling the shared limit back to 50 here
		// would make the waiting call fetch 50 rows and still report success.
		await act(async () => {
			pendingLists[1].reject(new Error("transport closed"));
			expect(await first).toBe(false);
			await Promise.resolve();
		});

		expect(pendingLists).toHaveLength(3);
		expect(pendingLists[2].limit).toBe(150);
		await act(async () => {
			pendingLists[2].resolve(
				Array.from({ length: 150 }, (_, index) =>
					sessionRow(`session-${index}`),
				),
			);
			expect(await second).toBe(true);
		});
		expect(current.sessions).toHaveLength(150);
	});

	it("retries the oldest unfetched batch when overlapping calls both fail", async () => {
		await renderWithSessions();

		let first: Promise<boolean> | undefined;
		let second: Promise<boolean> | undefined;
		await act(async () => {
			first = current.loadMoreSessions(100);
			await Promise.resolve();
			second = current.loadMoreSessions(150);
			await Promise.resolve();
		});

		await act(async () => {
			pendingLists[1].reject(new Error("transport closed"));
			expect(await first).toBe(false);
			await Promise.resolve();
		});
		await act(async () => {
			pendingLists[2].reject(new Error("transport closed"));
			expect(await second).toBe(false);
			await Promise.resolve();
		});

		// Neither batch landed, so the next attempt must go back to the first
		// unfetched one (100) rather than resuming from a limit that was only
		// ever requested.
		await act(async () => {
			const retry = current.loadOlderSessions();
			await Promise.resolve();
			pendingLists[3].resolve([]);
			await retry;
		});
		expect(pendingLists[3].limit).toBe(100);
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

describe("useSessionHistory complete history loading", () => {
	it("expands requests until the backend returns fewer rows than requested", async () => {
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

		let complete: Promise<boolean> | undefined;
		await act(async () => {
			complete = current.loadAllSessions();
			await Promise.resolve();
		});
		expect(pendingLists[1].limit).toBe(100);

		await act(async () => {
			pendingLists[1].resolve(
				Array.from({ length: 100 }, (_, index) =>
					sessionRow(`session-${index}`),
				),
			);
			await Promise.resolve();
		});
		expect(pendingLists[2].limit).toBe(200);

		await act(async () => {
			pendingLists[2].resolve(
				Array.from({ length: 120 }, (_, index) =>
					sessionRow(`session-${index}`),
				),
			);
			expect(await complete).toBe(true);
		});

		expect(current.sessions).toHaveLength(120);
		expect(current.mayHaveMoreSessions).toBe(false);
	});
});
