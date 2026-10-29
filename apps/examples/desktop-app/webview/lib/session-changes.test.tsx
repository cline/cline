// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SessionChanges, useSessionChanges } from "./session-changes";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("./desktop-client", () => ({ desktopClient: { invoke: invokeMock } }));

let container: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof useSessionChanges>;

function Probe({ refreshKey }: { refreshKey: string }) {
	latest = useSessionChanges({
		enabled: true,
		environmentId: "local",
		sessionId: "s1",
		cwd: "/repo",
		refreshKey,
	});
	return null;
}

const changes = (path: string): SessionChanges => ({
	root: "/repo",
	session: { files: [], omitted: 0 },
	lastTurn: {
		runCount: 1,
		files: [{ path, status: "M", additions: 1, deletions: 0 }],
		omitted: 0,
	},
});

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	vi.useFakeTimers();
	container = document.createElement("div");
	root = createRoot(container);
	invokeMock.mockReset();
});

afterEach(async () => {
	await act(async () => root.unmount());
	vi.useRealTimers();
});

describe("useSessionChanges", () => {
	it("marks data stale from a refresh key change until that key's fetch lands", async () => {
		invokeMock.mockResolvedValueOnce(changes("a.ts"));
		await act(async () => root.render(<Probe refreshKey="completed:1" />));
		await act(async () => vi.advanceTimersByTimeAsync(400));
		expect(latest.current).toBe(true);
		expect(latest.changes?.lastTurn?.files[0]?.path).toBe("a.ts");

		// The next message starts a new turn: keep the old data for counts, but
		// it no longer describes the last turn.
		invokeMock.mockResolvedValueOnce(changes("b.ts"));
		await act(async () => root.render(<Probe refreshKey="running:1" />));
		expect(latest.current).toBe(false);
		expect(latest.changes?.lastTurn?.files[0]?.path).toBe("a.ts");

		await act(async () => vi.advanceTimersByTimeAsync(400));
		expect(latest.current).toBe(true);
		expect(latest.changes?.lastTurn?.files[0]?.path).toBe("b.ts");
	});
});
