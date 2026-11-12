// @vitest-environment jsdom
import { factoryDesignProgressSchema } from "@cline/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	FactoryBackChip,
	FactoryLiveLine,
	FactoryWatchButton,
	factoryLiveSessions,
	formatFactoryElapsed,
	rememberFactoryWatchOrigin,
} from "./factory-live";

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		subscribe: vi.fn(() => () => {}),
		subscribeTransportState: vi.fn(() => () => {}),
	},
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	sessionStorage.clear();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const base = {
	status: "pending_approval" as const,
	revision: 2,
	updatedAt: "2026-01-01T00:00:00Z",
};
const reviewing = factoryDesignProgressSchema.parse({
	phase: "reviewing",
	revision: 2,
	repairRound: 0,
	agents: {},
	designerSessionId: "designer",
	findings: [],
	reviewerSessions: [
		{ reviewerIndex: 0, sessionId: "old" },
		{ reviewerIndex: 0, sessionId: "checker-a" },
		{ reviewerIndex: 1, sessionId: "checker-b" },
	],
	reviews: [
		{
			reviewerIndex: 1,
			sessionId: "checker-b",
			review: { verdict: "pass", summary: "Fine.", findings: [] },
		},
	],
});

describe("factoryLiveSessions", () => {
	it("watches the scoping agent, then only plan checkers still reviewing", () => {
		expect(
			factoryLiveSessions({
				...base,
				factoryDesignProgress: { ...reviewing, phase: "designing" } as never,
			}),
		).toEqual([
			{ sessionId: "designer", role: "designer", startedAt: base.updatedAt },
		]);
		expect(
			factoryLiveSessions({ ...base, factoryDesignProgress: reviewing }),
		).toEqual([
			{
				sessionId: "checker-a",
				role: "plan_reviewer",
				startedAt: base.updatedAt,
			},
		]);
		// Stale revisions, errors and archived cards watch nothing.
		expect(
			factoryLiveSessions({
				...base,
				revision: 3,
				factoryDesignProgress: reviewing,
			}),
		).toEqual([]);
		expect(
			factoryLiveSessions({
				...base,
				error: "x",
				factoryDesignProgress: reviewing,
			}),
		).toEqual([]);
	});

	it("passes the board's running execution sessions through", () => {
		const active = [{ sessionId: "b", role: "builder" as const }];
		expect(
			factoryLiveSessions({ ...base, status: "in_progress" }, active),
		).toEqual(active);
	});
});

it("formats elapsed time compactly", () => {
	expect(formatFactoryElapsed(45_000)).toBe("45s");
	expect(formatFactoryElapsed(252_000)).toBe("4m 12s");
	expect(formatFactoryElapsed(3_780_000)).toBe("1h 3m");
});

it("falls back to role and elapsed time without live events, and shows a waiting state", async () => {
	const startedAt = new Date(Date.now() - 65_000).toISOString();
	await act(async () =>
		root.render(
			<FactoryLiveLine
				sessions={[{ sessionId: "s", role: "verifier", startedAt }]}
			/>,
		),
	);
	expect(container.textContent).toContain("Tester · Working");
	expect(container.textContent).toContain("1m 5s");
	expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
		"Tester · Working",
	);
	await act(async () =>
		root.render(
			<FactoryLiveLine sessions={[]} waiting="Waiting for a free slot" />,
		),
	);
	expect(container.textContent).toContain("Waiting for a free slot");
});

it("board buttons are labelled with the role and card", async () => {
	const onOpenSession = vi.fn(async () => {});
	await act(async () =>
		root.render(
			<FactoryWatchButton
				label="Watch"
				taskId="t"
				title="Search notes"
				sessions={[{ sessionId: "s", role: "builder" }]}
				onOpenSession={onOpenSession}
			/>,
		),
	);
	const button = container.querySelector(
		'button[aria-label="Watch Builder on Search notes"]',
	);
	if (!(button instanceof HTMLButtonElement)) throw new Error("No button");
	expect(button.textContent).toBe("Watch");
	await act(async () => button.click());
	expect(onOpenSession).toHaveBeenCalledWith("s");
});

it("links a session opened from Factory back to its card", async () => {
	const onOpenFactoryTask = vi.fn();
	rememberFactoryWatchOrigin({
		sessionId: "s",
		taskId: "t",
		title: "Search notes",
	});
	await act(async () =>
		root.render(
			<FactoryBackChip
				sessionId="other"
				onOpenFactoryTask={onOpenFactoryTask}
			/>,
		),
	);
	expect(container.textContent).toBe("");
	await act(async () =>
		root.render(
			<FactoryBackChip sessionId="s" onOpenFactoryTask={onOpenFactoryTask} />,
		),
	);
	expect(container.textContent).toContain("Back to Search notes");
	await act(async () => container.querySelector("button")?.click());
	expect(onOpenFactoryTask).toHaveBeenCalledWith("t");
});
