// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionHistoryItem } from "@/lib/session-history";
import { useSideChatAttention } from "./use-side-chat-attention";

const { invoke, listeners, transport } = vi.hoisted(() => ({
	invoke: vi.fn(),
	listeners: new Map<string, (payload: unknown) => void>(),
	transport: new Set<(state: string) => void>(),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		invoke,
		subscribe: (event: string, listener: (payload: unknown) => void) => {
			listeners.set(event, listener);
			return () => listeners.delete(event);
		},
		subscribeTransportState: (listener: (state: string) => void) => {
			transport.add(listener);
			listener("connected");
			return () => transport.delete(listener);
		},
	},
}));

const sessions: SessionHistoryItem[] = ["a", "b"].map((sessionId) => ({
	sessionId,
	environmentId: "local",
	status: "running",
	provider: "test",
	model: "test",
	cwd: "/fixture",
	workspaceRoot: "/fixture",
	startedAt: "2026-10-28T00:00:00.000Z",
}));
let root: Root;
let container: HTMLDivElement;
let current: ReturnType<typeof useSideChatAttention>;
function Harness({
	item,
	onRender,
}: {
	item: SessionHistoryItem | undefined;
	onRender?: (attention: ReturnType<typeof useSideChatAttention>) => void;
}) {
	current = useSideChatAttention(item);
	onRender?.(current);
	return null;
}
async function emit(event: string, payload: unknown) {
	await act(async () => {
		listeners.get(event)?.(payload);
	});
}
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	invoke
		.mockReset()
		.mockImplementation(async (command, args) =>
			command === "get_discovered_session"
				? { sessionId: args.sessionId, status: "running" }
				: [],
		);
	listeners.clear();
	transport.clear();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

it("ignores other sessions and environments and clears only the addressed request", async () => {
	await act(async () => root.render(<Harness item={sessions[0]} />));
	await emit("tool_approval_state", {
		sessionId: "a",
		items: [{ sessionId: "a", requestId: "approval" }],
	});
	await emit("ask_question_requested", { sessionId: "b", requestId: "other" });
	await emit("ask_question_requested", {
		sessionId: "a",
		environmentId: "remote",
		requestId: "foreign",
	});
	expect(current).toEqual({
		kind: "ready",
		status: "running",
		approvals: 1,
		questions: 0,
	});
	await emit("ask_question_requested", {
		sessionId: "a",
		requestId: "question",
	});
	await emit("ask_question_answered", {
		requestId: "question",
		environmentId: "remote",
	});
	expect(current?.questions).toBe(1);
	await emit("ask_question_answered", { requestId: "question" });
	expect(current?.questions).toBe(0);
	expect(current?.approvals).toBe(1);
	await emit("tool_approval_state", { sessionId: "a", items: [] });
	expect(current?.approvals).toBe(0);
});

it("discards pending reads when switching or clearing the side session", async () => {
	const pending: Array<(value: unknown) => void> = [];
	invoke.mockImplementation(
		async (command: string, args: { sessionId: string }) => {
			if (args.sessionId === "a")
				return new Promise((resolve) => pending.push(resolve));
			return command === "get_discovered_session"
				? { sessionId: "b", status: "completed" }
				: [];
		},
	);
	await act(async () => root.render(<Harness item={sessions[0]} />));
	const onRender = vi.fn();
	await act(async () =>
		root.render(<Harness item={sessions[1]} onRender={onRender} />),
	);
	expect(onRender.mock.calls[0][0]).toBeUndefined();
	await act(async () => {
		for (const resolve of pending)
			resolve({ sessionId: "a", status: "running" });
	});
	expect(current).toEqual({
		kind: "ready",
		status: "completed",
		approvals: 0,
		questions: 0,
	});
	await act(async () => root.render(<Harness item={undefined} />));
	expect(current).toBeUndefined();
	expect(listeners.size).toBe(0);
	expect(transport.size).toBe(0);
});

it("reconciles an old snapshot without reviving resolved questions or dropping a newly requested one", async () => {
	let resolveSnapshot: (value: unknown) => void = () => {
		throw new Error("Snapshot not requested");
	};
	let firstRead = true;
	invoke.mockImplementation(
		async (command: string, args: { sessionId: string }) => {
			if (command === "get_discovered_session")
				return { sessionId: args.sessionId, status: "running" };
			if (command !== "poll_ask_questions" || args.sessionId !== "a") return [];
			if (firstRead) {
				firstRead = false;
				return new Promise((resolve) => {
					resolveSnapshot = resolve;
				});
			}
			return [{ sessionId: "a", requestId: "new" }];
		},
	);
	await act(async () => root.render(<Harness item={sessions[0]} />));
	await emit("ask_question_answered", { requestId: "old" });
	await emit("ask_question_requested", { sessionId: "a", requestId: "new" });
	await act(async () =>
		resolveSnapshot([{ sessionId: "a", requestId: "old" }]),
	);
	expect(current).toEqual({
		kind: "ready",
		status: "running",
		approvals: 0,
		questions: 1,
	});
	await emit("ask_question_answered", { requestId: "new" });
	expect(current?.questions).toBe(0);
});

it("reports failed reads as unknown, retains observed attention and recovers on reconnect", async () => {
	invoke.mockRejectedValue(new Error("Disconnected"));
	await act(async () => root.render(<Harness item={sessions[0]} />));
	await emit("tool_approval_state", {
		sessionId: "a",
		items: [{ sessionId: "a", requestId: "approval" }],
	});
	expect(current).toEqual({
		kind: "unknown",
		status: null,
		approvals: 1,
		questions: 0,
	});
	invoke.mockImplementation(
		async (command: string, args: { sessionId: string }) =>
			command === "get_discovered_session"
				? { sessionId: args.sessionId, status: "running" }
				: command === "poll_tool_approvals" && args.sessionId === "a"
					? [{ sessionId: "a", requestId: "approval" }]
					: [],
	);
	await act(async () => {
		for (const listener of transport) listener("connected");
	});
	expect(current).toEqual({
		kind: "ready",
		status: "running",
		approvals: 1,
		questions: 0,
	});
	await emit("session_deleted", { sessionId: "a" });
	expect(current).toBeUndefined();
});

it("tracks work and completion independently from the session history list", async () => {
	await act(async () => root.render(<Harness item={sessions[0]} />));
	await emit("chat_session_status", { sessionId: "a", status: "running" });
	expect(current?.status).toBe("running");
	await emit("chat_session_status", {
		sessionId: "a",
		environmentId: "remote",
		status: "failed",
	});
	expect(current?.status).toBe("running");
	await emit("chat_session_ended", { sessionId: "a", reason: "completed" });
	expect(current?.status).toBe("completed");
	await emit("chat_session_status", { sessionId: "a", status: "failed" });
	expect(current?.status).toBe("failed");
});

it("refreshes missed activity on reconnect and keeps newer status events over a late snapshot", async () => {
	let resolveStatus: ((value: unknown) => void) | undefined;
	invoke.mockImplementation(async (command: string) =>
		command === "get_discovered_session"
			? { sessionId: "a", status: "completed" }
			: [],
	);
	await act(async () => root.render(<Harness item={sessions[0]} />));
	expect(current?.status).toBe("completed");
	invoke.mockImplementation(async (command: string) =>
		command === "get_discovered_session"
			? new Promise((resolve) => {
					resolveStatus = resolve;
				})
			: [],
	);
	await act(async () => {
		for (const listener of transport) listener("disconnected");
		for (const listener of transport) listener("connected");
	});
	await emit("chat_session_status", { sessionId: "a", status: "failed" });
	await act(async () => resolveStatus?.({ sessionId: "a", status: "running" }));
	expect(current?.status).toBe("failed");
});
