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
	factoryShortActivity,
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

it("shortens a board card's live line to file names, keeping the full line as its tooltip", async () => {
	expect(
		factoryShortActivity(
			"Editing src/services/uploads/resumable-upload-manager.ts to add backoff",
		),
	).toBe("Editing resumable-upload-manager.ts to add backoff");
	expect(
		factoryShortActivity("Opening http://localhost:3125/settings/models"),
	).toBe("Opening localhost:3125/settings/models");
	// Directories and plain words are left as they are.
	expect(factoryShortActivity("Running bun test src/uploads")).toBe(
		"Running bun test src/uploads",
	);
	await act(async () =>
		root.render(
			<FactoryLiveLine
				wrap
				compact
				sessions={[
					{ sessionId: "a", role: "builder" },
					{ sessionId: "b", role: "builder" },
				]}
				activity={{
					connected: true,
					sessions: new Map([
						[
							"a",
							{
								lastTool: "Editing src/a/very/deep/path/file.ts",
								at: 2,
								ended: false,
							},
						],
					]),
				}}
			/>,
		),
	);
	const line = container.querySelector('[data-testid="factory-live-line"]');
	const text = line?.querySelector("[data-factory-live-text]");
	// Two lines at most; the card keeps their height (factory-view).
	expect(text?.className).toContain("line-clamp-2");
	expect(text?.textContent).toBe("Builder 1 · Editing file.ts · +1 more");
	expect(line?.getAttribute("title")).toBe(
		"Builder 1 · Editing src/a/very/deep/path/file.ts · +1 more",
	);
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
