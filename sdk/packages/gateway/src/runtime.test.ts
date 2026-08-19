/**
 * Async runtime semantics over the SQLite authority: immediate FIFO
 * acknowledgement, durable queue, run attempts with capped retry,
 * steering, adaptive admission backpressure, managed workspaces,
 * canonical message capture, and manual crash recovery.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
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
	});
	runtime.bootstrap();
	return { runtime, stores, engine, paths, database, dataRoot };
}

describe("run admission", () => {
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
