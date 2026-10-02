// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatusHubView } from "./status-hub-view";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	events: new Map<string, () => void>(),
	transport: undefined as undefined | ((state: string) => void),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		invoke: mocks.invoke,
		subscribe: (name: string, callback: () => void) => {
			mocks.events.set(name, callback);
			return () => mocks.events.delete(name);
		},
		subscribeTransportState: (callback: (state: string) => void) => {
			mocks.transport = callback;
			return () => {
				mocks.transport = undefined;
			};
		},
	},
}));

let container: HTMLDivElement;
let root: Root;
const openChat = vi.fn();
function row(seq = 1, overrides: Record<string, unknown> = {}) {
	return {
		schemaVersion: 1,
		updateId: `update-${seq}`,
		seq,
		subject: "tests/router",
		state: "running",
		headline: "Checking the router",
		priority: "normal",
		sessionId: "chat-one",
		agentId: "agent-one",
		agentName: "Cline",
		workspaceRoot: "/projects/web",
		tags: [],
		source: "agent",
		supersededAt: null,
		createdAt: "2026-10-01T10:00:00.000Z",
		historyCount: 2,
		...overrides,
	};
}
function page(updates = [row()], overrides: Record<string, unknown> = {}) {
	return {
		updates,
		hasMore: false,
		nextCursor: null,
		total: updates.length,
		...overrides,
	};
}
const summary = {
	total: 1,
	byState: {
		running: 1,
		queued: 0,
		blocked: 0,
		done: 0,
		failed: 0,
		cancelled: 0,
	},
	byAgent: [],
	lastUpdatedAt: "2026-10-01T10:00:00.000Z",
};

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	mocks.events.clear();
	mocks.invoke.mockReset();
	openChat.mockReset();
	mocks.invoke.mockImplementation(async (command) =>
		command === "status.summary" ? summary : page(),
	);
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});
async function render() {
	await act(async () =>
		root.render(<StatusHubView onOpenSession={openChat} />),
	);
}
async function click(label: string) {
	const button = [...container.querySelectorAll("button")].find(
		(button) => button.textContent?.trim() === label,
	);
	expect(button).toBeDefined();
	await act(async () => {
		button?.dispatchEvent(
			new MouseEvent("mousedown", { bubbles: true, button: 0 }),
		);
		button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
}

describe("Status Hub desktop view", () => {
	it("loads the current board and opens the reporting chat", async () => {
		await render();
		expect(mocks.invoke).toHaveBeenCalledWith(
			"status.board",
			expect.objectContaining({ limit: 50 }),
		);
		expect(container.textContent).toContain("Checking the router");
		await click("Open chat");
		expect(openChat).toHaveBeenCalledWith("chat-one");
	});

	it("shows a load error with retry instead of claiming that the hub is empty", async () => {
		mocks.invoke.mockRejectedValueOnce(new Error("Hub unavailable"));
		await render();
		expect(container.querySelector('[role="alert"]')?.textContent).toContain(
			"Hub unavailable",
		);
		expect(container.textContent).not.toContain("No status updates yet");
		await click("Retry");
		expect(container.textContent).toContain("Checking the router");
	});

	it("drills into a subject's session-scoped history and labels superseded reports", async () => {
		await render();
		mocks.invoke.mockImplementation(async (command) =>
			command === "status.summary"
				? summary
				: page([
						row(2, {
							state: "done",
							headline: "Router tested",
							previousState: "running",
						}),
						row(1, { supersededAt: "2026-10-01T10:01:00.000Z" }),
					]),
		);
		await click("2 updates");
		expect(mocks.invoke).toHaveBeenCalledWith(
			"status.query",
			expect.objectContaining({
				subject: "tests/router",
				sessionId: "chat-one",
			}),
		);
		expect(container.textContent).toContain("Historical");
		expect(container.textContent).toContain("Router tested");
	});

	it("pages history and keeps the reader's position when live updates arrive", async () => {
		mocks.invoke.mockImplementation(async (command, args) =>
			command === "status.summary"
				? summary
				: args?.cursor
					? page([row(1)])
					: page([row(2)], { hasMore: true, nextCursor: 2, total: 2 }),
		);
		await render();
		await click("Load more");
		expect(mocks.invoke).toHaveBeenCalledWith(
			"status.board",
			expect.objectContaining({ cursor: 2 }),
		);
		const before = mocks.invoke.mock.calls.length;
		await act(async () => mocks.events.get("status.updated")?.());
		expect(container.textContent).toContain("New updates available");
		expect(mocks.invoke.mock.calls.length).toBe(before);
		await click("Show latest");
		expect(mocks.invoke.mock.calls.length).toBeGreaterThan(before);
	});

	it("refreshes the first page on a live event and recovers after reconnecting", async () => {
		await render();
		mocks.invoke.mockImplementation(async (command) =>
			command === "status.summary"
				? summary
				: page([row(2, { headline: "New report" })]),
		);
		await act(async () => {
			mocks.events.get("status.updated")?.();
			await new Promise((resolve) => setTimeout(resolve, 220));
		});
		expect(container.textContent).toContain("New report");
		await act(async () => mocks.transport?.("reconnecting"));
		expect(container.textContent).toContain("Live updates disconnected");
		await act(async () => {
			mocks.transport?.("connected");
			await new Promise((resolve) => setTimeout(resolve, 220));
		});
		expect(container.textContent).not.toContain("Live updates disconnected");
	});

	it("ignores responses from a view that has already changed", async () => {
		let resolveBoard: (value: unknown) => void = () => {};
		mocks.invoke.mockImplementation(async (command) =>
			command === "status.summary"
				? summary
				: command === "status.board"
					? new Promise((resolve) => {
							resolveBoard = resolve;
						})
					: page([row(3, { headline: "History loaded" })]),
		);
		await render();
		await click("Changelog");
		await act(async () =>
			resolveBoard(page([row(4, { headline: "Old board response" })])),
		);
		expect(container.textContent).toContain("History loaded");
		expect(container.textContent).not.toContain("Old board response");
	});
});
