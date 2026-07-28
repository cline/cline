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
	enabled = true,
	sessionActive = false,
}: {
	sessionId: string | null;
	enabled?: boolean;
	sessionActive?: boolean;
}) {
	current = useSessionAgents({ sessionId, enabled, sessionActive });
	return null;
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

	it("does not fetch while nothing is displaying the roster", async () => {
		await render({ sessionId: "a", enabled: false });
		expect(invokeMock).not.toHaveBeenCalled();
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

		// enabled: false short-circuits the fetch, so only the reset can clear it.
		await render({ sessionId: "b", enabled: false });
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

		// Switch to a session that never fetches, so nothing overwrites the roster.
		await render({ sessionId: "b", enabled: false });
		await act(async () => {
			resolveFirst?.([agentRow("a", "stale")]);
		});
		expect(current.agents).toEqual([]);

		// Returning to `a` is a fresh load, not the leaked response.
		invokeMock.mockResolvedValue([agentRow("a", "one")]);
		await render({ sessionId: "a" });
		expect(current.agents.map((agent) => agent.agentId)).toEqual(["one"]);
	});

	it("reports a roster failure without dropping the header tally", async () => {
		invokeMock.mockRejectedValue(new Error("no session database"));
		await render({ sessionId: "a" });
		expect(current.agents).toEqual([]);
		expect(current.error).toBe("no session database");
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
