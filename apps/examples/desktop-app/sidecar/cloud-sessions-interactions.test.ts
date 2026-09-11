import { HubTransportError } from "@cline/core";
import type { HubEventEnvelope } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	CloudSessionApi,
	CloudSessionManager,
	type CloudSessionRecord,
	reconcileBufferedCloudEvents,
} from "./cloud-sessions";
import { createSidecarContext } from "./context";
import type { LiveSession } from "./types";

async function createFixture() {
	const ctx = createSidecarContext("/workspace");
	const live: LiveSession = {
		config: { executionTarget: "cloud", model: "test-model" },
		messages: [],
		promptsInQueue: [],
		busy: false,
		status: "idle",
		startedAt: 1,
	};
	ctx.liveSessions.set("ses-outer", live);
	const remote: CloudSessionRecord = {
		id: "ses-outer",
		status: "ready",
		sandboxUrl: "https://pod.example/hub",
		repoContext: { repoUrl: "https://github.com/cline/test" },
		metadata: { modelId: "test-model" },
		createdAt: "2026-08-05T10:00:00.000Z",
		updatedAt: "2026-08-05T10:01:00.000Z",
	};
	const options = {
		apiBaseUrl: "https://api.example",
		getAuthToken: async () => "token",
	};
	const api = new CloudSessionApi({
		...options,
		appBaseUrl: "https://app.example",
	});
	vi.spyOn(api, "list").mockResolvedValue([remote]);
	const updateTitle = vi.spyOn(api, "updateTitle").mockResolvedValue(remote);
	const manager = new CloudSessionManager(ctx, { ...options, api });
	const replies: Record<string, Record<string, unknown>> = {
		"session.get": { session: { status: "idle" } },
		"session.messages": { messages: [] },
		"session.pending_prompts": { prompts: [] },
	};
	const reply = (name: string) => ({
		version: "v1" as const,
		ok: true as const,
		payload: replies[name] ?? {},
	});
	const command = vi.fn(
		async (
			name: string,
			_payload?: unknown,
			_sessionId?: string,
			_options?: unknown,
		) => reply(name),
	);
	const connection: Awaited<
		ReturnType<CloudSessionManager["ensureConnection"]>
	> = {
		remote,
		innerSessionId: "inner-1",
		client: {
			command,
			connect: vi.fn(),
			dispose: vi.fn(),
			getClientId: () => "test-client",
			subscribe: () => vi.fn(),
		},
		bufferedEvents: [],
		rehydrationGeneration: 0,
		transcriptKnown: false,
		seenEventIds: new Set(),
		seenEventIdOrder: [],
		unsubscribe: vi.fn(),
	};
	const ensureAttached = vi.fn(async () => {});
	const forwardEvent = vi.fn();
	// Stub transport ownership; exercise the real interaction logic.
	Object.assign(manager, {
		ensureConnection: async () => connection,
		ensureAttached,
		forwardEvent,
		applySessionModel: vi.fn(),
		refreshKnownSession: async () => undefined,
		loadArchivedMessages: async () => null,
	});
	await manager.list();
	return {
		ctx,
		manager,
		live,
		connection,
		command,
		replies,
		reply,
		ensureAttached,
		forwardEvent,
		updateTitle,
	};
}

const transportError = () =>
	new HubTransportError("hub_connection_closed", "socket closed");

describe("CloudSessionManager interactions", () => {
	it("refreshes the completion time for a later turn completed while disconnected", async () => {
		const { manager, live, replies } = await createFixture();
		live.status = "running";
		live.endedAt = 1;
		replies["session.get"] = { session: { status: "completed" } };
		await manager.readMessages("ses-outer");
		expect(live.endedAt).toBeGreaterThan(1);
	});

	it("queues one rerun when a second sync overlaps the active snapshot", async () => {
		const { manager, command, reply } = await createFixture();
		const blocked = Promise.withResolvers<void>();
		const reached = Promise.withResolvers<void>();
		let reads = 0;
		command.mockImplementation(async (name) => {
			if (name === "session.messages" && ++reads === 1) {
				reached.resolve();
				await blocked.promise;
			}
			return reply(name);
		});
		const first = manager.readMessages("ses-outer");
		await reached.promise;
		const second = manager.readMessages("ses-outer");
		blocked.resolve();
		await Promise.all([first, second]);
		expect(reads).toBe(2);
	});

	it("retains the prior transcript and releases buffered events when a snapshot fails", async () => {
		const {
			ctx,
			manager,
			live,
			connection,
			command,
			reply,
			replies,
			forwardEvent,
		} = await createFixture();
		const send = vi.fn();
		ctx.wsClients.add({ send });
		const previous = [{ role: "assistant" as const, content: "keep me" }];
		live.messages = previous;
		const event: HubEventEnvelope = {
			version: "v1",
			event: "assistant.delta",
			sessionId: "inner-1",
			payload: { text: "still live" },
		};
		replies["session.messages"] = { messages: "invalid" };
		command.mockImplementation(async (name) => {
			if (name === "session.messages") connection.bufferedEvents.push(event);
			return reply(name);
		});
		await expect(manager.readMessages("ses-outer")).rejects.toThrow(
			/invalid transcript snapshot/i,
		);
		expect(live.messages).toBe(previous);
		expect(forwardEvent).toHaveBeenCalledExactlyOnceWith(
			"ses-outer",
			connection,
			event,
		);
		expect(connection.bufferingEvents).toBe(false);
		expect(
			send.mock.calls.map(([message]) => JSON.parse(message).event.name),
		).toContain("cloud_session_sync_failed");
	});
});

describe("reconcileBufferedCloudEvents", () => {
	const event = (
		name: HubEventEnvelope["event"],
		id: string,
		payload: Record<string, unknown> = {},
	): HubEventEnvelope => ({
		version: "v1",
		event: name,
		eventId: id,
		timestamp: Date.now(),
		sessionId: "inner-1",
		payload,
	});

	it("preserves submitted lifecycle while marking only newly reflected prompts", () => {
		const submitted = (id: string) =>
			event("session.pending_prompt_submitted", id, {
				prompt: { id, prompt: "Continue", delivery: "queue" },
			});
		const first = submitted("q-1");
		const later = submitted("q-2");
		const baseline = [{ role: "user", content: "Continue" }];
		// An older identical user message must not consume a new submission.
		expect(
			reconcileBufferedCloudEvents([first], baseline, {
				baselineMessages: baseline,
			}),
		).toEqual([first]);
		const snapshot = [
			...baseline,
			{ role: "user", content: "<user_input>Continue</user_input>" },
		];
		const completed = event("run.completed", "done");
		const running = event("run.started", "next");
		// Keep the next turn's start between lifecycle events; only its bubble is reflected.
		expect(
			reconcileBufferedCloudEvents(
				[completed, first, running, later],
				snapshot,
				{
					baselineMessages: baseline,
				},
			),
		).toEqual([
			completed,
			{ ...first, payload: { ...first.payload, transcriptReflected: true } },
			running,
			later,
		]);
		// A submission received after the transcript reply cannot be in it.
		expect(
			reconcileBufferedCloudEvents([later], snapshot, {
				baselineMessages: baseline,
				messagesSnapshotEventCutoff: 0,
			}),
		).toEqual([later]);
	});

	it("replays content the snapshot does NOT contain", () => {
		const buffered = [
			event("assistant.delta", "a-1", { text: "unpersisted reply" }),
			event("run.completed", "done-1"),
		];
		expect(
			reconcileBufferedCloudEvents(buffered, [
				{ role: "assistant", content: "a completely different answer" },
			]).map((item) => item.event),
		).toEqual(["assistant.delta", "run.completed"]);
	});

	it("supersedes despite trailing whitespace in the streamed text", () => {
		const buffered = [
			event("assistant.finished", "f-1", { text: "the answer \n" }),
			event("run.completed", "done-1"),
		];
		expect(
			reconcileBufferedCloudEvents(buffered, [
				{ role: "assistant", content: "prefix the answer" },
			]).map((item) => item.event),
		).toEqual(["run.completed"]);
	});

	it("drops buffered queue snapshots when a fresh queue snapshot was applied", () => {
		const buffered = [
			event("session.pending_prompts", "q-1", { prompts: [] }),
			event("assistant.delta", "a-1", { text: "live tail" }),
		];
		expect(
			reconcileBufferedCloudEvents(buffered, []).map((item) => item.event),
		).toEqual(["assistant.delta"]);
	});

	it("replays the newest buffered queue snapshot when the queue fetch failed", () => {
		const buffered = [
			event("session.pending_prompts", "q-1", { prompts: [] }),
			event("session.pending_prompts", "q-2", {
				prompts: [{ id: "p-1", prompt: "queued work" }],
			}),
			event("assistant.delta", "a-1", { text: "live tail" }),
		];
		expect(
			reconcileBufferedCloudEvents(buffered, [], {
				queueSnapshotApplied: false,
			}).map((item) => item.eventId),
		).toEqual(["q-2", "a-1"]);
	});

	it("replays a queue snapshot received after the queue fetch", () => {
		const buffered = [
			event("session.pending_prompts", "q-old", { prompts: [] }),
			event("assistant.delta", "a-1", { text: "live tail" }),
			event("session.pending_prompts", "q-new", {
				prompts: [{ id: "p-1", prompt: "queued work" }],
			}),
		];
		expect(
			reconcileBufferedCloudEvents(buffered, [], {
				queueSnapshotEventCutoff: 1,
			}).map((item) => item.eventId),
		).toEqual(["a-1", "q-new"]);
	});

	it("supersedes content independently across two terminal run segments", () => {
		const buffered = [
			event("assistant.delta", "a-1", { text: "first tail" }),
			event("run.completed", "done-1"),
			event("assistant.delta", "a-2", { text: "second tail" }),
			event("run.completed", "done-2"),
		];

		expect(
			reconcileBufferedCloudEvents(buffered, [
				{ role: "assistant", content: "prefix first tail" },
				{ role: "assistant", content: "prefix second tail" },
			]).map((item) => item.event),
		).toEqual(["run.completed", "run.completed"]);
	});

	it("does not let an older identical reply supersede a new buffered turn", () => {
		const buffered = [
			event("assistant.delta", "a-2", { text: "Done" }),
			event("run.completed", "done-2"),
		];
		const baseline = [{ role: "assistant", content: "Done" }];

		expect(
			reconcileBufferedCloudEvents(buffered, baseline, {
				baselineMessages: baseline,
			}).map((item) => item.event),
		).toEqual(["assistant.delta", "run.completed"]);
		expect(
			reconcileBufferedCloudEvents(
				buffered,
				[...baseline, { role: "assistant", content: "Done" }],
				{ baselineMessages: baseline },
			).map((item) => item.event),
		).toEqual(["run.completed"]);
	});

	it("keeps run.failed while suppressing reflected content and dedupes tools by id", () => {
		const buffered = [
			event("assistant.delta", "a-1", { text: "partial failure" }),
			event("tool.started", "tool-1", { toolCallId: "call-1" }),
			event("run.failed", "failed-1", { error: "boom" }),
		];

		expect(
			reconcileBufferedCloudEvents(buffered, [
				{ role: "assistant", content: "saved partial failure" },
				{
					role: "assistant",
					content: [{ type: "tool_use", id: "call-1", name: "read_file" }],
				},
			]).map((item) => item.event),
		).toEqual(["run.failed"]);
	});
});
