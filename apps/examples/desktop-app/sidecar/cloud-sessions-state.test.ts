import { describe, expect, it, vi } from "vitest";
import {
	CloudSessionApi,
	CloudSessionManager,
	type CloudSessionRecord,
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
	// Stub transport ownership; exercise the real reconnect logic.
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

describe("CloudSessionManager reconnect", () => {
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
