import type {
	HubEventEnvelope,
	HubReplyEnvelope,
	MessageWithMetadata,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	CloudSessionError,
	type CloudSessionRecord,
	type CreateCloudSessionInput,
} from "./api";
import {
	CloudQueueUnconfirmedError,
	CloudSessionController,
	type CloudSessionControllerOptions,
} from "./controller";
import type {
	CloudCreationOptions,
	CloudHandoffSeed,
	CloudSessionEvent,
} from "./types";

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
		create: vi.fn(async (_input: CreateCloudSessionInput) => ({
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
	it("lists models for the fresh organization without provisioning a session", async () => {
		const getActiveOrganizationId = vi.fn(async () => "org");
		const f = fixture({ getActiveOrganizationId });
		const fetcher = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (input) =>
				Response.json(
					String(input).endsWith("/models")
						? [{ id: "model" }]
						: { clinePass: [{ id: "pass-only" }] },
				),
			);
		try {
			expect(await f.controller.listModels()).toEqual([
				{ id: "model", name: "model", catalogId: "cline" },
			]);
			expect(getActiveOrganizationId).toHaveBeenCalledWith({ fresh: true });
			expect(f.api.create).not.toHaveBeenCalled();
		} finally {
			fetcher.mockRestore();
			await f.controller.dispose();
		}
	});
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
	it.each([
		"succeeds",
		"fails",
	])("reports an uncertain queue outcome when acknowledgement is lost and recovery %s", async (recovery) => {
		const f = await attached();
		const original = f.command.getMockImplementation()!;
		let dispatched = false;
		f.command.mockImplementation(async (...args) => {
			if (args[0] === "session.send_input") {
				args[3]?.beforeDispatch?.();
				args[3]?.onDispatch?.("queued-request");
				dispatched = true;
				throw Object.assign(new Error("Connection closed"), {
					name: "HubTransportError",
					code: "hub_connection_closed",
				});
			}
			if (dispatched && recovery === "fails")
				throw new Error("Recovery unavailable");
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
	it.each([
		["persist", true],
		["persist", false],
		["transcript", true],
		["transcript", false],
	] as const)("limits disposal cleanup to owned handoff targets (%s, created: %s)", async (stage, created) => {
		const f = fixture({ lateCreateDisposition: "delete" });
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const pause = vi.fn(() => gate);
		const onRemoved = vi.fn(async () => {});
		const create = f.api.create.getMockImplementation()!;
		f.api.create.mockImplementationOnce(async (input) => {
			await input.handoff?.onOuterSessionCreated(record.id, { created });
			return create(input);
		});
		const creating = f.controller
			.create({
				requestId: "handoff:stable",
				modelId: "model",
				repoUrl: record.repoContext.repoUrl!,
				handoff: {
					sourceSessionId: "source",
					onCreating: async () => {},
					onOuterSessionCreated: async () => {
						if (stage === "persist") await pause();
					},
					onOuterSessionRemoved: onRemoved,
					resolveMessages: async () => {
						if (stage === "transcript") await pause();
						return [];
					},
				},
			})
			.catch((error) => error);
		await vi.waitFor(() => expect(pause).toHaveBeenCalledOnce());
		await f.controller.dispose();
		release();
		expect(await creating).toBeInstanceOf(Error);
		expect(f.api.delete).toHaveBeenCalledTimes(created ? 1 : 0);
		expect(onRemoved).toHaveBeenCalledTimes(created ? 1 : 0);
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

describe("seeded cloud handoff controller", () => {
	const record: CloudSessionRecord = {
		id: "ses-seeded",
		status: "ready",
		sandboxUrl: "",
		repoContext: { repoUrl: "https://github.com/cline/repo", branch: "main" },
		metadata: { modelId: "model" },
		createdAt: "2026-01-01",
		updatedAt: "2026-01-01",
	};
	const messages: MessageWithMetadata[] = [
		{ role: "user", content: [{ type: "text", text: "Prior request" }] },
		{ role: "assistant", content: [{ type: "text", text: "Prior answer" }] },
	];
	const seed: CloudHandoffSeed = {
		sourceSessionId: "local-source",
		messages,
		mode: "plan",
		workspaceRelativePath: "packages/app",
		config: {
			autoApproveTools: false,
			thinking: true,
			reasoningEffort: "high",
		},
	};
	function fixture(taskId?: string) {
		let rows: Record<string, unknown>[] = [];
		let transcript: MessageWithMetadata[] = [];
		let failure: "none" | "timeout" | "malformed" | "send-timeout" | "connect" =
			"none";
		const calls: Array<{ name: string; payload?: Record<string, unknown> }> =
			[];
		const command = vi.fn(
			async (
				name: string,
				payload?: Record<string, unknown>,
				_sessionId?: string,
				options?: {
					beforeDispatch?: () => void;
					onDispatch?: (requestId: string) => void;
				},
			) => {
				if (name === "session.create" && failure === "connect")
					throw Object.assign(new Error("connection failed"), {
						name: "HubTransportError",
						code: "hub_connect_failed",
					});
				options?.beforeDispatch?.();
				options?.onDispatch?.("seed-request");
				calls.push({ name, payload });
				let result: Record<string, unknown> = {};
				if (name === "session.list") result = { sessions: rows };
				if (name === "session.get")
					result = {
						session: rows.find((row) => row.sessionId === payload?.sessionId),
					};
				if (name === "session.attach") result = { session: rows[0] };
				if (name === "session.messages") result = { messages: transcript };
				if (name === "session.pending_prompts") result = { prompts: [] };
				if (name === "session.send_input" && failure === "send-timeout")
					throw Object.assign(new Error("lost send reply"), {
						name: "HubTransportError",
						code: "hub_connection_closed",
					});
				if (name === "session.create") {
					if (failure === "timeout")
						throw Object.assign(new Error("lost create reply"), {
							name: "HubCommandError",
							code: "hub_command_timeout",
							command: "session.create",
						});
					if (failure !== "malformed") {
						const config = payload?.sessionConfig as Record<string, unknown>;
						rows = [
							{
								sessionId: "inner-seeded",
								status: "idle",
								metadata: payload?.metadata,
								cwd: config.cwd,
								runtimeOptions: { mode: config.mode },
							},
						];
						transcript = structuredClone(
							(payload?.initialMessages as MessageWithMetadata[]) ?? [],
						);
						result = { session: rows[0] };
					}
				}
				return { version: "v1", ok: true, payload: result } as HubReplyEnvelope;
			},
		);
		const api = {
			create: vi.fn(async (input: CreateCloudSessionInput) => {
				await input.handoff?.onOuterSessionCreated(record.id, {
					created: true,
				});
				return {
					sessionId: record.id,
					status: "ready",
					sandboxUrl: "",
					cleanupAuthToken: "token",
				};
			}),
			list: vi.fn(async () => [
				{
					...structuredClone(record),
					metadata: { ...record.metadata, taskId },
				},
			]),
			status: vi.fn(async () => ({ status: "ready" })),
			waitUntilReady: vi.fn(async () => {}),
			delete: vi.fn(async () => {}),
			history: vi.fn(async () => null),
			updateTitle: vi.fn(async () => record),
			listRepositories: vi.fn(async () => ({
				connected: true,
				connectUrl: "https://app/integrations",
				repositories: [
					{
						id: 1,
						name: "repo",
						fullName: "cline/repo",
						url: record.repoContext.repoUrl!,
						defaultBranch: "main",
					},
				],
			})),
			listBranches: vi.fn(async () => ({
				available: true,
				branches: ["main"],
			})),
		};
		const controller = new CloudSessionController({
			api,
			apiBaseUrl: "https://api.example",
			getAuthToken: async () => "token",
			getActiveOrganizationId: async () => "active-org",
			createHubClient: () => ({
				command: command as never,
				connect: async () => {},
				dispose: async () => {},
				getClientId: () => "viewer",
				subscribe: () => () => {},
			}),
		} satisfies CloudSessionControllerOptions);
		return {
			controller,
			api,
			calls,
			setRows: (value: typeof rows) => {
				rows = value;
			},
			setTranscript: (value: typeof transcript) => {
				transcript = value;
			},
			setFailure: (value: typeof failure) => {
				failure = value;
			},
		};
	}

	it.each([
		undefined,
		"stale-task-id",
	])("recovers a matching root with a subagent child (taskId: %s)", async (taskId) => {
		const f = fixture(taskId);
		f.setRows([
			{
				sessionId: "root",
				metadata: { handoff: { sourceSessionId: seed.sourceSessionId } },
			},
			{
				sessionId: "child",
				parentSessionId: "root",
				metadata: { isSubagent: true },
			},
		]);
		try {
			await expect(
				f.controller.seedHandoff(record.id, { ...seed, recoverOnly: true }),
			).resolves.toEqual({ innerSessionId: "root" });
			expect(f.calls.filter((call) => call.name === "session.get")).toEqual(
				taskId ? [{ name: "session.get", payload: { sessionId: taskId } }] : [],
			);
			expect(f.calls.filter((call) => call.name === "session.create")).toEqual(
				[],
			);
		} finally {
			await f.controller.dispose();
		}
	});
	it("does not use old identical seeded text to confirm a new ambiguous send", async () => {
		const f = fixture();
		await f.controller.seedHandoff(record.id, seed);
		await f.controller.verifyHandoffTranscript(record.id, messages);
		f.setFailure("send-timeout");
		await expect(f.controller.send(record.id, "Prior request")).rejects.toThrow(
			"could not confirm whether this message was accepted",
		);
		await f.controller.dispose();
	});
	it("persists the outer id before reading/seeding and preserves mode, subdirectory and approval policy", async () => {
		const f = fixture();
		const order: string[] = [];
		const result = await f.controller.create({
			requestId: "handoff:stable",
			modelId: "model",
			repoUrl: record.repoContext.repoUrl!,
			organizationId: null,
			...seed.config,
			mode: seed.mode,
			workspaceRelativePath: seed.workspaceRelativePath,
			handoff: {
				sourceSessionId: seed.sourceSessionId,
				onCreating: async () => {},
				onOuterSessionCreated: async () => {
					order.push("persist");
				},
				resolveMessages: async () => {
					order.push("read");
					return messages;
				},
				onSeeding: async () => {
					order.push("dispatch marker");
				},
			},
		});
		expect(order).toEqual(["persist", "read", "dispatch marker"]);
		expect(f.api.create.mock.calls[0][0].organizationId).toBeUndefined();
		expect(result.cwd).toBe("/workspace/packages/app");
		expect(result.innerSessionId).toBe("inner-seeded");
		expect(
			f.calls.find((call) => call.name === "session.create")?.payload,
		).toMatchObject({
			initialMessages: messages,
			cwd: "/workspace/packages/app",
			sessionConfig: {
				mode: "plan",
				cwd: "/workspace/packages/app",
				thinking: true,
				reasoningEffort: "high",
			},
			runtimeOptions: { mode: "plan" },
			toolPolicies: { "*": { autoApprove: false } },
			metadata: {
				interactive: true,
				handoff: { sourceSessionId: "local-source", outerSessionId: record.id },
			},
		});
		expect(f.controller.getSnapshot(record.id)?.transcriptKnown).toBe(false);
		const prompt = (
			f.calls.find((call) => call.name === "session.create")?.payload
				?.sessionConfig as Record<string, unknown>
		).systemPrompt as string;
		expect(prompt).toContain("egress proxy");
		expect(prompt).toContain("must never run `gh auth login`");
		expect(prompt).toContain("fresh Linux clone");
		expect(prompt).toContain("are stale");
		expect(prompt).toContain("subdirectory at /workspace/packages/app");
		expect(prompt).not.toContain("SAVE YOUR WORK");
		await f.controller.verifyHandoffTranscript(record.id, messages);
		expect(f.controller.getSnapshot(record.id)).toMatchObject({
			transcriptKnown: true,
			messages,
			config: { mode: "plan", cwd: "/workspace/packages/app" },
		});
		expect(f.calls.some((call) => call.name === "session.send_input")).toBe(
			false,
		);
		await f.controller.dispose();
	});
	it("reattaches and adopts a seeded conversation with its saved mode without reseeding", async () => {
		const f = fixture();
		f.setRows([
			{
				sessionId: "existing",
				status: "idle",
				cwd: "/workspace/packages/app",
				runtimeOptions: { mode: "plan" },
				metadata: {
					model: "model",
					handoff: { sourceSessionId: seed.sourceSessionId },
				},
			},
		]);
		f.setTranscript(messages);
		await f.controller.attach(record.id);
		expect(f.controller.getSnapshot(record.id)?.config.mode).toBe("plan");
		await f.controller.seedHandoff(record.id, { ...seed, recoverOnly: true });
		await f.controller.verifyHandoffTranscript(record.id, messages);
		expect(f.calls.filter((call) => call.name === "session.create")).toEqual(
			[],
		);
		await f.controller.dispose();
	});
	it.each([
		"different source",
		"multiple conversations",
	])("refuses %s without mutating the sandbox", async (kind) => {
		const f = fixture();
		const row = {
			sessionId: "existing",
			metadata: {
				handoff: {
					sourceSessionId:
						kind === "different source" ? "other" : seed.sourceSessionId,
				},
			},
		};
		f.setRows(
			kind === "different source"
				? [row]
				: [row, { ...row, sessionId: "second" }],
		);
		await expect(f.controller.seedHandoff(record.id, seed)).rejects.toThrow(
			"another conversation",
		);
		expect(f.calls.filter((call) => call.name === "session.create")).toEqual(
			[],
		);
		expect(f.api.delete).not.toHaveBeenCalled();
		await f.controller.dispose();
	});
	it.each([
		"timeout",
		"malformed",
	] as const)("never repeats an ambiguous seeded create after %s", async (failure) => {
		const f = fixture();
		f.setFailure(failure);
		await expect(f.controller.seedHandoff(record.id, seed)).rejects.toThrow();
		f.setFailure("none");
		await expect(f.controller.seedHandoff(record.id, seed)).rejects.toThrow(
			"unconfirmed",
		);
		expect(
			f.calls.filter((call) => call.name === "session.create"),
		).toHaveLength(1);
		await f.controller.dispose();
	});
	it("respects a durable recovery-only seed fence in a new controller", async () => {
		const f = fixture();
		await expect(
			f.controller.seedHandoff(record.id, { ...seed, recoverOnly: true }),
		).rejects.toThrow("unconfirmed");
		expect(
			f.calls.filter((call) => call.name === "session.create"),
		).toHaveLength(0);
		await f.controller.dispose();
	});
	it.each([
		"detach",
		"dispose",
	] as const)("makes pre-dispatch %s retryable in a new controller", async (cancel) => {
		const f = fixture();
		let release!: () => void;
		const marker = new Promise<void>((resolve) => {
			release = resolve;
		});
		const started = vi.fn(() => marker);
		const pending = f.controller.seedHandoff(record.id, {
			...seed,
			onSeeding: started,
		});
		const rejection = expect(pending).rejects.toMatchObject({
			name: "CloudHandoffSeedRejectedError",
		});
		await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
		expect(
			f.calls.filter((call) => call.name === "session.create"),
		).toHaveLength(0);
		if (cancel === "detach") await f.controller.detach(record.id);
		else await f.controller.dispose();
		release();
		await rejection;
		expect(
			f.calls.filter((call) => call.name === "session.create"),
		).toHaveLength(0);
		await f.controller.dispose();
		const restarted = fixture();
		await expect(
			restarted.controller.seedHandoff(record.id, {
				...seed,
				recoverOnly: false,
			}),
		).resolves.toEqual({ innerSessionId: "inner-seeded" });
		await restarted.controller.dispose();
	});
	it.each([
		"connect",
		"hook",
	])("classifies a %s failure before seed dispatch as safe to retry", async (failure) => {
		const f = fixture();
		if (failure === "connect") f.setFailure("connect");
		await expect(
			f.controller.seedHandoff(record.id, {
				...seed,
				onSeeding: () => {
					if (failure === "hook") throw new Error("marker write failed");
				},
			}),
		).rejects.toMatchObject({ name: "CloudHandoffSeedRejectedError" });
		f.setFailure("none");
		await expect(f.controller.seedHandoff(record.id, seed)).resolves.toEqual({
			innerSessionId: "inner-seeded",
		});
		expect(
			f.calls.filter((call) => call.name === "session.create"),
		).toHaveLength(1);
		await f.controller.dispose();
	});
	it("requires a durable read-back and permits appended messages only when requested", async () => {
		const f = fixture();
		await f.controller.seedHandoff(record.id, seed);
		f.setTranscript([]);
		await expect(
			f.controller.verifyHandoffTranscript(record.id, messages),
		).rejects.toMatchObject({ name: "CloudHandoffSeedUnsupportedError" });
		f.setTranscript([...messages, { role: "user", content: "Later" }]);
		await expect(
			f.controller.verifyHandoffTranscript(record.id, messages),
		).rejects.toMatchObject({ name: "CloudHandoffTranscriptMismatchError" });
		await f.controller.verifyHandoffTranscript(record.id, messages, {
			allowAppendedMessages: true,
		});
		expect(f.controller.getSnapshot(record.id)?.messages).toHaveLength(3);
		await f.controller.dispose();
	});
	it.each([
		"../outside",
		"/outside",
		"folder/../outside",
		"folder\\outside",
	])("rejects unsafe cwd %s before provisioning", async (workspaceRelativePath) => {
		const f = fixture();
		await expect(
			f.controller.create({
				requestId: "r",
				modelId: "model",
				repoUrl: "repo",
				workspaceRelativePath,
			}),
		).rejects.toThrow("inside the repository");
		expect(f.api.create).not.toHaveBeenCalled();
		await f.controller.dispose();
	});
	it("distinguishes an absent handoff target from a failed lookup", async () => {
		const f = fixture();
		f.api.status.mockRejectedValueOnce(
			new CloudSessionError("session_not_found", "gone"),
		);
		expect(await f.controller.handoffTargetExists(record.id)).toBe(false);
		f.api.status.mockRejectedValueOnce(new Error("network"));
		await expect(f.controller.handoffTargetExists(record.id)).rejects.toThrow(
			"network",
		);
		await f.controller.prepareHandoffRepository(
			"https://github.com/cline/repo.git",
		);
		await f.controller.dispose();
	});
});
