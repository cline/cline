// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionHistoryItem } from "@/lib/session-history";
import { sessionKey } from "@/lib/session-identity";
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
function Harness({ items = sessions }: { items?: SessionHistoryItem[] }) {
	current = useSideChatAttention(items);
	return null;
}
const value = (id: string) =>
	current.attention.get(sessionKey({ sessionId: id }));
async function emit(event: string, payload: unknown) {
	await act(async () => {
		listeners.get(event)?.(payload);
	});
}
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	invoke.mockReset().mockResolvedValue([]);
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

it("keeps inactive sibling requests separate and clears only their addressed request", async () => {
	await act(async () => root.render(<Harness />));
	await emit("tool_approval_state", {
		sessionId: "a",
		items: [{ sessionId: "a", requestId: "approval" }],
	});
	await emit("ask_question_requested", {
		sessionId: "b",
		requestId: "question",
	});
	await emit("ask_question_requested", {
		sessionId: "b",
		environmentId: "remote",
		requestId: "foreign",
	});
	expect(value("a")).toEqual({
		kind: "ready",
		status: "running",
		approvals: 1,
		questions: 0,
	});
	expect(value("b")).toEqual({
		kind: "ready",
		status: "running",
		approvals: 0,
		questions: 1,
	});
	await emit("ask_question_answered", {
		requestId: "question",
		environmentId: "remote",
	});
	expect(value("b")?.questions).toBe(1);
	await emit("ask_question_answered", { requestId: "question" });
	expect(value("b")?.questions).toBe(0);
	expect(value("a")?.approvals).toBe(1);
	await emit("tool_approval_state", { sessionId: "a", items: [] });
	expect(value("a")?.approvals).toBe(0);
});

it("reconciles an old snapshot without reviving resolved questions or dropping a newly requested one", async () => {
	let resolveSnapshot: (value: unknown) => void = () => {
		throw new Error("Snapshot not requested");
	};
	let firstRead = true;
	invoke.mockImplementation(
		async (command: string, args: { sessionId: string }) => {
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
	await act(async () => root.render(<Harness />));
	await emit("ask_question_answered", { requestId: "old" });
	await emit("ask_question_requested", { sessionId: "a", requestId: "new" });
	await act(async () =>
		resolveSnapshot([{ sessionId: "a", requestId: "old" }]),
	);
	expect(value("a")).toEqual({
		kind: "ready",
		status: "running",
		approvals: 0,
		questions: 1,
	});
	await emit("ask_question_answered", { requestId: "new" });
	expect(value("a")?.questions).toBe(0);
});

it("reports failed reads as unknown, retains observed attention and recovers on reconnect", async () => {
	invoke.mockRejectedValue(new Error("Disconnected"));
	await act(async () => root.render(<Harness />));
	await emit("tool_approval_state", {
		sessionId: "a",
		items: [{ sessionId: "a", requestId: "approval" }],
	});
	expect(value("a")).toEqual({
		kind: "unknown",
		status: "running",
		approvals: 1,
		questions: 0,
	});
	invoke.mockImplementation(
		async (command: string, args: { sessionId: string }) =>
			command === "poll_tool_approvals" && args.sessionId === "a"
				? [{ sessionId: "a", requestId: "approval" }]
				: [],
	);
	await act(async () => {
		for (const listener of transport) listener("connected");
	});
	expect(value("a")).toEqual({
		kind: "ready",
		status: "running",
		approvals: 1,
		questions: 0,
	});
	await emit("session_deleted", { sessionId: "a" });
	expect(value("a")).toBeUndefined();
});

it("tracks work and completion independently from the session history list", async () => {
	await act(async () => root.render(<Harness />));
	await emit("chat_session_status", { sessionId: "a", status: "running" });
	expect(value("a")?.status).toBe("running");
	await emit("chat_session_status", {
		sessionId: "a",
		environmentId: "remote",
		status: "failed",
	});
	expect(value("a")?.status).toBe("running");
	await emit("chat_session_ended", { sessionId: "a", reason: "completed" });
	expect(value("a")?.status).toBe("completed");
	await emit("chat_session_status", { sessionId: "a", status: "failed" });
	expect(value("a")?.status).toBe("failed");
});

it("refreshes missed activity on reconnect and keeps newer status events over a late snapshot", async () => {
	const items: SessionHistoryItem[] = [
		{
			...sessions[0],
			metadata: {
				desktopSideConversation: {
					version: 1,
					parentSessionId: "parent",
					capturedAt: "2026-10-28T00:00:00.000Z",
					sourceMessageCount: 0,
					includedMessageCount: 0,
					omittedMessageCount: 0,
					omittedMediaCount: 0,
				},
			},
		},
	];
	let resolveStatus: ((value: unknown) => void) | undefined;
	invoke.mockImplementation(async (command: string) =>
		command === "find_side_session"
			? { sessionId: "a", status: "completed" }
			: [],
	);
	await act(async () => root.render(<Harness items={items} />));
	expect(value("a")?.status).toBe("completed");
	invoke.mockImplementation(async (command: string) =>
		command === "find_side_session"
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
	expect(value("a")?.status).toBe("failed");
});
