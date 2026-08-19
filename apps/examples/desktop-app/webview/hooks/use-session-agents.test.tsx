// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionAgents } from "./use-session-agents";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: invokeMock },
}));

type SessionAgentsHook = ReturnType<typeof useSessionAgents>;

let container: HTMLDivElement;
let root: Root;
let current: SessionAgentsHook;

function HookHarness({
	sessionId,
	panelOpen = false,
	sessionActive = false,
}: {
	sessionId: string | null;
	panelOpen?: boolean;
	sessionActive?: boolean;
}) {
	current = useSessionAgents({ sessionId, panelOpen, sessionActive });
	return null;
}

function runningRow(sessionIdPrefix: string, agentId: string) {
	return {
		...agentRow(sessionIdPrefix, agentId),
		status: "running",
		lastAction: "Running read_files",
	};
}

function agentRow(sessionIdPrefix: string, agentId: string) {
	return {
		sessionId: `${sessionIdPrefix}__${agentId}`,
		agentId,
		kind: "subagent",
		status: "completed",
		prompt: `task for ${agentId}`,
		startedAt: "2026-07-27T00:00:00.000Z",
		hasMessages: true,
	};
}

const render = async (props: Parameters<typeof HookHarness>[0]) => {
	await act(async () => {
		root.render(<HookHarness {...props} />);
	});
};

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	invokeMock.mockReset();
	invokeMock.mockResolvedValue([]);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

describe("useSessionAgents", () => {
	it("loads the roster for the active session", async () => {
		invokeMock.mockResolvedValue([agentRow("a", "one")]);
		await render({ sessionId: "a" });
		expect(invokeMock).toHaveBeenCalledWith("list_session_agents", {
			sessionId: "a",
		});
		expect(current.agents.map((agent) => agent.agentId)).toEqual(["one"]);
	});

	it("reads the roster even when the header is showing no agents", async () => {
		// Regression: the read used to be gated on the header tally, which is
		// derived from the newest messages only. A session whose spawn calls had
		// aged out of that window reported zero agents, so the roster was never
		// queried, so the tally stayed zero — the pill could never appear and the
		// popover that would have triggered the read could never be opened.
		invokeMock.mockResolvedValue([agentRow("a", "aged-out")]);
		await render({ sessionId: "a", panelOpen: false, sessionActive: false });
		expect(invokeMock).toHaveBeenCalledWith("list_session_agents", {
			sessionId: "a",
		});
		expect(current.agents.map((agent) => agent.agentId)).toEqual(["aged-out"]);
	});

	it("re-reads the roster when the panel is opened", async () => {
		invokeMock.mockResolvedValue([agentRow("a", "one")]);
		await render({ sessionId: "a" });
		const afterFirstRead = invokeMock.mock.calls.length;

		await render({ sessionId: "a", panelOpen: true });
		expect(invokeMock.mock.calls.length).toBeGreaterThan(afterFirstRead);
	});

	it("re-reads once a turn finishes so final statuses land", async () => {
		invokeMock.mockResolvedValue([agentRow("a", "one")]);
		await render({ sessionId: "a", sessionActive: true });
		const whileRunning = invokeMock.mock.calls.length;

		// The last poll can precede completion by up to an interval.
		await render({ sessionId: "a", sessionActive: false });
		expect(invokeMock.mock.calls.length).toBeGreaterThan(whileRunning);
	});

	it("clears the roster when switching straight to another session", async () => {
		invokeMock.mockResolvedValue([agentRow("a", "one"), agentRow("a", "two")]);
		await render({ sessionId: "a" });
		expect(current.agents).toHaveLength(2);

		// Session b has no agents of its own; a's must not carry over, or the
		// header would show them and open a's children from b.
		invokeMock.mockResolvedValue([]);
		await render({ sessionId: "b" });
		expect(current.agents).toEqual([]);
	});

	it("shows no agents while the new session's roster is still loading", async () => {
		invokeMock.mockResolvedValue([agentRow("a", "one")]);
		await render({ sessionId: "a" });
		expect(current.agents).toHaveLength(1);

		// Hold the request for `b` open: during this window the popover must not
		// still be offering a's rows, which would open a's children from b.
		let resolveSecond: ((value: unknown) => void) | undefined;
		invokeMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveSecond = resolve;
				}),
		);
		await render({ sessionId: "b" });
		expect(current.agents).toEqual([]);

		await act(async () => {
			resolveSecond?.([agentRow("b", "beta")]);
		});
		expect(current.agents.map((agent) => agent.agentId)).toEqual(["beta"]);
	});

	it("clears a stale roster even when the new session never fetches", async () => {
		invokeMock.mockResolvedValue([agentRow("a", "one")]);
		await render({ sessionId: "a" });
		expect(current.agents).toHaveLength(1);

		// Hold b's read open so nothing overwrites the roster; a's entries must
		// still not be readable under b.
		invokeMock.mockImplementationOnce(() => new Promise(() => {}));
		await render({ sessionId: "b" });
		expect(current.agents).toEqual([]);
	});

	it("clears the roster when the session goes away", async () => {
		invokeMock.mockResolvedValue([agentRow("a", "one")]);
		await render({ sessionId: "a" });
		expect(current.agents).toHaveLength(1);

		await render({ sessionId: null });
		expect(current.agents).toEqual([]);
	});

	it("ignores a response that resolves after the session changed", async () => {
		let resolveFirst: ((value: unknown) => void) | undefined;
		invokeMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveFirst = resolve;
				}),
		);
		await render({ sessionId: "a" });

		invokeMock.mockResolvedValue([agentRow("b", "beta")]);
		await render({ sessionId: "b" });

		// The slow request for `a` lands last and must be discarded.
		await act(async () => {
			resolveFirst?.([agentRow("a", "stale")]);
		});
		expect(current.agents.map((agent) => agent.agentId)).toEqual(["beta"]);
	});

	it("cannot resurrect a session's roster after switching away", async () => {
		// A response that lands for a session no longer displayed is unreadable
		// rather than merely guarded against, so no ordering can surface it.
		let resolveFirst: ((value: unknown) => void) | undefined;
		invokeMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveFirst = resolve;
				}),
		);
		await render({ sessionId: "a" });

		// Hold b's read open, so only the late response for `a` could surface.
		invokeMock.mockImplementationOnce(() => new Promise(() => {}));
		await render({ sessionId: "b" });
		await act(async () => {
			resolveFirst?.([agentRow("a", "stale")]);
		});
		expect(current.agents).toEqual([]);

		// Returning to `a` is a fresh load, not the leaked response.
		invokeMock.mockResolvedValue([agentRow("a", "one")]);
		await render({ sessionId: "a" });
		expect(current.agents.map((agent) => agent.agentId)).toEqual(["one"]);
	});

	it("ignores an older overlapping read that resolves last", async () => {
		// Two reads for the SAME session can overlap: a poll tick alongside an
		// on-open or turn-finished read. A session-id-only guard admits both, so
		// arrival order decides — and an older snapshot landing last would revert
		// what the newer one already reported.
		let resolveOlder: ((value: unknown) => void) | undefined;
		let resolveNewer: ((value: unknown) => void) | undefined;
		invokeMock
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveOlder = resolve;
					}),
			)
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						resolveNewer = resolve;
					}),
			);

		await render({ sessionId: "a" });
		await act(async () => {
			void current.refresh("a");
		});

		// Newer read lands first and reports both agents finished.
		await act(async () => {
			resolveNewer?.([agentRow("a", "one"), agentRow("a", "two")]);
		});
		expect(current.agents.map((agent) => agent.agentId)).toEqual([
			"one",
			"two",
		]);

		// The older read lands last, still describing an earlier moment.
		await act(async () => {
			resolveOlder?.([runningRow("a", "one")]);
		});
		expect(current.agents.map((agent) => agent.agentId)).toEqual([
			"one",
			"two",
		]);
	});

	it("does not let a stale read revert a completed agent to running", async () => {
		let resolveOlder: ((value: unknown) => void) | undefined;
		invokeMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveOlder = resolve;
				}),
		);
		await render({ sessionId: "a" });

		invokeMock.mockResolvedValue([agentRow("a", "one")]);
		await act(async () => {
			await current.refresh("a");
		});
		expect(current.agents[0]?.status).toBe("completed");

		await act(async () => {
			resolveOlder?.([runningRow("a", "one")]);
		});
		expect(current.agents[0]?.status).toBe("completed");
		expect(current.agents[0]?.lastAction).toBeUndefined();
	});

	it("does not let a stale failure clobber a newer successful read", async () => {
		let rejectOlder: ((reason: unknown) => void) | undefined;
		invokeMock.mockImplementationOnce(
			() =>
				new Promise((_resolve, reject) => {
					rejectOlder = reject;
				}),
		);
		await render({ sessionId: "a" });

		invokeMock.mockResolvedValue([agentRow("a", "one")]);
		await act(async () => {
			await current.refresh("a");
		});

		await act(async () => {
			rejectOlder?.(new Error("stale failure"));
		});
		expect(current.error).toBeNull();
		expect(current.agents).toHaveLength(1);
	});

	it("reports a roster failure without dropping the header tally", async () => {
		invokeMock.mockRejectedValue(new Error("no session database"));
		await render({ sessionId: "a" });
		expect(current.agents).toEqual([]);
		expect(current.error).toBe("no session database");
	});

	it("keeps a loaded roster when a later refresh fails", async () => {
		// A transient sidecar/SQLite error means this read learned nothing, not
		// that the agents vanished. Blanking them is unrecoverable on an idle
		// session: nothing polls, and if the roster was the only source of agents
		// the pill disappears along with the popover that would re-read it.
		invokeMock.mockResolvedValue([agentRow("a", "one"), agentRow("a", "two")]);
		await render({ sessionId: "a" });
		expect(current.agents).toHaveLength(2);

		invokeMock.mockRejectedValue(new Error("database is locked"));
		await act(async () => {
			await current.refresh("a", { quiet: true });
		});
		expect(current.agents.map((agent) => agent.agentId)).toEqual([
			"one",
			"two",
		]);
		expect(current.error).toBe("database is locked");
	});

	it("does not carry entries across sessions when a refresh fails", async () => {
		invokeMock.mockResolvedValue([agentRow("a", "one")]);
		await render({ sessionId: "a" });
		expect(current.agents).toHaveLength(1);

		// b's read fails; a's entries must not surface under b.
		invokeMock.mockRejectedValue(new Error("database is locked"));
		await render({ sessionId: "b" });
		expect(current.agents).toEqual([]);
		expect(current.error).toBe("database is locked");
	});

	it("recovers the roster on the next successful refresh", async () => {
		invokeMock.mockResolvedValue([agentRow("a", "one")]);
		await render({ sessionId: "a" });

		invokeMock.mockRejectedValue(new Error("database is locked"));
		await act(async () => {
			await current.refresh("a", { quiet: true });
		});
		expect(current.error).toBe("database is locked");

		invokeMock.mockResolvedValue([agentRow("a", "one"), agentRow("a", "two")]);
		await act(async () => {
			await current.refresh("a", { quiet: true });
		});
		expect(current.agents).toHaveLength(2);
		expect(current.error).toBeNull();
	});

	it("clears a previous error when switching sessions", async () => {
		invokeMock.mockRejectedValue(new Error("no session database"));
		await render({ sessionId: "a" });
		expect(current.error).toBe("no session database");

		invokeMock.mockResolvedValue([]);
		await render({ sessionId: "b" });
		expect(current.error).toBeNull();
	});

	it("keeps polling while the session is active", async () => {
		vi.useFakeTimers();
		try {
			invokeMock.mockResolvedValue([agentRow("a", "one")]);
			await render({ sessionId: "a", sessionActive: true });
			const afterFirst = invokeMock.mock.calls.length;
			await act(async () => {
				vi.advanceTimersByTime(2500);
			});
			expect(invokeMock.mock.calls.length).toBeGreaterThan(afterFirst);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not poll once the session is idle", async () => {
		vi.useFakeTimers();
		try {
			invokeMock.mockResolvedValue([agentRow("a", "one")]);
			await render({ sessionId: "a", sessionActive: false });
			const afterFirst = invokeMock.mock.calls.length;
			await act(async () => {
				vi.advanceTimersByTime(10_000);
			});
			expect(invokeMock.mock.calls.length).toBe(afterFirst);
		} finally {
			vi.useRealTimers();
		}
	});

	it("skips malformed rows rather than surfacing partial agents", async () => {
		invokeMock.mockResolvedValue([
			agentRow("a", "good"),
			{ sessionId: "a__nameless" },
			{ agentId: "sessionless" },
			null,
			"nonsense",
		]);
		await render({ sessionId: "a" });
		expect(current.agents.map((agent) => agent.agentId)).toEqual(["good"]);
	});

	it("carries the last action through for the roster's second line", async () => {
		invokeMock.mockResolvedValue([
			{ ...agentRow("a", "one"), lastAction: "Running read_files" },
		]);
		await render({ sessionId: "a" });
		expect(current.agents[0]?.lastAction).toBe("Running read_files");
	});
});
