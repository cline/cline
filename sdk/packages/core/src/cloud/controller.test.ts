import type {
	HubEventEnvelope,
	HubReplyEnvelope,
	MessageWithMetadata,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type { CloudSessionRecord } from "./api";
import {
	CloudQueueUnconfirmedError,
	CloudSessionController,
	type CloudSessionControllerOptions,
} from "./controller";
import type { CloudCreationOptions, CloudSessionEvent } from "./types";

const record: CloudSessionRecord = {
	id: "ses-outer",
	status: "ready",
	sandboxUrl: "",
	repoContext: { repoUrl: "https://github.com/cline/test", branch: "main" },
	metadata: { modelId: "model", taskId: "inner" },
	createdAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-01T00:00:00Z",
};
function fixture(options: Partial<CloudSessionControllerOptions> = {}) {
	let listener: ((event: HubEventEnvelope) => void) | undefined;
	let connectionOptions: Parameters<
		NonNullable<CloudSessionControllerOptions["createHubClient"]>
	>[0];
	let messages: MessageWithMetadata[] = [];
	let hasInner = true;
	let runtimeStatus = "idle";
	const commands: Array<{
		command: string;
		payload: unknown;
		sessionId?: string;
	}> = [];
	const api = {
		list: vi.fn(async () => [structuredClone(record)]),
		status: vi.fn(async () => ({ status: "ready" })),
		create: vi.fn(async () => ({
			sessionId: record.id,
			status: "ready",
			sandboxUrl: "",
			cleanupAuthToken: "secret",
		})),
		delete: vi.fn(async () => {}),
		updateTitle: vi.fn(async () => structuredClone(record)),
		history: vi.fn(async () => null),
		waitUntilReady: vi.fn(
			async (_sessionId: string, _signal: AbortSignal) => {},
		),
		listRepositories: vi.fn(async () => ({
			connected: true,
			connectUrl: "",
			repositories: [],
		})),
		listBranches: vi.fn(async () => ({ available: true, branches: ["main"] })),
	};
	const dispose = vi.fn(async () => {});
	const command = vi.fn(
		async (
			name: string,
			payload?: Record<string, unknown>,
			sessionId?: string,
			opts?: {
				beforeDispatch?: () => void;
				onDispatch?: (requestId: string) => void;
			},
		) => {
			opts?.beforeDispatch?.();
			opts?.onDispatch?.(`request-${commands.length}`);
			commands.push({ command: name, payload, sessionId });
			let result: Record<string, unknown> = {};
			if (name === "session.get" && !hasInner)
				throw Object.assign(new Error("session not found"), {
					code: "session_not_found",
				});
			if (name === "session.get")
				result = {
					session: {
						sessionId: "inner",
						status: runtimeStatus,
						metadata: { model: "model" },
					},
				};
			if (name === "session.attach") {
				if (!hasInner)
					throw Object.assign(new Error("session not found"), {
						code: "session_not_found",
					});
				result = { session: { sessionId: "inner", status: runtimeStatus } };
			}
			if (name === "session.list")
				result = {
					sessions: hasInner
						? [
								{
									sessionId: "inner",
									status: "idle",
									metadata: { model: "model" },
								},
							]
						: [],
				};
			if (name === "session.create") {
				hasInner = true;
				result = { sessionId: "inner" };
			}
			if (name === "session.messages") result = { messages };
			if (name === "session.pending_prompts") result = { prompts: [] };
			if (name === "session.send_input")
				result = {
					result: {
						text: "ok",
						usage: { inputTokens: 1, outputTokens: 1 },
						finishReason: "completed",
					},
				};
			return { version: "v1", ok: true, payload: result } as HubReplyEnvelope;
		},
	);
	const controller = new CloudSessionController({
		api: api as CloudSessionControllerOptions["api"],
		apiBaseUrl: "https://api.example",
		getAuthToken: async () => "token",
		createHubClient: (opts) => {
			connectionOptions = opts;
			return {
				command: command as never,
				dispose,
				connect: vi.fn(async () => {}),
				getClientId: () => "viewer",
				subscribe: (cb) => {
					listener = cb;
					return () => {
						listener = undefined;
					};
				},
			};
		},
		...options,
	});
	const events: CloudSessionEvent[] = [];
	controller.subscribe((event) => events.push(event));
	let sequence = 0;
	return {
		controller,
		api,
		events,
		commands,
		dispose,
		command,
		setMessages: (value: MessageWithMetadata[]) => {
			messages = value;
		},
		setStatus: (value: string) => {
			runtimeStatus = value;
		},
		setHasInner: (value: boolean) => {
			hasInner = value;
		},
		getConnectionOptions: () => connectionOptions,
		emit: (
			name: HubEventEnvelope["event"],
			payload: Record<string, unknown> = {},
			eventId?: string,
		) =>
			listener?.({
				version: "v1",
				event: name,
				eventId: eventId ?? `e-${++sequence}`,
				sessionId: "inner",
				timestamp: Date.now(),
				payload,
			}),
	};
}

async function attached() {
	const f = fixture();
	await f.controller.attach(record.id);
	await f.controller.readMessages(record.id);
	return f;
}

describe("CloudSessionController neutral host contract", () => {
	it("attaches a provisioning receipt without connecting or waiting for readiness", async () => {
		const f = fixture();
		f.api.list.mockResolvedValue([{ ...record, status: "provisioning" }]);
		f.api.status.mockResolvedValue({ status: "provisioning" });
		try {
			const attachment = await f.controller.attach(record.id);
			expect(attachment.status).toBe("provisioning");
			expect(f.controller.getSnapshot(record.id)?.status).toBe("provisioning");
			expect(f.api.waitUntilReady).not.toHaveBeenCalled();
			expect(f.getConnectionOptions()).toBeUndefined();
			expect(f.commands).toEqual([]);
		} finally {
			await f.controller.dispose();
		}
	});

	it("hydrates another viewer's prompt on first progress and canonical output at completion", async () => {
		const f = await attached();
		const user = {
			role: "user",
			content: "Other viewer prompt",
		} as MessageWithMetadata;
		f.setMessages([user]);
		f.setStatus("running");
		f.emit("run.started", {
			requestId: "other-request",
			clientId: "other-viewer",
		});
		f.emit("assistant.delta", { text: "Live" });
		await vi.waitFor(() =>
			expect(f.controller.getSnapshot(record.id)?.messages).toEqual([
				user,
				{ role: "assistant", content: [{ type: "text", text: "Live" }] },
			]),
		);
		f.emit("assistant.delta", { text: " answer" });
		expect(
			JSON.stringify(f.controller.getSnapshot(record.id)?.messages),
		).toContain("Live answer");
		const canonical = [
			user,
			{ role: "assistant", content: "Live answer" } as MessageWithMetadata,
		];
		f.setMessages(canonical);
		f.setStatus("completed");
		f.emit("assistant.finished", { text: "Live answer" });
		f.emit("run.completed");
		await vi.waitFor(() =>
			expect(f.controller.getSnapshot(record.id)?.messages).toEqual(canonical),
		);
		expect(
			f.events.filter((event) => event.type === "prompt_accepted"),
		).toEqual([]);
		await f.controller.dispose();
	});
	it.each([
		false,
		true,
	])("refreshes another viewer's transcript without streamed progress (running status first: %s)", async (runningStatusFirst) => {
		const f = await attached();
		if (runningStatusFirst)
			f.emit("session.updated", { session: { status: "running" } });
		f.emit("run.started", {
			requestId: "other-request",
			clientId: "other-viewer",
		});
		const canonical = [
			{ role: "user", content: "Failed remote turn" } as MessageWithMetadata,
		];
		f.setMessages(canonical);
		f.setStatus("failed");
		f.emit("run.failed", { error: "Remote failure" });
		await vi.waitFor(() =>
			expect(f.controller.getSnapshot(record.id)?.messages).toEqual(canonical),
		);
		expect(f.controller.getSnapshot(record.id)?.status).toBe("error");
		await f.controller.dispose();
	});
	it.each([
		"local",
		"other",
	] as const)("preserves the active external run when a %s viewer queues input", async (viewer) => {
		const f = await attached();
		const user = {
			role: "user",
			content: "Current turn",
		} as MessageWithMetadata;
		try {
			f.setStatus("running");
			f.setMessages([user]);
			f.emit("run.started", { requestId: "active", clientId: "other-viewer" });
			f.emit("assistant.delta", { text: "First" });
			await vi.waitFor(() =>
				expect(
					JSON.stringify(f.controller.getSnapshot(record.id)?.messages),
				).toContain("First"),
			);
			const reads = f.commands.filter(
				(command) => command.command === "session.messages",
			).length;
			if (viewer === "local") {
				const original = f.command.getMockImplementation()!;
				f.command.mockImplementation(
					async (name, payload, sessionId, options) => {
						const requestId = `request-${f.commands.length}`;
						const reply = await original(name, payload, sessionId, options);
						if (name === "session.send_input") {
							f.emit("run.started", { requestId, clientId: "viewer" });
						}
						return reply;
					},
				);
				await f.controller.send(record.id, "Next turn", "queue");
			} else {
				// The Hub emits run.started on queue acceptance, not only execution.
				f.emit("run.started", {
					requestId: "queued",
					clientId: "third-viewer",
				});
			}
			f.emit("assistant.delta", { text: " second" });
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(
				f.commands.filter((command) => command.command === "session.messages"),
			).toHaveLength(reads);
			expect(f.controller.getSnapshot(record.id)?.messages).toEqual([
				user,
				{
					role: "assistant",
					content: [{ type: "text", text: "First second" }],
				},
			]);
			const canonical = [
				user,
				{
					role: "assistant",
					content: "First second, canonical finish",
				} as MessageWithMetadata,
			];
			f.setMessages(canonical);
			f.setStatus("completed");
			f.emit("run.completed");
			await vi.waitFor(() =>
				expect(f.controller.getSnapshot(record.id)?.messages).toEqual(
					canonical,
				),
			);
		} finally {
			await f.controller.dispose();
		}
	});
	it.each([
		"missed",
		"partial",
		"complete",
	] as const)("reconciles finished content after attaching mid-run with %s deltas", async (deltas) => {
		const f = fixture();
		const user = {
			role: "user",
			content: "Already running when this viewer attached",
		} as MessageWithMetadata;
		const answer = {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "Canonical reasoning" },
				{ type: "text", text: "Canonical answer" },
			],
		} as MessageWithMetadata;
		try {
			f.setStatus("running");
			f.setMessages([user]);
			await f.controller.attach(record.id);
			f.emit("session.attached", { session: { status: "running" } });
			await f.controller.readMessages(record.id);
			const initial = f.controller.getSnapshot(record.id);
			// This viewer never receives the earlier run.started event.
			if (deltas !== "missed") {
				f.emit("reasoning.delta", {
					text: deltas === "partial" ? "reasoning" : "Canonical reasoning",
				});
			}
			f.emit("reasoning.finished", { reasoning: "Canonical reasoning" });
			if (deltas !== "missed") {
				f.emit("assistant.delta", {
					text: deltas === "partial" ? "answer" : "Canonical answer",
				});
			}
			f.setMessages([user, answer]);
			f.setStatus("completed");
			f.emit("assistant.finished", { text: "Canonical answer" });
			f.emit("run.completed");
			await vi.waitFor(() =>
				expect(f.controller.getSnapshot(record.id)).toMatchObject({
					status: "completed",
					busy: false,
					messages: [user, answer],
				}),
			);
			expect(initial?.messages).toEqual([user]);
		} finally {
			await f.controller.dispose();
		}
	});
	it("does not rearm late-attach tracking when terminal hydration reads a lagging running status", async () => {
		const f = fixture();
		try {
			f.setStatus("running");
			await f.controller.attach(record.id);
			await f.controller.readMessages(record.id);
			const reads = f.commands.filter(
				(command) => command.command === "session.messages",
			).length;
			const canonical = [
				{ role: "assistant", content: "Final answer" } as MessageWithMetadata,
			];
			f.setMessages(canonical);
			// The terminal event is authoritative even if session.get still lags.
			f.emit("run.completed");
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(f.controller.getSnapshot(record.id)).toMatchObject({
				status: "completed",
				busy: false,
				messages: canonical,
			});
			expect(
				f.commands.filter((command) => command.command === "session.messages"),
			).toHaveLength(reads + 1);
		} finally {
			await f.controller.dispose();
		}
	});
	it("confirms only the exact dispatched request and client before completion", async () => {
		const f = await attached();
		const original = f.command.getMockImplementation()!;
		let finish!: (reply: HubReplyEnvelope) => void;
		const completed = new Promise<HubReplyEnvelope>((resolve) => {
			finish = resolve;
		});
		let dispatched = false;
		f.command.mockImplementation(async (...args) => {
			if (args[0] !== "session.send_input") return original(...args);
			args[3]?.beforeDispatch?.();
			args[3]?.onDispatch?.("input-request");
			dispatched = true;
			return completed;
		});
		const sending = f.controller.send(record.id, "same prompt");
		await vi.waitFor(() => expect(dispatched).toBe(true));
		const accepted = () =>
			f.events.filter((event) => event.type === "prompt_accepted");
		expect(accepted()).toEqual([]);
		f.emit("run.started", {
			requestId: "input-request",
			clientId: "other-viewer",
		});
		f.emit("run.started", { requestId: "other-request", clientId: "viewer" });
		expect(accepted()).toEqual([]);
		f.emit("run.started", { requestId: "input-request", clientId: "viewer" });
		expect(accepted()).toEqual([
			{
				type: "prompt_accepted",
				sessionId: record.id,
				prompt: "same prompt",
				delivery: undefined,
			},
		]);
		f.emit("run.started", { requestId: "input-request", clientId: "viewer" });
		finish({
			version: "v1",
			ok: true,
			payload: { result: {} },
		} as HubReplyEnvelope);
		await sending;
		expect(accepted()).toHaveLength(1);
		await f.controller.dispose();
	});
	it("does not confirm a prompt cancelled before dispatch", async () => {
		const f = await attached();
		const original = f.command.getMockImplementation()!;
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let waiting = false;
		const onDispatch = vi.fn();
		f.command.mockImplementation(async (...args) => {
			if (args[0] !== "session.send_input") return original(...args);
			waiting = true;
			await gate;
			args[3]?.beforeDispatch?.();
			onDispatch();
			args[3]?.onDispatch?.("cancelled-request");
			return { version: "v1", ok: true } as HubReplyEnvelope;
		});
		const sending = f.controller.send(record.id, "cancel me");
		const rejected = expect(sending).rejects.toThrow("cancelled");
		await vi.waitFor(() => expect(waiting).toBe(true));
		await f.controller.detach(record.id);
		release();
		await rejected;
		expect(onDispatch).not.toHaveBeenCalled();
		expect(
			f.events.filter((event) => event.type === "prompt_accepted"),
		).toEqual([]);
		await f.controller.dispose();
	});
	it("confirms a queued prompt from its successful command acknowledgement", async () => {
		const f = await attached();
		await f.controller.send(record.id, "queued", "queue");
		expect(
			f.events.filter((event) => event.type === "prompt_accepted"),
		).toEqual([
			{
				type: "prompt_accepted",
				sessionId: record.id,
				prompt: "queued",
				delivery: "queue",
			},
		]);
		await f.controller.dispose();
	});
	it("reports an uncertain queue outcome when both acknowledgement and recovery fail", async () => {
		const f = await attached();
		const original = f.command.getMockImplementation()!;
		let dispatched = false;
		f.command.mockImplementation(async (...args) => {
			if (args[0] === "session.send_input") {
				dispatched = true;
				throw Object.assign(new Error("Connection closed"), {
					name: "HubTransportError",
					code: "hub_connection_closed",
				});
			}
			if (dispatched) throw new Error("Recovery unavailable");
			return original(...args);
		});
		try {
			await expect(
				f.controller.send(record.id, "queued once", "queue"),
			).rejects.toBeInstanceOf(CloudQueueUnconfirmedError);
			expect(
				f.command.mock.calls.filter(([name]) => name === "session.send_input"),
			).toHaveLength(1);
		} finally {
			await f.controller.dispose();
		}
	});
	it("batches full streaming snapshots while forwarding every delta immediately", async () => {
		const f = await attached();
		vi.useFakeTimers();
		const snapshotSpy = vi.spyOn(f.controller, "getSnapshot");
		f.events.length = 0;
		try {
			for (let index = 0; index < 50; index++)
				f.emit("assistant.delta", { text: "x" });
			expect(
				f.events.filter((event) => event.type === "hub_event"),
			).toHaveLength(50);
			expect(snapshotSpy).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(100);
			expect(snapshotSpy).toHaveBeenCalledTimes(1);
			const snapshotEvent = f.events.find((event) => event.type === "snapshot");
			if (snapshotEvent?.type !== "snapshot")
				throw new Error("Missing snapshot");
			expect(snapshotEvent.snapshot).toBe(snapshotSpy.mock.results[0]?.value);
			expect(Object.isFrozen(snapshotEvent)).toBe(true);
			expect(Object.isFrozen(snapshotEvent.snapshot.messages)).toBe(true);
			expect(JSON.stringify(snapshotEvent.snapshot.messages)).toContain(
				"x".repeat(50),
			);
			f.emit("assistant.delta", { text: "tail" });
			f.emit("run.completed", {});
			expect(snapshotSpy).toHaveBeenCalledTimes(2);
			await vi.advanceTimersByTimeAsync(100);
			expect(snapshotSpy).toHaveBeenCalledTimes(2);
			f.emit("assistant.delta", { text: "pending" });
			await f.controller.detach(record.id);
			const callsAfterDetach = snapshotSpy.mock.calls.length;
			await vi.advanceTimersByTimeAsync(100);
			expect(snapshotSpy).toHaveBeenCalledTimes(callsAfterDetach);
		} finally {
			await f.controller.dispose();
			vi.useRealTimers();
		}
	});
	it("keeps discovery rows separate from attached session snapshots", async () => {
		const f = fixture();
		try {
			expect(await f.controller.list()).toHaveLength(1);
			expect(f.events).toEqual([]);
			await f.controller.attach(record.id);
			f.events.length = 0;
			await f.controller.list();
			expect(f.events.some((event) => event.type === "snapshot")).toBe(true);
		} finally {
			await f.controller.dispose();
		}
	});
	it("owns frozen snapshots and reconciled live messages without leaking inner IDs", async () => {
		const f = await attached();
		const baseline = f.controller.getSnapshot(record.id)!;
		f.emit("run.started");
		f.emit("assistant.delta", { text: "Hello" }, "delta");
		f.emit("assistant.delta", { text: "Hello" }, "delta");
		const snapshot = f.controller.getSnapshot(record.id)!;
		expect(JSON.stringify(snapshot.messages)).toContain("Hello");
		expect(JSON.stringify(snapshot.messages)).not.toContain("HelloHello");
		expect(baseline.messages).toEqual([]);
		expect(Object.isFrozen(snapshot.messages)).toBe(true);
		expect(() =>
			snapshot.messages.push({ role: "user", content: "mutation" }),
		).toThrow();
		expect(
			f.events
				.filter((event) => event.type === "hub_event")
				.every(
					(event) =>
						event.sessionId === record.id &&
						event.event.sessionId === record.id,
				),
		).toBe(true);
		await f.controller.dispose();
	});
	it("keeps approvals server-owned and detaches without any decision, abort, or deletion", async () => {
		const f = await attached();
		f.emit("approval.requested", {
			approvalId: "approval",
			toolCallId: "tool",
			toolName: "run_commands",
			inputJson: '{"command":"true"}',
		});
		expect(f.controller.getSnapshot(record.id)?.approvals[0]?.approvalId).toBe(
			"approval",
		);
		const at = f.commands.length;
		await f.controller.detach(record.id);
		expect(f.commands.slice(at)).toEqual([]);
		expect(f.api.delete).not.toHaveBeenCalled();
		expect(f.controller.getSnapshot(record.id)?.approvals).toEqual([]);
		expect(f.controller.getSnapshot(record.id)?.connectionState).toBe(
			"detached",
		);
		await expect(
			f.controller.respondApproval(record.id, "approval", { approved: true }),
		).rejects.toThrow();
		expect(f.dispose).toHaveBeenCalledOnce();
		await f.controller.dispose();
	});
	it("answers only explicit approvals and removes another viewer's resolution", async () => {
		const f = await attached();
		f.emit("approval.requested", {
			approvalId: "a",
			toolCallId: "tool",
			toolName: "run_commands",
		});
		await f.controller.respondApproval(record.id, "a", {
			approved: false,
			reason: "No",
		});
		expect(f.commands.at(-1)).toMatchObject({
			command: "approval.respond",
			sessionId: "inner",
			payload: { approvalId: "a", approved: false, reason: "No" },
		});
		f.emit("approval.resolved", { approvalId: "a" });
		expect(f.controller.getSnapshot(record.id)?.approvals).toEqual([]);
		await f.controller.dispose();
	});
	it.each([
		"create",
		"discover",
		"delete",
	] as const)("clears retained first-task policy after %s", async (action) => {
		const pendingInitialTasks = new Map<string, CloudCreationOptions>();
		const f = fixture({ pendingInitialTasks });
		const options = { autoApproveTools: false, thinking: false };
		try {
			await f.controller.create({
				modelId: "model",
				repoUrl: record.repoContext.repoUrl!,
				...options,
			});
			expect(pendingInitialTasks.get(record.id)).toMatchObject(options);
			if (action === "create") {
				f.setHasInner(false);
				await f.controller.send(record.id, "First prompt");
			} else if (action === "discover") {
				await f.controller.attach(record.id);
			} else {
				await f.controller.delete(record.id);
			}
			expect(pendingInitialTasks.has(record.id)).toBe(false);
		} finally {
			await f.controller.dispose();
		}
		const replacement = fixture({ pendingInitialTasks });
		replacement.setHasInner(false);
		try {
			await expect(
				replacement.controller.attach(record.id, options),
			).rejects.toThrow("task is unavailable");
			expect(
				replacement.commands.some((c) => c.command === "session.create"),
			).toBe(false);
		} finally {
			await replacement.controller.dispose();
		}
	});
	it("does not recreate a missing established session with manual creation options", async () => {
		const f = fixture();
		f.setHasInner(false);
		await expect(
			f.controller.attach(record.id, {
				autoApproveTools: false,
				thinking: true,
				reasoningEffort: "high",
			}),
		).rejects.toThrow("task is unavailable");
		expect(f.commands.some((item) => item.command === "session.create")).toBe(
			false,
		);
		await f.controller.dispose();
	});
	it.each([
		"preserve",
		"delete",
	] as const)("uses explicit %s policy for a POST completing after disposal", async (policy) => {
		let resolve!: (value: {
			sessionId: string;
			status: string;
			sandboxUrl: string;
			cleanupAuthToken: string;
		}) => void;
		const created = new Promise<{
			sessionId: string;
			status: string;
			sandboxUrl: string;
			cleanupAuthToken: string;
		}>((r) => {
			resolve = r;
		});
		const f = fixture({ lateCreateDisposition: policy });
		f.api.create.mockImplementationOnce(() => created);
		const creating = f.controller
			.create({
				requestId: "request",
				modelId: "model",
				repoUrl: record.repoContext.repoUrl!,
			})
			.catch((error) => error);
		await vi.waitFor(() => expect(f.api.create).toHaveBeenCalledOnce());
		await f.controller.dispose();
		resolve({
			sessionId: record.id,
			status: "ready",
			sandboxUrl: "",
			cleanupAuthToken: "same-account",
		});
		expect(await creating).toBeInstanceOf(Error);
		expect(f.api.delete).toHaveBeenCalledTimes(policy === "delete" ? 1 : 0);
		expect(f.controller.getSnapshot(record.id)).toBeUndefined();
	});
	it("cancels an in-flight connection across detach and immediate reattach", async () => {
		const f = fixture();
		let resolve!: (records: CloudSessionRecord[]) => void;
		const blocked = new Promise<CloudSessionRecord[]>((r) => {
			resolve = r;
		});
		f.api.list.mockImplementationOnce(() => blocked);
		const first = f.controller.attach(record.id).catch((error) => error);
		await vi.waitFor(() => expect(f.api.list).toHaveBeenCalledOnce());
		await f.controller.detach(record.id);
		const second = f.controller.attach(record.id);
		resolve([structuredClone(record)]);
		await second;
		expect(await first).toBeInstanceOf(Error);
		await f.controller.dispose();
	});
	it("resolves fresh authorization for each reconnect and stops resolvers after detach", async () => {
		let token = "first";
		const f = fixture({ getAuthToken: async () => token });
		await f.controller.attach(record.id);
		const headers = f.getConnectionOptions().resolveConnectionHeaders!;
		expect(await headers()).toEqual({ Authorization: "Bearer first" });
		token = "second";
		expect(await headers()).toEqual({ Authorization: "Bearer second" });
		await f.controller.detach(record.id);
		await expect(headers()).rejects.toThrow(/disposed|detached/);
		await f.controller.dispose();
	});
	it("replaces authoritative snapshots before emitting a new stream tail", async () => {
		const f = await attached();
		f.emit("assistant.delta", { text: "Old" });
		f.setMessages([{ role: "assistant", content: "Authoritative" }]);
		f.events.length = 0;
		await f.controller.readMessages(record.id);
		expect(
			f.events.some((event) => event.type === "snapshot" && event.replace),
		).toBe(true);
		expect(
			JSON.stringify(f.controller.getSnapshot(record.id)?.messages),
		).toContain("Authoritative");
		expect(
			JSON.stringify(f.controller.getSnapshot(record.id)?.messages),
		).not.toContain("Old");
		await f.controller.dispose();
	});
});
