// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import {
	FACTORY_TRANSCRIPT_REFRESH_MS,
	FACTORY_TRANSCRIPT_UNAVAILABLE,
	type FactorySessionTranscript,
	useFactorySessionTranscript,
} from "./use-factory-session-transcript";

const mocks = vi.hoisted(() => {
	const listeners = new Map<string, Set<(payload: unknown) => void>>();
	const transport = new Set<(state: string) => void>();
	return {
		listeners,
		transport,
		invoke: vi.fn(),
		subscribe: vi.fn((event: string, listener: (payload: unknown) => void) => {
			const set = listeners.get(event) ?? new Set();
			set.add(listener);
			listeners.set(event, set);
			return () => set.delete(listener);
		}),
		subscribeTransportState: vi.fn((listener: (state: string) => void) => {
			transport.add(listener);
			return () => transport.delete(listener);
		}),
	};
});
vi.mock("@/lib/desktop-client", () => ({ desktopClient: mocks }));

const message = (sessionId: string, content: string): ChatMessage => ({
	id: `${sessionId}-${content}`,
	sessionId,
	role: "assistant",
	content,
	createdAt: 1,
});

let container: HTMLDivElement;
let root: Root;
let result: FactorySessionTranscript;
function Probe({ sessionId, ended }: { sessionId: string; ended?: boolean }) {
	result = useFactorySessionTranscript(sessionId, { ended });
	return null;
}
const render = (sessionId: string, ended?: boolean) =>
	act(async () => root.render(<Probe ended={ended} sessionId={sessionId} />));
const emit = (event: string, payload: unknown) =>
	act(async () => {
		for (const listener of mocks.listeners.get(event) ?? []) listener(payload);
	});
const advance = (ms: number) =>
	act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
const reads = () =>
	mocks.invoke.mock.calls.filter(
		([command]) => command === "read_session_messages",
	);

beforeEach(() => {
	vi.useFakeTimers();
	mocks.listeners.clear();
	mocks.transport.clear();
	mocks.invoke.mockReset();
	mocks.invoke.mockImplementation(async (_command: string, args: unknown) => [
		message(
			(args as { sessionId: string }).sessionId,
			`read ${reads().length}`,
		),
	]);
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
});

it("reads the transcript on mount without attaching", async () => {
	await render("builder");
	expect(reads()).toHaveLength(1);
	expect(reads()[0]?.[1]).toMatchObject({ sessionId: "builder" });
	expect(
		mocks.invoke.mock.calls.every(
			([command]) => command === "read_session_messages",
		),
	).toBe(true);
	expect(result.status).toBe("live");
	expect(result.messages.map((item) => item.content)).toEqual(["read 1"]);
});

it("throttles refetches on session events to one per window", async () => {
	await render("builder");
	// Inside the window: bursts collapse into one trailing read.
	await emit("task.factory.activity", { sessionId: "builder" });
	await emit("chat_session_status", {
		sessionId: "builder",
		status: "running",
	});
	await emit("task.factory.activity", { sessionId: "builder" });
	expect(reads()).toHaveLength(1);
	await advance(FACTORY_TRANSCRIPT_REFRESH_MS);
	expect(reads()).toHaveLength(2);
	expect(result.messages[0]?.content).toBe("read 2");
	// Events for other sessions are ignored.
	await advance(FACTORY_TRANSCRIPT_REFRESH_MS);
	await emit("task.factory.activity", { sessionId: "other" });
	expect(reads()).toHaveLength(2);
	// After a quiet window the next event reads at once.
	await emit("chat_session_status", {
		sessionId: "builder",
		status: "running",
	});
	expect(reads()).toHaveLength(3);
});

it("reads once more after the session ends, then stops", async () => {
	await render("builder");
	await advance(FACTORY_TRANSCRIPT_REFRESH_MS);
	await emit("chat_session_ended", { sessionId: "builder" });
	expect(reads()).toHaveLength(2);
	expect(result.status).toBe("ended");
	await emit("task.factory.activity", { sessionId: "builder" });
	await emit("chat_session_status", {
		sessionId: "builder",
		status: "running",
	});
	await advance(FACTORY_TRANSCRIPT_REFRESH_MS * 3);
	expect(reads()).toHaveLength(2);
	expect(result.status).toBe("ended");
});

it("starts ended for a session already known to be finished", async () => {
	await render("builder", true);
	expect(reads()).toHaveLength(1);
	expect(result.status).toBe("ended");
	await emit("task.factory.activity", { sessionId: "builder" });
	await advance(FACTORY_TRANSCRIPT_REFRESH_MS);
	expect(reads()).toHaveLength(1);
});

it("reports a failed read as unavailable instead of throwing", async () => {
	mocks.invoke.mockRejectedValueOnce(new Error("Session not found"));
	await render("gone");
	expect(result.status).toBe("unavailable");
	expect(result.error).toBe(FACTORY_TRANSCRIPT_UNAVAILABLE);
	expect(result.messages).toEqual([]);
	// A later successful read recovers.
	await emit("task.factory.activity", { sessionId: "gone" });
	await advance(FACTORY_TRANSCRIPT_REFRESH_MS);
	expect(result.status).toBe("live");
	expect(result.error).toBeUndefined();
});

it("ignores a slow response for the previous session after switching", async () => {
	let resolveFirst: (messages: ChatMessage[]) => void = () => {};
	mocks.invoke.mockImplementationOnce(
		() =>
			new Promise<ChatMessage[]>((resolve) => {
				resolveFirst = resolve;
			}),
	);
	await render("designer");
	expect(result.status).toBe("loading");
	await render("builder");
	expect(
		reads().map(([, args]) => (args as { sessionId: string }).sessionId),
	).toEqual(["designer", "builder"]);
	await act(async () => resolveFirst([message("designer", "stale")]));
	expect(result.messages.map((item) => item.sessionId)).toEqual(["builder"]);
	expect(result.status).toBe("live");
	// The old session's events no longer refetch.
	await advance(FACTORY_TRANSCRIPT_REFRESH_MS);
	await emit("task.factory.activity", { sessionId: "designer" });
	expect(reads()).toHaveLength(2);
});

it("reports reconnecting and rereads once the transport is back", async () => {
	await render("builder");
	await act(async () => {
		for (const listener of mocks.transport) listener("reconnecting");
	});
	expect(result.connected).toBe(false);
	await advance(FACTORY_TRANSCRIPT_REFRESH_MS);
	await act(async () => {
		for (const listener of mocks.transport) listener("connected");
	});
	expect(result.connected).toBe(true);
	expect(reads()).toHaveLength(2);
});
