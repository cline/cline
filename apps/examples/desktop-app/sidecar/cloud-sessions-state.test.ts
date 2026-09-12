import { HubCommandError, HubTransportError } from "@cline/core";
import type { HubEventEnvelope } from "@cline/shared";
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

describe("CloudSessionManager state", () => {
	it("keeps a pending send cancelled when deletion clears its abort token", async () => {
		const { manager, connection, ensureAttached, command } =
			await createFixture();
		manager["connections"].set("ses-outer", connection);
		vi.spyOn(manager["options"].api, "delete").mockResolvedValue(undefined);
		let releaseAttach!: () => void;
		ensureAttached.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					releaseAttach = resolve;
				}),
		);
		const result = manager
			.send("ses-outer", "cancel this")
			.catch((error: unknown) => error);
		await vi.waitFor(() => expect(releaseAttach).toBeDefined());
		await manager.abort("ses-outer");
		await manager.delete("ses-outer");
		releaseAttach();
		expect(await result).toMatchObject({
			message: "Cloud session prompt cancelled",
		});
		expect(connection.disposed).toBe(true);
		expect(connection.client.dispose).toHaveBeenCalledOnce();
		expect(
			command.mock.calls.some(([name]) => name === "session.send_input"),
		).toBe(false);
	});

	it("does not dispatch a pending send after abort and allows a later send", async () => {
		const { manager, ensureAttached, command } = await createFixture();
		let releaseAttach!: () => void;
		ensureAttached.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					releaseAttach = resolve;
				}),
		);
		const sending = manager.send("ses-outer", "cancel this");
		const result = sending.catch((error: unknown) => error);
		await vi.waitFor(() => expect(releaseAttach).toBeDefined());
		await manager.abort("ses-outer");
		releaseAttach();
		expect(await result).toBeInstanceOf(Error);
		expect(
			command.mock.calls.some(([name]) => name === "session.send_input"),
		).toBe(false);
		await manager.send("ses-outer", "send this instead");
		expect(
			command.mock.calls.filter(([name]) => name === "session.send_input"),
		).toHaveLength(1);
	});

	it("refreshes the completion time for a later turn completed while disconnected", async () => {
		const { manager, live, replies } = await createFixture();
		live.status = "running";
		live.endedAt = 1;
		replies["session.get"] = { session: { status: "completed" } };
		await manager.readMessages("ses-outer");
		expect(live.endedAt).toBeGreaterThan(1);
	});

	it("rejects malformed queue command replies instead of clearing the queue", async () => {
		const { manager, live, replies } = await createFixture();
		replies["session.pending_prompts"] = {
			prompts: [
				{
					id: "q-1",
					prompt: "queued",
					userImages: ["data:image/png;base64,AQID"],
				},
			],
		};
		await manager.pendingPrompts("ses-outer");
		expect(live.promptsInQueue).toMatchObject([
			{ id: "q-1", userImages: ["data:image/png;base64,AQID"] },
		]);
		const previous = live.promptsInQueue;
		replies["session.pending_prompts"] = {};
		await expect(manager.pendingPrompts("ses-outer")).rejects.toThrow(
			"invalid pending-prompts snapshot",
		);
		expect(live.promptsInQueue).toBe(previous);
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

	it("queues an implicit send when a cold session is already running", async () => {
		const { manager, command, replies } = await createFixture();
		replies["session.get"] = { session: { status: "running" } };
		await expect(
			manager.send("ses-outer", "Run this next"),
		).resolves.toMatchObject({ ok: true, queued: true });
		expect(command).toHaveBeenCalledWith(
			"session.send_input",
			{ prompt: "Run this next", delivery: "queue" },
			"inner-1",
			{ timeoutMs: 30_000 },
		);
	});

	it("does not confirm a lost duplicate prompt against an earlier delivery", async () => {
		const { manager, command, replies, live } = await createFixture();
		await manager.send("ses-outer", "yes");
		live.busy = false;
		replies["session.messages"] = {
			messages: [
				{ role: "user", content: '<user_input mode="act">yes</user_input>' },
			],
		};
		command.mockRejectedValueOnce(transportError());
		await expect(manager.send("ses-outer", "yes")).rejects.toThrow(
			/please send it again/,
		);
	});

	it("does not confirm two queued sends from one matching recovered prompt", async () => {
		const { manager, command, replies, reply } = await createFixture();
		await manager.readMessages("ses-outer");
		const blocked = Promise.withResolvers<void>();
		const reached = Promise.withResolvers<void>();
		let sends = 0;
		command.mockImplementation(async (name) => {
			if (name === "session.send_input") {
				if (++sends === 2) reached.resolve();
				await blocked.promise;
				throw transportError();
			}
			return reply(name);
		});
		const results = Promise.allSettled([
			manager.send("ses-outer", "same prompt", "queue"),
			manager.send("ses-outer", "same prompt", "queue"),
		]);
		await reached.promise;
		// Only one command was accepted by the Hub; neither reply reached this client.
		replies["session.pending_prompts"] = {
			prompts: [{ id: "accepted", prompt: "same prompt", delivery: "queue" }],
		};
		blocked.resolve();
		for (const result of await results) {
			expect(result.status).toBe("rejected");
			if (result.status === "rejected") {
				expect(result.reason.message).toMatch(
					/could not confirm.*before resending/,
				);
			}
		}
		expect(sends).toBe(2);
	});

	it("reattaches after a transport failure without retrying the prompt", async () => {
		const { manager, command, replies, ensureAttached } = await createFixture();
		await manager.readMessages("ses-outer");
		command.mockClear();
		ensureAttached.mockClear();
		replies["session.messages"] = {
			messages: [
				{
					role: "user",
					content: '<user_input mode="act">Do this once</user_input>',
				},
			],
		};
		replies["session.get"] = { session: { status: "running" } };
		command.mockRejectedValueOnce(transportError());
		await expect(
			manager.send("ses-outer", "Do this once"),
		).resolves.toMatchObject({
			ok: true,
			recoveredAfterDisconnect: true,
			status: "running",
		});
		expect(command.mock.calls.map(([name]) => name)).toEqual([
			"session.send_input",
			"session.get",
			"session.messages",
			"session.pending_prompts",
		]);
		expect(ensureAttached).toHaveBeenCalledTimes(2);
	});

	it("asks the user to resend when transport recovery cannot find the prompt", async () => {
		const { manager, command } = await createFixture();
		await manager.readMessages("ses-outer");
		command.mockRejectedValueOnce(transportError());
		await expect(manager.send("ses-outer", "Lost prompt")).rejects.toThrow(
			/not found in the cloud session.*send it again/i,
		);
		expect(
			command.mock.calls.filter(([name]) => name === "session.send_input"),
		).toHaveLength(1);
	});

	it("keeps a lost steer reply uncertain even with matching recovery events", async () => {
		const { manager, command, connection, reply } = await createFixture();
		await manager.readMessages("ses-outer");
		command
			.mockImplementation(async (name) => {
				if (name === "session.messages")
					connection.bufferedEvents.push({
						version: "v1",
						event: "session.pending_prompt_submitted",
						sessionId: "inner-1",
						payload: {
							prompt: {
								id: "steer-1",
								prompt: "Steer accepted",
								delivery: "steer",
								attachmentCount: 0,
							},
						},
					});
				return reply(name);
			})
			.mockRejectedValueOnce(transportError());
		await expect(
			manager.send("ses-outer", "Steer accepted", "steer"),
		).rejects.toThrow(/could not confirm.*before resending/);
		expect(
			command.mock.calls.filter(([name]) => name === "session.send_input"),
		).toHaveLength(1);
	});

	it.each([
		"transport",
		"timeout",
	])("keeps a queued %s failure uncertain despite a matching snapshot", async (failure) => {
		const { manager, command, replies } = await createFixture();
		await manager.readMessages("ses-outer");
		replies["session.pending_prompts"] = {
			prompts: [
				{
					id: "q-1",
					prompt: "Queued during disconnect",
					delivery: "queue",
					attachmentCount: 0,
				},
			],
		};
		command.mockRejectedValueOnce(
			failure === "timeout"
				? new HubCommandError(
						"session.send_input",
						"hub_command_timeout",
						"timed out",
					)
				: transportError(),
		);
		await expect(
			manager.send("ses-outer", "Queued during disconnect", "queue"),
		).rejects.toThrow(/could not confirm.*before resending/);
		expect(
			command.mock.calls.filter(([name]) => name === "session.send_input"),
		).toHaveLength(1);
	});

	it("names the session from the first prompt and supports rename", async () => {
		const { manager, live, updateTitle } = await createFixture();
		await manager.send(
			"ses-outer",
			"Fix the login bug\nwith more detail below",
		);
		expect(updateTitle).toHaveBeenCalledExactlyOnceWith(
			"ses-outer",
			"Fix the login bug",
		);
		expect(live.title).toBe("Fix the login bug");
		await manager.send("ses-outer", "another prompt");
		expect(updateTitle).toHaveBeenCalledTimes(1);
		await manager.updateTitle("ses-outer", "Renamed");
		expect(updateTitle).toHaveBeenLastCalledWith("ses-outer", "Renamed");
		expect(live.title).toBe("Renamed");
	});
});
