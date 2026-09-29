import type { CloudSessionSnapshot } from "@cline/core/cloud";
import type { AgentEvent } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	CliCloudRuntime,
	CloudRuntimeState,
	CloudTranscriptEvent,
} from "../../runtime/cloud/runtime";
import type { ChatEntry } from "../types";

const harness = vi.hoisted(() => ({
	entries: [] as ChatEntry[],
	cleanups: [] as Array<() => void>,
	materialize: vi.fn(),
}));
vi.mock("react", () => ({
	useState: (initial: ChatEntry[]) => {
		harness.entries = initial;
		return [
			initial,
			(update: ChatEntry[] | ((current: ChatEntry[]) => ChatEntry[])) => {
				harness.entries =
					typeof update === "function" ? update(harness.entries) : update;
			},
		];
	},
	useRef: (current: unknown) => ({ current }),
	useCallback: (callback: unknown) => callback,
	useEffect: (effect: () => undefined | (() => void)) => {
		const cleanup = effect();
		if (cleanup) harness.cleanups.push(cleanup);
	},
}));
vi.mock("../../utils/generated-media", () => ({
	materializeGeneratedMedia: harness.materialize,
}));

import { useCloudTranscript } from "./use-cloud-transcript";

function fixture(
	messages: CloudSessionSnapshot["messages"] = [],
	busy = false,
) {
	const target = {
		kind: "cloud",
		sessionId: "outer-A",
		scopeKey: "scope-A",
	} as const;
	const snapshot = {
		sessionId: "outer-A",
		messages,
		config: {},
		busy,
		status: busy ? "running" : "idle",
		startedAt: 0,
		approvals: [],
		promptsInQueue: [],
		connectionState: "connected",
		transcriptKnown: true,
	} satisfies CloudSessionSnapshot;
	let state: CloudRuntimeState = {
		target,
		session: snapshot,
		eligibility: { available: true, enabled: true, checking: false },
		pendingCreations: [],
		creating: false,
		stopping: false,
		dashboardUrl: "https://cloud.invalid",
	};
	let listener: ((event: CloudTranscriptEvent) => void) | undefined;
	const runtime = {
		getSnapshot: () => state,
		subscribeToSessionEvents: (next: (event: CloudTranscriptEvent) => void) => {
			listener = next;
			next({ type: "snapshot", target, snapshot });
			return () => {
				listener = undefined;
			};
		},
	} as CliCloudRuntime;
	// biome-ignore lint/correctness/useHookAtTopLevel: Deterministic hook harness supplies React state and subscriptions directly.
	useCloudTranscript(runtime, target);
	return {
		target,
		agent: (event: AgentEvent) =>
			listener?.({
				type: "core_event",
				target,
				event: {
					type: "agent_event",
					payload: { sessionId: "outer-A", event },
				},
			}),
		replace: (next: CloudSessionSnapshot["messages"]) =>
			listener?.({
				type: "snapshot",
				target,
				snapshot: { ...snapshot, messages: next, busy: false },
			}),
		switchTarget: () => {
			state = {
				...state,
				target: { kind: "cloud", sessionId: "outer-B", scopeKey: "scope-B" },
			};
		},
	};
}

beforeEach(() => {
	for (const cleanup of harness.cleanups.splice(0)) cleanup();
	harness.entries = [];
	harness.materialize.mockClear();
});

describe("cloud transcript projection", () => {
	it("continues streamed text after a snapshot and replaces it authoritatively without duplication", () => {
		const stream = fixture([{ role: "assistant", content: "hello" }], true);
		stream.agent({
			type: "content_start",
			contentType: "text",
			text: " world",
		});
		expect(harness.entries).toHaveLength(1);
		expect(harness.entries[0]).toMatchObject({
			kind: "assistant_text",
			text: "hello world",
			streaming: true,
		});
		stream.replace([{ role: "assistant", content: "hello world" }]);
		expect(harness.entries).toHaveLength(1);
		expect(harness.entries[0]).toMatchObject({
			text: "hello world",
			streaming: false,
		});
	});
	it("shows live tool updates and replaces progress with the final result", () => {
		const stream = fixture();
		stream.agent({
			type: "content_start",
			contentType: "tool",
			toolCallId: "tool-1",
			toolName: "execute_command",
			input: { command: "echo fixture" },
		});
		stream.agent({
			type: "content_update",
			contentType: "tool",
			toolCallId: "tool-1",
			update: "working",
		});
		expect(harness.entries[0]).toMatchObject({
			kind: "tool_call",
			streaming: true,
			result: { rawOutput: "working" },
		});
		stream.agent({
			type: "content_end",
			contentType: "tool",
			toolCallId: "tool-1",
			output: "finished",
		});
		expect(harness.entries).toHaveLength(1);
		expect(harness.entries[0]).toMatchObject({
			streaming: false,
			result: { rawOutput: "finished" },
		});
	});
	it("rejects a retired target's events and snapshots", () => {
		const stream = fixture();
		stream.switchTarget();
		stream.agent({
			type: "content_start",
			contentType: "text",
			text: "old account data",
		});
		stream.replace([{ role: "assistant", content: "old account history" }]);
		expect(harness.entries).toEqual([]);
	});
	it("renders cloud media references without materializing files locally", () => {
		const stream = fixture();
		stream.agent({
			type: "content_end",
			contentType: "media",
			media: {
				id: "image-1",
				modality: "image",
				mediaType: "image/png",
				sizeBytes: 5,
				source: { type: "url", url: "https://cloud.invalid/image.png" },
			},
		});
		expect(harness.entries[0]).toMatchObject({
			kind: "assistant_media",
			location: "https://cloud.invalid/image.png",
		});
		expect(harness.materialize).not.toHaveBeenCalled();
	});
	it("does not materialize media while hydrating cloud history", () => {
		fixture([
			{
				role: "assistant",
				content: [
					{
						type: "media",
						media: {
							id: "saved-media",
							modality: "image",
							mediaType: "image/png",
							source: { type: "base64", data: "aGVsbG8=" },
						},
					},
				],
			},
		]);
		expect(harness.entries[0]).toMatchObject({
			kind: "assistant_media",
			mediaType: "image/png",
		});
		expect(harness.materialize).not.toHaveBeenCalled();
	});

	it("closes streaming text when the remote run ends", () => {
		const stream = fixture();
		stream.agent({
			type: "content_start",
			contentType: "reasoning",
			reasoning: "thinking",
		});
		stream.agent({
			type: "done",
			reason: "completed",
			text: "",
			iterations: 1,
		});
		expect(harness.entries[0]).toMatchObject({
			kind: "reasoning",
			streaming: false,
		});
	});
});
