/**
 * Async runtime semantics over the SQLite authority: immediate FIFO
 * acknowledgement, durable queue, run attempts with capped retry,
 * steering, adaptive admission backpressure, managed workspaces,
 * canonical message capture, and manual crash recovery.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { BotConfig } from "@cline/bot";
import { createGatewayInstanceId, createRunId } from "@cline/shared/gateway";
import { describe, expect, it } from "vitest";
import { openGatewayDatabase } from "./db";
import { ensureGatewayDataDir, resolveGatewayPaths } from "./paths";
import {
	GatewayCallError,
	GatewayRuntime,
	MANAGED_WORKSPACE_ROOT,
} from "./runtime";
import { createGatewayStores } from "./stores";
import { ScriptedEnginePort, tempDataRoot, waitFor } from "./test-support";

function createRuntime(
	options: {
		engine?: ScriptedEnginePort;
		dataRoot?: string;
		maxAttempts?: number;
		maxPendingRunsPerSession?: number;
		leadConfig?: BotConfig;
		leadName?: string;
	} = {},
) {
	const dataRoot = options.dataRoot ?? tempDataRoot();
	const paths = resolveGatewayPaths({ dataRoot, namespace: "default" });
	ensureGatewayDataDir(paths);
	const database = openGatewayDatabase(paths.databaseFile);
	const instanceId = createGatewayInstanceId();
	const stores = createGatewayStores(database, instanceId);
	const engine = options.engine ?? new ScriptedEnginePort();
	const runtime = new GatewayRuntime({
		database,
		stores,
		paths,
		instanceId,
		engine,
		retry: { maxAttempts: options.maxAttempts ?? 1 },
		maxPendingRunsPerSession: options.maxPendingRunsPerSession,
		leadConfig: options.leadConfig,
		leadName: options.leadName,
	});
	runtime.bootstrap();
	return { runtime, stores, engine, paths, database, dataRoot };
}

describe("bootstrap lead profile", () => {
	it("reconciles updated profile rules while preserving user instructions", () => {
		const dataRoot = tempDataRoot();
		const first = createRuntime({
			dataRoot,
			leadConfig: { profileId: "cline" },
			leadName: "Cline",
		});
		const botId = first.runtime.defaultBotId;
		if (!botId) throw new Error("bootstrap failed");
		first.runtime.putBotSystemPrompt("test", {
			botId,
			content: "Keep answers concise.",
		});
		first.database.close();

		const second = createRuntime({
			dataRoot,
			leadConfig: {
				profileId: "cline-dad",
				profileSystemPrompt: "You are Cline Dad.",
				profileRules: "Inspect before acting.",
			},
			leadName: "Cline Dad",
		});
		const bot = second.stores.bots.get(botId);
		expect(bot?.identity.name).toBe("Cline Dad");
		expect(bot?.config).toMatchObject({
			profileId: "cline-dad",
			profileSystemPrompt: "You are Cline Dad.",
			profileRules: "Inspect before acting.",
			systemPrompt: "Keep answers concise.",
		});
		expect(second.runtime.getBotSystemPrompt(botId)).toEqual({
			content: "Keep answers concise.",
			bundledContent: "You are Cline Dad.",
			profileRulesContent: "Inspect before acting.",
			profileId: "cline-dad",
			revision: 2,
		});
		second.database.close();
	});
});

describe("run admission", () => {
	it("creates an empty canonical session before its first prompt", () => {
		const { runtime, stores } = createRuntime();
		const botId = runtime.defaultBotId;
		if (!botId) throw new Error("bootstrap failed");
		const session = runtime.createSession("desktop_test", {
			botId,
			workspaceRoot: "/workspace/project",
		});
		expect(session.workspace.rootPath).toBe("/workspace/project");
		expect(stores.sessions.get(session.sessionId)).toEqual(session);
		expect(stores.runs.listBySession(session.sessionId)).toEqual([]);
	});

	it("creates a dedicated session without replacing the canonical session", () => {
		const { runtime, stores } = createRuntime();
		const botId = runtime.defaultBotId;
		if (!botId) throw new Error("bootstrap failed");
		const canonical = runtime.createSession("desktop_test", {
			botId,
			workspaceRoot: "/workspace/project",
		});
		const dedicated = runtime.createSession("desktop_test", {
			botId,
			workspaceRoot: "/workspace/project",
			kind: "dedicated",
		});

		expect(canonical.kind).toBe("canonical");
		expect(stores.sessions.get(canonical.sessionId)?.state).toBe("active");
		expect(dedicated.kind).toBe("dedicated");
		expect(stores.sessions.get(dedicated.sessionId)?.state).toBe("active");
	});

	it("acks immediately with runId/acceptedAt/queuePosition and runs FIFO", async () => {
		const { runtime, stores, engine } = createRuntime();
		const botId = runtime.defaultBotId;
		if (!botId) {
			throw new Error("bootstrap failed");
		}
		const first = runtime.startRun("cli_test", { botId, prompt: "one" });
		expect(first.queuePosition).toBe(0);
		const second = runtime.startRun("cli_test", { botId, prompt: "two" });
		expect(second.queuePosition).toBe(1);
		expect(first.runId).not.toBe(second.runId);

		// The ack returned before any engine outcome: first is running,
		// second is durably queued behind it.
		expect(stores.runs.get(first.runId)?.state).toBe("running");
		expect(stores.runs.get(second.runId)?.state).toBe("queued");
		expect(engine.handles).toHaveLength(1);
		expect(engine.handles[0].invocation.input).toBe("one");

		engine.handles[0].settle({ outputText: "done one" });
		await waitFor(() => stores.runs.get(second.runId)?.state === "running");
		expect(engine.handles[1].invocation.input).toBe("two");
		engine.handles[1].settle({});
		await waitFor(() => stores.runs.get(second.runId)?.state === "completed");
		expect(stores.runs.get(first.runId)?.outputText).toBe("done one");
	});

	it("creates a managed workspace under bots/<id>/workspaces/<session>", () => {
		const { runtime, stores, paths } = createRuntime();
		const botId = runtime.defaultBotId;
		if (!botId) {
			throw new Error("bootstrap failed");
		}
		const accepted = runtime.startRun("cli_test", { botId, prompt: "go" });
		const run = stores.runs.get(accepted.runId);
		const session = stores.sessions.get(run?.sessionId as never);
		expect(session?.workspace.rootPath).toBe(
			paths.sessionWorkspaceDir(botId, session?.sessionId as never),
		);
		expect(session?.workspace.rootPath).not.toBe(MANAGED_WORKSPACE_ROOT);
		expect(existsSync(session?.workspace.rootPath ?? "")).toBe(true);
		expect(session?.workspace.rootPath).toContain(
			join("bots", botId, "workspaces"),
		);
	});

	it("applies adaptive backpressure with a retryable rejection", () => {
		const { runtime } = createRuntime({ maxPendingRunsPerSession: 2 });
		const botId = runtime.defaultBotId;
		if (!botId) {
			throw new Error("bootstrap failed");
		}
		runtime.startRun("cli_test", { botId, prompt: "one" });
		runtime.startRun("cli_test", { botId, prompt: "two" });
		try {
			runtime.startRun("cli_test", { botId, prompt: "three" });
			throw new Error("expected rejection");
		} catch (error) {
			if (!(error instanceof GatewayCallError)) {
				throw error;
			}
			expect(error.gatewayError.code).toBe("run_admission_rejected");
			expect(error.gatewayError.retryable).toBe(true);
			expect(error.gatewayError.details?.limit).toBe(2);
		}
	});

	it("refuses new mutating work while draining", () => {
		const { runtime } = createRuntime();
		const botId = runtime.defaultBotId;
		if (!botId) {
			throw new Error("bootstrap failed");
		}
		runtime.drain("cli_test");
		expect(runtime.isDraining).toBe(true);
		try {
			runtime.startRun("cli_test", { botId, prompt: "nope" });
			throw new Error("expected gateway_draining");
		} catch (error) {
			if (!(error instanceof GatewayCallError)) {
				throw error;
			}
			expect(error.gatewayError.code).toBe("gateway_draining");
		}
	});
});

describe("session metadata and lifecycle", () => {
	it("updates metadata, closes, and permanently deletes settled history", async () => {
		const { runtime, stores, engine } = createRuntime();
		const botId = runtime.defaultBotId;
		if (!botId) throw new Error("bootstrap failed");
		const session = runtime.createSession("desktop_test", {
			botId,
			workspaceRoot: "/workspace/history",
			kind: "dedicated",
		});
		const accepted = runtime.startRun("desktop_test", {
			botId,
			sessionId: session.sessionId,
			prompt: "persist me",
		});
		engine.handlesFor(accepted.runId)[0].settle({ outputText: "done" });
		await waitFor(() => stores.runs.get(accepted.runId)?.state === "completed");
		stores.messages.append(session.sessionId, accepted.runId, {
			id: "msg_session_management",
			role: "assistant",
			content: [{ type: "text", text: "history" }],
			createdAt: 10,
		});

		const updated = runtime.updateSession("desktop_test", {
			sessionId: session.sessionId,
			title: "  Release notes  ",
			metadata: { pinned: true, category: "work" },
			expectedRevision: 0,
		});
		expect(updated).toMatchObject({
			title: "Release notes",
			metadata: { pinned: true, category: "work" },
			revision: 1,
		});
		const patched = runtime.updateSession("desktop_test", {
			sessionId: session.sessionId,
			metadata: { pinned: null, archived: true },
			expectedRevision: 1,
		});
		expect(patched.metadata).toEqual({ category: "work", archived: true });
		expect(() =>
			runtime.updateSession("desktop_test", {
				sessionId: session.sessionId,
				title: "stale",
				expectedRevision: 0,
			}),
		).toThrow(GatewayCallError);

		const closed = runtime.closeSession("desktop_test", session.sessionId);
		expect(closed.state).toBe("closed");
		expect(runtime.deleteSession("desktop_test", session.sessionId)).toEqual({
			deleted: true,
		});
		expect(stores.sessions.get(session.sessionId)).toBeUndefined();
		expect(stores.runs.listBySession(session.sessionId)).toEqual([]);
		expect(stores.messages.listBySession(session.sessionId)).toEqual([]);
		expect(stores.attempts.listByRun(accepted.runId)).toEqual([]);
		const eventNames = stores.events
			.listAfter(-1, { sessionId: session.sessionId }, 100)
			.map((event) => event.event);
		expect(eventNames).toContain("session.updated");
		expect(eventNames).toContain("session.closed");
		expect(eventNames).toContain("session.deleted");
	});

	it("refuses to delete a session with pending work", () => {
		const { runtime } = createRuntime();
		const botId = runtime.defaultBotId;
		if (!botId) throw new Error("bootstrap failed");
		const accepted = runtime.startRun("desktop_test", {
			botId,
			prompt: "still running",
		});
		const [session] = runtime.listSessions(botId);
		expect(session).toBeDefined();
		try {
			runtime.deleteSession("desktop_test", session.sessionId);
			throw new Error("expected invalid transition");
		} catch (error) {
			if (!(error instanceof GatewayCallError)) throw error;
			expect(error.gatewayError.code).toBe("invalid_state_transition");
		}
		expect(runtime.listRuns({ runId: accepted.runId })[0]?.state).toBe(
			"running",
		);
	});
});

describe("session fork", () => {
	it("copies persisted messages into a new session with run links cleared", () => {
		const { runtime, stores } = createRuntime();
		const botId = runtime.defaultBotId;
		if (!botId) throw new Error("bootstrap failed");
		const source = runtime.createSession("desktop_test", {
			botId,
			workspaceRoot: "/workspace/project",
		});
		const sourceRunId = createRunId();
		stores.messages.append(source.sessionId, sourceRunId, {
			id: "msg_user_1",
			role: "user",
			content: [{ type: "text", text: "first" }],
			createdAt: 1,
		});
		stores.messages.append(source.sessionId, sourceRunId, {
			id: "msg_assistant_1",
			role: "assistant",
			content: [{ type: "text", text: "answer" }],
			createdAt: 2,
		});

		const fork = runtime.forkSession("desktop_test", {
			sessionId: source.sessionId,
		});

		expect(fork.forkedFromSessionId).toBe(source.sessionId);
		expect(fork.session.sessionId).not.toBe(source.sessionId);
		expect(fork.session.botId).toBe(source.botId);
		expect(fork.session.workspace).toEqual(source.workspace);
		expect(fork.messageCount).toBe(2);
		expect(stores.sessions.get(source.sessionId)?.state).toBe("active");
		expect(fork.session.kind).toBe("dedicated");
		expect(stores.messages.listBySession(fork.session.sessionId)).toEqual([
			expect.objectContaining({
				runId: undefined,
				message: expect.objectContaining({ id: "msg_user_1" }),
			}),
			expect.objectContaining({
				runId: undefined,
				message: expect.objectContaining({ id: "msg_assistant_1" }),
			}),
		]);
		expect(
			stores.events
				.listAfter(0, {}, 100)
				.some(
					(event) =>
						event.event === "session.forked" &&
						event.scope.sessionId === fork.session.sessionId,
				),
		).toBe(true);
	});

	it("forks strictly before the requested user message", () => {
		const { runtime, stores } = createRuntime();
		const botId = runtime.defaultBotId;
		if (!botId) throw new Error("bootstrap failed");
		const source = runtime.createSession("desktop_test", { botId });
		for (const message of [
			{
				id: "msg_user_1",
				role: "user" as const,
				content: [{ type: "text" as const, text: "first" }],
				createdAt: 1,
			},
			{
				id: "msg_assistant_1",
				role: "assistant" as const,
				content: [{ type: "text" as const, text: "answer" }],
				createdAt: 2,
			},
			{
				id: "msg_user_2",
				role: "user" as const,
				content: [{ type: "text" as const, text: "second" }],
				createdAt: 3,
			},
			{
				id: "msg_assistant_2",
				role: "assistant" as const,
				content: [{ type: "text" as const, text: "later" }],
				createdAt: 4,
			},
		]) {
			stores.messages.append(source.sessionId, undefined, message);
		}

		const fork = runtime.forkSession("desktop_test", {
			sessionId: source.sessionId,
			beforeRunCount: 2,
		});

		expect(fork.messageCount).toBe(2);
		expect(
			stores.messages
				.listBySession(fork.session.sessionId)
				.map(({ message }) => message.id),
		).toEqual(["msg_user_1", "msg_assistant_1"]);

		const beforeFirst = runtime.forkSession("desktop_test", {
			sessionId: source.sessionId,
			beforeRunCount: 1,
		});
		expect(beforeFirst.messageCount).toBe(0);
		expect(
			stores.messages.listBySession(beforeFirst.session.sessionId),
		).toEqual([]);
	});

	it("rejects a source with queued or active work", () => {
		const { runtime, stores, engine } = createRuntime();
		const botId = runtime.defaultBotId;
		if (!botId) throw new Error("bootstrap failed");
		const source = runtime.createSession("desktop_test", { botId });
		stores.messages.append(source.sessionId, undefined, {
			id: "msg_user_1",
			role: "user",
			content: [{ type: "text", text: "first" }],
			createdAt: 1,
		});
		runtime.startRun("desktop_test", {
			botId,
			sessionId: source.sessionId,
			prompt: "still running",
		});

		expect(() =>
			runtime.forkSession("desktop_test", {
				sessionId: source.sessionId,
			}),
		).toThrowError(
			expect.objectContaining({
				gatewayError: expect.objectContaining({
					code: "invalid_state_transition",
					retryable: true,
				}),
			}),
		);
		engine.lastHandle?.settle({});
	});

	it("rejects a cutoff beyond the persisted user history", () => {
		const { runtime, stores } = createRuntime();
		const botId = runtime.defaultBotId;
		if (!botId) throw new Error("bootstrap failed");
		const source = runtime.createSession("desktop_test", { botId });
		stores.messages.append(source.sessionId, undefined, {
			id: "msg_user_1",
			role: "user",
			content: [{ type: "text", text: "first" }],
			createdAt: 1,
		});

		expect(() =>
			runtime.forkSession("desktop_test", {
				sessionId: source.sessionId,
				beforeRunCount: 2,
			}),
		).toThrowError(
			expect.objectContaining({
				gatewayError: expect.objectContaining({ code: "invalid_request" }),
			}),
		);
	});

	it("rejects an unknown or empty source session", () => {
		const { runtime } = createRuntime();
		const botId = runtime.defaultBotId;
		if (!botId) throw new Error("bootstrap failed");
		expect(() =>
			runtime.forkSession("desktop_test", {
				sessionId: "ses_does_not_exist" as never,
			}),
		).toThrowError(
			expect.objectContaining({
				gatewayError: expect.objectContaining({ code: "not_found" }),
			}),
		);

		const empty = runtime.createSession("desktop_test", {
			botId,
			kind: "dedicated",
		});
		expect(() =>
			runtime.forkSession("desktop_test", { sessionId: empty.sessionId }),
		).toThrowError(
			expect.objectContaining({
				gatewayError: expect.objectContaining({ code: "invalid_request" }),
			}),
		);
	});
});

describe("run attempts and retry", () => {
	it("retries failed attempts up to the cap while the run stays running", async () => {
		const engine = new ScriptedEnginePort();
		engine.autoOutcome = (_invocation, attemptIndex) =>
			attemptIndex === 0
				? {
						status: "failed",
						error: { name: "Transient", message: "first attempt fails" },
					}
				: { status: "completed", outputText: "second attempt wins" };
		const { runtime, stores } = createRuntime({ engine, maxAttempts: 2 });
		const botId = runtime.defaultBotId;
		if (!botId) {
			throw new Error("bootstrap failed");
		}
		const accepted = runtime.startRun("cli_test", {
			botId,
			prompt: "retry me",
		});
		await waitFor(() => stores.runs.get(accepted.runId)?.state === "completed");
		const attempts = stores.attempts.listByRun(accepted.runId);
		expect(attempts.map((attempt) => attempt.state)).toEqual([
			"failed",
			"completed",
		]);
		expect(stores.runs.get(accepted.runId)?.outputText).toBe(
			"second attempt wins",
		);
	});

	it("exhausted attempts fail the run with the last error", async () => {
		const engine = new ScriptedEnginePort();
		engine.autoOutcome = () => ({
			status: "failed",
			error: { name: "Persistent", message: "always fails" },
		});
		const { runtime, stores } = createRuntime({ engine, maxAttempts: 2 });
		const botId = runtime.defaultBotId;
		if (!botId) {
			throw new Error("bootstrap failed");
		}
		const accepted = runtime.startRun("cli_test", { botId, prompt: "doomed" });
		await waitFor(() => stores.runs.get(accepted.runId)?.state === "failed");
		expect(stores.attempts.listByRun(accepted.runId)).toHaveLength(2);
		expect(stores.runs.get(accepted.runId)?.error?.name).toBe("Persistent");
	});
});

describe("steer and stop", () => {
	it("steering merges into the active run and is recorded durably", () => {
		const { runtime, stores, engine } = createRuntime();
		const botId = runtime.defaultBotId;
		if (!botId) {
			throw new Error("bootstrap failed");
		}
		const accepted = runtime.startRun("cli_test", { botId, prompt: "start" });
		const outcome = runtime.steerRun(
			"cli_test",
			accepted.runId,
			"also do this",
		);
		expect(outcome.merged).toBe(true);
		expect(engine.handles[0].steers).toEqual(["also do this"]);
		const steered = stores.events.listAfter(-1, { runId: accepted.runId }, 100);
		expect(steered.some((event) => event.event === "run.steered")).toBe(true);
	});

	it("updates a queued run durably and executes the updated input", async () => {
		const { runtime, stores, engine } = createRuntime();
		const botId = runtime.defaultBotId;
		if (!botId) {
			throw new Error("bootstrap failed");
		}
		const active = runtime.startRun("desktop_test", {
			botId,
			prompt: "active",
		});
		const queued = runtime.startRun("desktop_test", {
			botId,
			prompt: "original queued input",
		});

		const result = runtime.updateQueuedRun(
			"desktop_test",
			queued.runId,
			"updated queued input",
		);
		expect(result.run.input).toBe("updated queued input");
		expect(stores.runs.get(queued.runId)?.input).toBe("updated queued input");
		expect(
			stores.events
				.listAfter(-1, { runId: queued.runId }, 100)
				.some((event) => event.event === "run.queuedUpdated"),
		).toBe(true);
		expect(
			stores.audit
				.list()
				.some(
					(entry) =>
						entry.action === "run.updateQueued" &&
						entry.subject === queued.runId,
				),
		).toBe(true);

		engine.handlesFor(active.runId)[0]?.settle({});
		await waitFor(() => engine.handlesFor(queued.runId).length === 1);
		expect(engine.handlesFor(queued.runId)[0].invocation.input).toBe(
			"updated queued input",
		);
		engine.handlesFor(queued.runId)[0].settle({});
		await waitFor(() => stores.runs.get(queued.runId)?.state === "completed");
	});

	it("promotes a queued run into its session's actual active steering lane", () => {
		const { runtime, stores, engine } = createRuntime();
		const botId = runtime.defaultBotId;
		if (!botId) {
			throw new Error("bootstrap failed");
		}
		const active = runtime.startRun("desktop_test", {
			botId,
			prompt: "active",
		});
		const queued = runtime.startRun("desktop_test", {
			botId,
			prompt: "merge this queued input",
		});

		const result = runtime.promoteQueuedRun("desktop_test", queued.runId);
		expect(result).toEqual({
			queuedRunId: queued.runId,
			activeRunId: active.runId,
			sessionId: stores.runs.get(active.runId)?.sessionId,
			merged: true,
		});
		expect(engine.handlesFor(active.runId)[0].steers).toEqual([
			"merge this queued input",
		]);
		expect(stores.runs.get(queued.runId)?.state).toBe("aborted");
		const events = stores.events.listAfter(-1, { runId: queued.runId }, 100);
		expect(events.some((event) => event.event === "run.aborted")).toBe(true);
		expect(events.some((event) => event.event === "run.queuedPromoted")).toBe(
			true,
		);
		expect(
			stores.audit
				.list()
				.some(
					(entry) =>
						entry.action === "run.promoteQueued" &&
						entry.subject === queued.runId,
				),
		).toBe(true);
		engine.handlesFor(active.runId)[0].settle({});
	});

	it("steering a queued or finished run is an invalid transition", () => {
		const { runtime } = createRuntime();
		const botId = runtime.defaultBotId;
		if (!botId) {
			throw new Error("bootstrap failed");
		}
		runtime.startRun("cli_test", { botId, prompt: "active" });
		const queued = runtime.startRun("cli_test", { botId, prompt: "waiting" });
		try {
			runtime.steerRun("cli_test", queued.runId, "too early");
			throw new Error("expected invalid_state_transition");
		} catch (error) {
			if (!(error instanceof GatewayCallError)) {
				throw error;
			}
			expect(error.gatewayError.code).toBe("invalid_state_transition");
		}
	});

	it("interrupting a queued run cancels it without starting", async () => {
		const { runtime, stores } = createRuntime();
		const botId = runtime.defaultBotId;
		if (!botId) {
			throw new Error("bootstrap failed");
		}
		runtime.startRun("cli_test", { botId, prompt: "active" });
		const queued = runtime.startRun("cli_test", { botId, prompt: "waiting" });
		runtime.interruptRun("cli_test", queued.runId);
		expect(stores.runs.get(queued.runId)?.state).toBe("aborted");
	});

	it("unknown runs are not_found", () => {
		const { runtime } = createRuntime();
		try {
			runtime.steerRun("cli_test", createRunId(), "hello?");
			throw new Error("expected not_found");
		} catch (error) {
			if (!(error instanceof GatewayCallError)) {
				throw error;
			}
			expect(error.gatewayError.code).toBe("not_found");
		}
	});
});

describe("canonical message history", () => {
	it("captures message-appended engine events behind the messages contract", async () => {
		const { runtime, stores, engine } = createRuntime();
		const botId = runtime.defaultBotId;
		if (!botId) {
			throw new Error("bootstrap failed");
		}
		const accepted = runtime.startRun("cli_test", { botId, prompt: "chat" });
		const handle = engine.handles[0];
		handle.emit({
			type: "message-appended",
			message: {
				id: "msg_1",
				role: "assistant",
				content: [{ type: "text", text: "hi there" }],
				createdAt: Date.now(),
			},
			index: 0,
		});
		handle.settle({});
		await waitFor(() => stores.runs.get(accepted.runId)?.state === "completed");
		const run = stores.runs.get(accepted.runId);
		const stored = stores.messages.listBySession(run?.sessionId as never);
		expect(stored.map((entry) => entry.message.id)).toEqual(["msg_1"]);
		const events = stores.events.listAfter(-1, { runId: accepted.runId }, 100);
		expect(events.some((event) => event.event === "run.messageAppended")).toBe(
			true,
		);
	});
});

describe("run config snapshot (credentials-free, captured at admission)", () => {
	it("persists provider/model on the run row and never a credential", () => {
		const { runtime, stores } = createRuntime();
		const botId = runtime.defaultBotId;
		if (!botId) {
			throw new Error("bootstrap failed");
		}
		const accepted = runtime.startRun("cli_test", {
			botId,
			prompt: "snapshot me",
			overrides: { providerId: "anthropic", modelId: "claude-admission" },
		});
		const snapshot = stores.runs.getConfigSnapshot(accepted.runId);
		expect(snapshot).toMatchObject({
			providerId: "anthropic",
			modelId: "claude-admission",
		});
		expect(JSON.stringify(snapshot)).not.toMatch(/apiKey|secret|sk-/i);
	});

	it("a queued run executes against its admission snapshot, not the live bot config", async () => {
		const { runtime, stores, engine } = createRuntime();
		const botId = runtime.defaultBotId;
		if (!botId) {
			throw new Error("bootstrap failed");
		}
		const active = runtime.startRun("cli_test", { botId, prompt: "hold" });
		const queued = runtime.startRun("cli_test", {
			botId,
			prompt: "later",
			overrides: { modelId: "model-at-admission" },
		});

		// The bot's live config changes while the run waits in the queue.
		const record = stores.bots.get(botId);
		if (!record) {
			throw new Error("bot missing");
		}
		stores.bots.save({
			...record,
			config: { ...record.config, modelId: "model-changed-later" },
			revision: record.revision + 1,
		});

		engine.handles[0].settle({});
		await waitFor(() => stores.runs.get(queued.runId)?.state === "running");
		expect(engine.handles[1].invocation.effectiveConfig.modelId).toBe(
			"model-at-admission",
		);
		engine.handles[1].settle({});
		await waitFor(() => stores.runs.get(active.runId)?.state === "completed");
	});

	it("retries execute against the same snapshot as the first attempt", async () => {
		const engine = new ScriptedEnginePort();
		engine.autoOutcome = (_invocation, attemptIndex) =>
			attemptIndex === 0
				? { status: "failed", error: { name: "Transient", message: "boom" } }
				: { status: "completed" };
		const { runtime, stores } = createRuntime({ engine, maxAttempts: 2 });
		const botId = runtime.defaultBotId;
		if (!botId) {
			throw new Error("bootstrap failed");
		}
		const accepted = runtime.startRun("cli_test", {
			botId,
			prompt: "retry with snapshot",
			overrides: { providerId: "anthropic", modelId: "pinned-model" },
		});
		await waitFor(() => stores.runs.get(accepted.runId)?.state === "completed");
		const models = engine
			.handlesFor(accepted.runId)
			.map((handle) => handle.invocation.effectiveConfig.modelId);
		expect(models).toEqual(["pinned-model", "pinned-model"]);
	});

	it("recovered queued runs keep their snapshot (in-memory overrides survive the crash)", async () => {
		const dataRoot = tempDataRoot();
		const first = createRuntime({ dataRoot });
		const botId = first.runtime.defaultBotId;
		if (!botId) {
			throw new Error("bootstrap failed");
		}
		first.runtime.startRun("cli_test", { botId, prompt: "hold" });
		const queued = first.runtime.startRun("cli_test", {
			botId,
			prompt: "recover me",
			overrides: { providerId: "openrouter", modelId: "override-model" },
		});
		first.database.close();

		const engine = new ScriptedEnginePort();
		engine.autoOutcome = () => ({ status: "completed" });
		const second = createRuntime({ dataRoot, engine });
		second.runtime.recover();
		await waitFor(
			() => second.stores.runs.get(queued.runId)?.state === "completed",
		);
		const handle = engine.handlesFor(queued.runId)[0];
		expect(handle.invocation.effectiveConfig).toMatchObject({
			providerId: "openrouter",
			modelId: "override-model",
		});
	});
});

describe("usage pipeline wiring", () => {
	it("a model-call-completed engine event writes the usage event and aggregates atomically", async () => {
		const { runtime, stores, engine, database } = createRuntime();
		const botId = runtime.defaultBotId;
		if (!botId) {
			throw new Error("bootstrap failed");
		}
		const accepted = runtime.startRun("cli_test", {
			botId,
			prompt: "meter me",
		});
		const handle = engine.handles[0];
		handle.emit({
			type: "model-call-completed",
			providerId: "anthropic",
			modelId: "claude-x",
			inputTokens: 120,
			outputTokens: 30,
			totalTokens: 150,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			durationMs: 850,
			status: "ok",
		});
		handle.emit({
			type: "message-appended",
			message: {
				id: "msg_metered",
				role: "assistant",
				content: [{ type: "text", text: "metered" }],
				createdAt: Date.now(),
			},
			index: 0,
		});
		handle.settle({});
		await waitFor(() => stores.runs.get(accepted.runId)?.state === "completed");

		const run = stores.runs.get(accepted.runId);
		const events = database.db.prepare("SELECT * FROM usage_events;").all();
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			bot_id: botId,
			session_id: run?.sessionId,
			run_id: accepted.runId,
			agent_id: botId,
			topic_id: run?.sessionId,
			provider_id: "anthropic",
			model_id: "claude-x",
			input_tokens: 120,
			output_tokens: 30,
			total_tokens: 150,
			duration_ms: 850,
			status: "ok",
		});
		const daily = database.db.prepare("SELECT * FROM daily_usage;").all();
		expect(daily).toHaveLength(1);
		// 1 model call + 1 assistant message + run duration, all folded in.
		expect(daily[0]).toMatchObject({
			bot_id: botId,
			tokens: 150,
			model_calls: 1,
			messages: 1,
			active_sessions: 1,
		});
		expect(Number(daily[0].max_run_duration_ms)).toBeGreaterThan(0);
		expect(
			database.db.prepare("SELECT * FROM model_usage;").all()[0],
		).toMatchObject({
			model_id: "claude-x",
			provider_id: "anthropic",
			tokens: 150,
		});
		expect(
			database.db.prepare("SELECT * FROM agent_usage;").all()[0],
		).toMatchObject({ agent_id: botId, tokens: 150, messages: 1 });
		expect(
			database.db.prepare("SELECT * FROM topic_usage;").all()[0],
		).toMatchObject({ topic_id: run?.sessionId, tokens: 150, messages: 1 });
		// The durable engine event committed in the same transaction.
		const engineEvents = stores.events.listAfter(
			-1,
			{ runId: accepted.runId },
			100,
		);
		expect(
			engineEvents.some((event) => event.event === "engine.modelCallCompleted"),
		).toBe(true);
	});
});

describe("manual crash recovery", () => {
	it("interrupts abandoned attempts and re-admits committed queued runs FIFO", async () => {
		const dataRoot = tempDataRoot();

		// Instance 1: one running run (attempt open) + two queued runs, then
		// the process "dies" (we simply drop everything on the floor).
		const first = createRuntime({ dataRoot });
		const botId = first.runtime.defaultBotId;
		if (!botId) {
			throw new Error("bootstrap failed");
		}
		const running = first.runtime.startRun("cli_test", {
			botId,
			prompt: "was running",
		});
		const queuedA = first.runtime.startRun("cli_test", {
			botId,
			prompt: "queued A",
		});
		const queuedB = first.runtime.startRun("cli_test", {
			botId,
			prompt: "queued B",
		});
		expect(first.stores.runs.get(running.runId)?.state).toBe("running");
		const durableGatewayId = first.stores.meta.ensureGatewayId();
		first.database.close();

		// Instance 2: same data dir, fresh process.
		const engine = new ScriptedEnginePort();
		engine.autoOutcome = () => ({
			status: "completed",
			outputText: "recovered",
		});
		const second = createRuntime({ dataRoot, engine });
		const report = second.runtime.recover();

		expect(report.interruptedRuns).toEqual([running.runId]);
		expect(report.requeuedRuns).toEqual([queuedA.runId, queuedB.runId]);

		// The abandoned attempt is interrupted, never auto-resumed.
		const interrupted = second.stores.runs.get(running.runId);
		expect(interrupted?.state).toBe("interrupted");
		expect(interrupted?.error?.name).toBe("GatewayRestart");
		expect(
			second.stores.attempts
				.listByRun(running.runId)
				.every((attempt) => attempt.state !== "running"),
		).toBe(true);
		expect(engine.handlesFor(running.runId)).toHaveLength(0);

		// Committed queued runs execute in FIFO admission order.
		await waitFor(
			() => second.stores.runs.get(queuedB.runId)?.state === "completed",
		);
		expect(second.stores.runs.get(queuedA.runId)?.state).toBe("completed");
		const order = engine.handles.map((handle) => handle.invocation.input);
		expect(order).toEqual(["queued A", "queued B"]);

		// Same durable gatewayId across instances (ADR 0002).
		expect(second.stores.meta.ensureGatewayId()).toBe(durableGatewayId);
	});
});
