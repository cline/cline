import type {
	AgendaAutomationPolicy,
	AgendaTaskCreateInput,
	AgendaTaskRecord,
	AgendaTaskRunRecord,
	AgendaTaskUpdateInput,
} from "@cline/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HubSessionClient } from "./session-client";

type SocketListener = (...args: unknown[]) => void;

class MockWebSocket {
	static instances: MockWebSocket[] = [];
	static sentCommands: Array<{
		command: string;
		payload?: Record<string, unknown>;
	}> = [];
	static commandPayloads = new Map<string, Record<string, unknown>>();

	readyState = 0;
	private readonly listeners = new Map<string, SocketListener[]>();

	constructor(_url: string) {
		MockWebSocket.instances.push(this);
		queueMicrotask(() => {
			this.readyState = 1;
			this.emit("open");
		});
	}

	static reset(): void {
		MockWebSocket.instances = [];
		MockWebSocket.sentCommands = [];
		MockWebSocket.commandPayloads.clear();
	}

	send(data: string): void {
		const frame = JSON.parse(data) as {
			kind?: string;
			envelope?: {
				requestId?: string;
				command?: string;
				payload?: Record<string, unknown>;
			};
		};
		if (frame.kind !== "command" || !frame.envelope?.requestId) {
			return;
		}
		const command = frame.envelope.command ?? "";
		MockWebSocket.sentCommands.push({
			command,
			payload: frame.envelope.payload,
		});
		queueMicrotask(() => {
			this.emitFrame({
				kind: "reply",
				envelope: {
					version: "v1",
					requestId: frame.envelope?.requestId,
					command: frame.envelope?.command,
					ok: true,
					payload: MockWebSocket.commandPayloads.get(command) ?? {},
				},
			});
		});
	}

	close(): void {
		this.readyState = 3;
		this.emit("close", { code: 1000, reason: "" });
	}

	addEventListener(type: string, listener: SocketListener): void {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	emitFrame(frame: unknown): void {
		this.emit("message", { data: JSON.stringify(frame) });
	}

	private emit(type: string, ...args: unknown[]): void {
		for (const listener of this.listeners.get(type) ?? []) {
			listener(...args);
		}
	}
}

describe("HubSessionClient", () => {
	afterEach(() => {
		MockWebSocket.reset();
		vi.unstubAllGlobals();
	});

	it("normalizes run.failed events to include a top-level error", async () => {
		vi.stubGlobal("WebSocket", MockWebSocket);
		const client = new HubSessionClient({
			address: "ws://127.0.0.1:25463/hub",
			clientId: "client-1",
		});
		await client.connect();
		const socket = MockWebSocket.instances[0];
		if (!socket) {
			throw new Error("expected websocket");
		}
		const received: Array<{
			sessionId: string;
			eventType: string;
			payload: Record<string, unknown>;
		}> = [];
		const unsubscribe = client.streamEvents(
			{ sessionIds: ["session-1"] },
			{
				onEvent: (event) => {
					received.push(event);
				},
			},
		);

		socket.emitFrame({
			kind: "event",
			envelope: {
				version: "v1",
				eventId: "evt-1",
				event: "run.failed",
				timestamp: Date.now(),
				sessionId: "session-1",
				payload: {
					reason: "error",
					result: {
						text: "Provider rejected the request",
						finishReason: "error",
					},
				},
			},
		});

		expect(received).toEqual([
			{
				sessionId: "session-1",
				eventType: "runtime.chat.failed",
				payload: {
					reason: "error",
					error: "Provider rejected the request",
					result: {
						text: "Provider rejected the request",
						finishReason: "error",
					},
				},
			},
		]);

		unsubscribe();
		client.close();
	});

	it("maps usage.updated events into runtime chat usage events", async () => {
		vi.stubGlobal("WebSocket", MockWebSocket);
		const client = new HubSessionClient({
			address: "ws://127.0.0.1:25463/hub",
			clientId: "client-1",
		});
		await client.connect();
		const socket = MockWebSocket.instances[0];
		if (!socket) {
			throw new Error("expected websocket");
		}
		const received: Array<{
			sessionId: string;
			eventType: string;
			payload: Record<string, unknown>;
		}> = [];
		const unsubscribe = client.streamEvents(
			{ sessionIds: ["session-1"] },
			{
				onEvent: (event) => {
					received.push(event);
				},
			},
		);

		socket.emitFrame({
			kind: "event",
			envelope: {
				version: "v1",
				eventId: "evt-usage",
				event: "usage.updated",
				timestamp: Date.now(),
				sessionId: "session-1",
				payload: {
					delta: { inputTokens: 7, outputTokens: 5, totalCost: 0.12 },
					aggregateUsage: { inputTokens: 17, outputTokens: 8, totalCost: 0.23 },
					agent: { kind: "teammate", teamAgentId: "investigator" },
				},
			},
		});

		expect(received).toEqual([
			{
				sessionId: "session-1",
				eventType: "runtime.chat.usage",
				payload: {
					delta: { inputTokens: 7, outputTokens: 5, totalCost: 0.12 },
					aggregateUsage: { inputTokens: 17, outputTokens: 8, totalCost: 0.23 },
					agent: { kind: "teammate", teamAgentId: "investigator" },
				},
			},
		]);

		unsubscribe();
		client.close();
	});

	it("maps tool.updated events into runtime tool-call updates", async () => {
		vi.stubGlobal("WebSocket", MockWebSocket);
		const client = new HubSessionClient({
			address: "ws://127.0.0.1:25463/hub",
			clientId: "client-1",
		});
		await client.connect();
		const socket = MockWebSocket.instances[0];
		if (!socket) throw new Error("expected websocket");
		const received: Array<{
			sessionId: string;
			eventType: string;
			payload: Record<string, unknown>;
		}> = [];
		const unsubscribe = client.streamEvents(
			{ sessionIds: ["session-1"] },
			{ onEvent: (event) => received.push(event) },
		);

		socket.emitFrame({
			kind: "event",
			envelope: {
				version: "v1",
				eventId: "evt-tool-update",
				event: "tool.updated",
				timestamp: Date.now(),
				sessionId: "session-1",
				payload: {
					toolCallId: "call-1",
					toolName: "run_commands",
					update: { stream: "stdout", chunk: "one\n" },
				},
			},
		});

		expect(received).toEqual([
			{
				sessionId: "session-1",
				eventType: "runtime.chat.tool_call_update",
				payload: {
					toolCallId: "call-1",
					toolName: "run_commands",
					update: { stream: "stdout", chunk: "one\n" },
				},
			},
		]);

		unsubscribe();
		client.close();
	});

	it("maps session.notice events without dropping their payload", async () => {
		vi.stubGlobal("WebSocket", MockWebSocket);
		const client = new HubSessionClient({
			address: "ws://127.0.0.1:25463/hub",
			clientId: "client-1",
		});
		await client.connect();
		const socket = MockWebSocket.instances[0];
		if (!socket) throw new Error("expected websocket");
		const received: unknown[] = [];
		const unsubscribe = client.streamEvents(
			{ sessionIds: ["session-1"] },
			{ onEvent: (event) => received.push(event) },
		);
		const payload = {
			message: "auto-compacted",
			noticeType: "status",
			metadata: { kind: "auto_compaction", phase: "completed" },
			agent: { kind: "teammate", teamRole: "teammate" },
		};
		socket.emitFrame({
			kind: "event",
			envelope: {
				version: "v1",
				eventId: "evt-notice",
				event: "session.notice",
				timestamp: Date.now(),
				sessionId: "session-1",
				payload,
			},
		});
		expect(received).toEqual([
			{
				sessionId: "session-1",
				eventType: "runtime.chat.notice",
				payload,
			},
		]);
		unsubscribe();
		client.close();
	});

	it("maps schedule execution events without requiring an envelope session id", async () => {
		vi.stubGlobal("WebSocket", MockWebSocket);
		const client = new HubSessionClient({
			address: "ws://127.0.0.1:25463/hub",
			clientId: "client-1",
		});
		await client.connect();
		const socket = MockWebSocket.instances[0];
		if (!socket) {
			throw new Error("expected websocket");
		}
		const received: Array<{
			sessionId: string;
			eventType: string;
			payload: Record<string, unknown>;
		}> = [];
		const unsubscribe = client.streamEvents(
			{ clientId: "schedule-listener" },
			{
				onEvent: (event) => {
					received.push(event);
				},
			},
		);

		socket.emitFrame({
			kind: "event",
			envelope: {
				version: "v1",
				eventId: "evt-schedule",
				event: "schedule.execution_completed",
				timestamp: Date.now(),
				payload: {
					scheduleId: "sched_1",
					executionId: "run_1",
					sessionId: "session-1",
					status: "success",
				},
			},
		});

		expect(received).toEqual([
			{
				sessionId: "session-1",
				eventType: "schedule.execution.completed",
				payload: {
					scheduleId: "sched_1",
					executionId: "run_1",
					sessionId: "session-1",
					status: "success",
				},
			},
		]);

		unsubscribe();
		client.close();
	});

	it("maps failed schedule execution events", async () => {
		vi.stubGlobal("WebSocket", MockWebSocket);
		const client = new HubSessionClient({
			address: "ws://127.0.0.1:25463/hub",
			clientId: "client-1",
		});
		await client.connect();
		const socket = MockWebSocket.instances[0];
		if (!socket) {
			throw new Error("expected websocket");
		}
		const received: Array<{
			sessionId: string;
			eventType: string;
			payload: Record<string, unknown>;
		}> = [];
		const unsubscribe = client.streamEvents(
			{ clientId: "schedule-listener" },
			{
				onEvent: (event) => {
					received.push(event);
				},
			},
		);

		socket.emitFrame({
			kind: "event",
			envelope: {
				version: "v1",
				eventId: "evt-schedule-failed",
				event: "schedule.execution_failed",
				timestamp: Date.now(),
				payload: {
					scheduleId: "sched_1",
					executionId: "run_1",
					sessionId: "session-1",
					status: "failed",
					errorMessage: "runtime failed",
				},
			},
		});

		expect(received).toEqual([
			{
				sessionId: "session-1",
				eventType: "schedule.execution.failed",
				payload: {
					scheduleId: "sched_1",
					executionId: "run_1",
					sessionId: "session-1",
					status: "failed",
					errorMessage: "runtime failed",
				},
			},
		]);

		unsubscribe();
		client.close();
	});

	it("sends typed task commands and returns their task queue payloads", async () => {
		vi.stubGlobal("WebSocket", MockWebSocket);
		const client = new HubSessionClient({
			address: "ws://127.0.0.1:25463/hub",
			clientId: "client-1",
		});
		const task: AgendaTaskRecord = {
			taskId: "task-1",
			type: "todo",
			status: "pending_approval",
			title: "Check the build",
			instructions: "Run the build and fix any failures.",
			scope: "workspace",
			workspaceRoot: "/repo",
			resourcePaths: [],
			priority: 1,
			availableAt: "2026-08-14T00:00:00.000Z",
			expiresAt: "2026-08-21T00:00:00.000Z",
			automationEligible: true,
			revision: 1,
			createdBy: { kind: "user", clientId: "client-1" },
			updatedBy: { kind: "user", clientId: "client-1" },
			createdAt: "2026-08-14T00:00:00.000Z",
			updatedAt: "2026-08-14T00:00:00.000Z",
		};
		const run: AgendaTaskRunRecord = {
			runId: "run-1",
			taskId: task.taskId,
			taskRevision: 1,
			attempt: 1,
			status: "starting",
			claimedAt: "2026-08-14T00:01:00.000Z",
			createdAt: "2026-08-14T00:01:00.000Z",
			updatedAt: "2026-08-14T00:01:00.000Z",
		};
		const policy: AgendaAutomationPolicy = {
			scopeKey: "global",
			mode: "manual",
			applyToAgentCreated: true,
			maxConcurrentRuns: 2,
			maxChainDepth: 1,
			maxStartsPerHour: 20,
			updatedAt: "2026-08-14T00:00:00.000Z",
		};
		MockWebSocket.commandPayloads.set("task.create", { task });
		MockWebSocket.commandPayloads.set("task.list", { tasks: [task] });
		MockWebSocket.commandPayloads.set("task.get", { task });
		MockWebSocket.commandPayloads.set("task.update", { task });
		MockWebSocket.commandPayloads.set("task.approve", { task });
		MockWebSocket.commandPayloads.set("task.cancel", { task });
		MockWebSocket.commandPayloads.set("task.run", { task, run });
		MockWebSocket.commandPayloads.set("task.automation.get", { policy });
		MockWebSocket.commandPayloads.set("task.automation.set", { policy });

		const createInput: AgendaTaskCreateInput = {
			type: "todo",
			title: task.title,
			instructions: task.instructions,
			scope: "workspace",
			workspaceRoot: "/repo",
			expiresAt: task.expiresAt,
			createdBy: task.createdBy,
		};
		const updateInput: AgendaTaskUpdateInput = {
			taskId: task.taskId,
			expectedRevision: 1,
			priority: 0,
			updatedBy: task.updatedBy,
		};
		const policyInput: Omit<AgendaAutomationPolicy, "updatedAt"> = {
			scopeKey: "global",
			mode: "manual",
			applyToAgentCreated: true,
			maxConcurrentRuns: 2,
			maxChainDepth: 1,
			maxStartsPerHour: 20,
		};

		expect(await client.createTask(createInput)).toEqual(task);
		expect(await client.listTasks({ priorities: [1] })).toEqual([task]);
		expect(await client.getTask(task.taskId)).toEqual(task);
		expect(await client.updateTask(updateInput)).toEqual(task);
		expect(await client.approveTask(task.taskId, 1)).toEqual(task);
		expect(await client.cancelTask(task.taskId, 1, "no longer needed")).toEqual(
			task,
		);
		expect(await client.runTask(task.taskId, 1)).toEqual({ task, run });
		expect(await client.getTaskAutomation()).toEqual(policy);
		expect(await client.setTaskAutomation(policyInput)).toEqual(policy);

		expect(
			MockWebSocket.sentCommands.filter(({ command }) =>
				command.startsWith("task."),
			),
		).toEqual([
			{ command: "task.create", payload: createInput },
			{ command: "task.list", payload: { priorities: [1] } },
			{ command: "task.get", payload: { taskId: "task-1" } },
			{ command: "task.update", payload: updateInput },
			{
				command: "task.approve",
				payload: { taskId: "task-1", expectedRevision: 1 },
			},
			{
				command: "task.cancel",
				payload: {
					taskId: "task-1",
					reason: "no longer needed",
					expectedRevision: 1,
				},
			},
			{
				command: "task.run",
				payload: { taskId: "task-1", expectedRevision: 1 },
			},
			{ command: "task.automation.get", payload: {} },
			{
				command: "task.automation.set",
				payload: { policy: policyInput },
			},
		]);

		client.close();
	});
});
