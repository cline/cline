/**
 * Worker isolation and supervision (Gateway RFC, Phase 4): the
 * out-of-process contract (initialize/execute/event/capability-call/
 * interrupt/drain/heartbeat), one long-lived worker per bot, idle
 * reaping, crash containment (attempt fails, session survives, retry is
 * explicit), fail-closed required isolation, least-privilege spawn
 * specs, and the explicit development-only unsandboxed mode's
 * visibility in health.
 */

import { join } from "node:path";
import type { EngineInvocation, EnginePort } from "@cline/bot";
import {
	type BotId,
	createBotId,
	createGatewayInstanceId,
} from "@cline/shared/gateway";
import { describe, expect, it } from "vitest";
import { openGatewayDatabase } from "../db";
import { ensureGatewayDataDir, resolveGatewayPaths } from "../paths";
import { GatewayRuntime } from "../runtime";
import { createGatewayStores } from "../stores";
import { ScriptedEnginePort, tempDataRoot, waitFor } from "../test-support";
import type { WorkerSpawnSpec } from "./driver";
import { WorkerIsolationUnavailableError } from "./driver";
import { InProcessWorkerDriver } from "./in-process-driver";
import { SandboxProcessWorkerDriver } from "./process-driver";
import { WorkerSupervisor } from "./supervisor";

const SPAWN_SPEC: Omit<WorkerSpawnSpec, "workerId" | "botId"> = {
	mounts: { writeRoots: ["/tmp"], readRoots: [] },
	network: { allowedDomains: [] },
};

function createSupervisor(
	options: {
		workload?: EnginePort;
		idleReapMs?: number;
		heartbeatIntervalMs?: number;
		heartbeatTimeoutMs?: number;
		capabilities?: ConstructorParameters<
			typeof WorkerSupervisor
		>[0]["capabilities"];
		clock?: () => number;
	} = {},
) {
	const inner = new ScriptedEnginePort();
	inner.autoOutcome = (invocation) => ({
		outputText: `done:${invocation.input}`,
	});
	const driver = new InProcessWorkerDriver(() => options.workload ?? inner);
	const supervisor = new WorkerSupervisor({
		driver,
		isolationPolicy: "development",
		spawnSpecFor: () => SPAWN_SPEC,
		capabilities: options.capabilities,
		clock: options.clock,
		idleReapMs: options.idleReapMs ?? 0,
		heartbeatIntervalMs: options.heartbeatIntervalMs ?? 0,
		heartbeatTimeoutMs: options.heartbeatTimeoutMs,
	});
	return { supervisor, driver, inner };
}

function invocationFor(botId: BotId, input: string): EngineInvocation {
	return {
		runId: `run_${input.padEnd(8, "0")}` as never,
		sessionId: "ses_testsession01" as never,
		botId,
		input,
		workspaceRoot: "/tmp",
		effectiveConfig: {},
	};
}

describe("supervision contract", () => {
	it("initializes, executes, streams events, and settles outcomes", async () => {
		const inner = new ScriptedEnginePort();
		const { supervisor } = createSupervisor({ workload: inner });
		const port = supervisor.enginePort();
		const botId = createBotId();
		const handle = port.start(invocationFor(botId, "alpha"));
		const events: unknown[] = [];
		handle.subscribe?.((event) => events.push(event));
		await waitFor(() => inner.handles.length === 1);
		// Events stream while the execution is live.
		inner.handles[0].emit({ type: "text-delta", text: "hi" });
		await waitFor(() => events.length === 1);
		expect(events[0]).toEqual({ type: "text-delta", text: "hi" });
		inner.handles[0].settle({ outputText: "done:alpha" });
		const outcome = await handle.result;
		expect(outcome.status).toBe("completed");
		expect(outcome.outputText).toBe("done:alpha");
	});

	it("keeps one long-lived worker per bot", async () => {
		const { supervisor } = createSupervisor();
		const port = supervisor.enginePort();
		const botA = createBotId();
		const botB = createBotId();
		await port.start(invocationFor(botA, "one")).result;
		await port.start(invocationFor(botA, "two")).result;
		expect(supervisor.workerCount).toBe(1);
		await port.start(invocationFor(botB, "three")).result;
		expect(supervisor.workerCount).toBe(2);
	});

	it("routes steer and interrupt through the protocol", async () => {
		const inner = new ScriptedEnginePort();
		const { supervisor } = createSupervisor({ workload: inner });
		const port = supervisor.enginePort();
		const botId = createBotId();
		const handle = port.start(invocationFor(botId, "steer-me"));
		await waitFor(() => inner.handles.length === 1);
		expect(handle.steer("go left")).toBe(true);
		await waitFor(() => inner.handles[0].steers.length === 1);
		expect(inner.handles[0].steers).toEqual(["go left"]);
		handle.interrupt("enough");
		await waitFor(() => inner.handles[0].interrupted);
		const outcome = await handle.result;
		expect(outcome.status).toBe("interrupted");
	});

	it("dispatches capability calls from the workload to Gateway handlers", async () => {
		const calls: unknown[] = [];
		const workload: EnginePort = {
			start: () => ({
				steer: () => false,
				interrupt: () => {},
				abort: () => {},
				result: Promise.resolve({ status: "completed", outputText: "" }),
			}),
		};
		const driver = new InProcessWorkerDriver((context) => {
			// The workload immediately exercises a capability call.
			void context
				.capabilityCall("approval.request", { toolName: "bash" })
				.then((result) => calls.push(result));
			return workload;
		});
		const supervisor = new WorkerSupervisor({
			driver,
			isolationPolicy: "development",
			spawnSpecFor: () => SPAWN_SPEC,
			capabilities: {
				"approval.request": (params, context) => ({
					approved: true,
					tool: params?.toolName,
					botId: context.botId,
				}),
			},
		});
		const botId = createBotId();
		await supervisor.enginePort().start(invocationFor(botId, "x")).result;
		await waitFor(() => calls.length === 1);
		expect(calls[0]).toMatchObject({ approved: true, tool: "bash", botId });
	});

	it("rejects unknown capabilities with an error result", async () => {
		const errors: string[] = [];
		const driver = new InProcessWorkerDriver((context) => {
			void context.capabilityCall("no.such.capability").catch((error) => {
				errors.push(String(error));
			});
			return {
				start: () => ({
					steer: () => false,
					interrupt: () => {},
					abort: () => {},
					result: Promise.resolve({ status: "completed", outputText: "" }),
				}),
			};
		});
		const supervisor = new WorkerSupervisor({
			driver,
			isolationPolicy: "development",
			spawnSpecFor: () => SPAWN_SPEC,
		});
		await supervisor.enginePort().start(invocationFor(createBotId(), "x"))
			.result;
		await waitFor(() => errors.length === 1);
		expect(errors[0]).toContain("Unknown capability");
	});

	it("drains workers: in-flight executions finish, drained is reported", async () => {
		const inner = new ScriptedEnginePort();
		const { supervisor } = createSupervisor({ workload: inner });
		const port = supervisor.enginePort();
		const handle = port.start(invocationFor(createBotId(), "slow"));
		await waitFor(() => inner.handles.length === 1);
		const drained = supervisor.drain(2_000);
		inner.handles[0].settle({ outputText: "finished" });
		await drained;
		expect((await handle.result).outputText).toBe("finished");
	});
});

describe("crash containment", () => {
	function createRuntimeWithWorkers(maxAttempts = 1) {
		const dataRoot = tempDataRoot();
		const paths = resolveGatewayPaths({ dataRoot, namespace: "default" });
		ensureGatewayDataDir(paths);
		const database = openGatewayDatabase(paths.databaseFile);
		const instanceId = createGatewayInstanceId();
		const stores = createGatewayStores(database, instanceId);
		const inner = new ScriptedEnginePort();
		const driver = new InProcessWorkerDriver(() => inner);
		const supervisor = new WorkerSupervisor({
			driver,
			isolationPolicy: "development",
			spawnSpecFor: () => SPAWN_SPEC,
		});
		const runtime = new GatewayRuntime({
			database,
			stores,
			paths,
			instanceId,
			engine: supervisor.enginePort(),
			retry: { maxAttempts },
			executionHealth: () => supervisor.health(),
		});
		runtime.bootstrap();
		return { runtime, stores, inner, driver, supervisor };
	}

	it("a worker crash fails the attempt but the session survives", async () => {
		const { runtime, stores, inner, driver, supervisor } =
			createRuntimeWithWorkers(1);
		const botId = runtime.defaultBotId;
		if (!botId) {
			throw new Error("bootstrap failed");
		}
		const accepted = runtime.startRun("test", { botId, prompt: "boom" });
		await waitFor(() => inner.handles.length === 1);
		driver.crashLatest();
		await waitFor(() => stores.runs.get(accepted.runId)?.state === "failed");
		const run = stores.runs.get(accepted.runId);
		expect(run?.error?.name).toBe("WorkerCrashed");
		// The session is untouched by the crash.
		const session = stores.sessions.get(run?.sessionId as never);
		expect(session?.state).toBe("active");
		// The dead worker is gone; nothing auto-respawned it.
		expect(supervisor.workerCount).toBe(0);
		// The attempt trail shows exactly one failed attempt (no auto-retry).
		const attempts = stores.attempts.listByRun(accepted.runId);
		expect(attempts).toHaveLength(1);
		expect(attempts[0].state).toBe("failed");
	});

	it("an explicit retry gets a fresh worker and can succeed", async () => {
		const { runtime, stores, inner, driver } = createRuntimeWithWorkers(2);
		const botId = runtime.defaultBotId;
		if (!botId) {
			throw new Error("bootstrap failed");
		}
		const accepted = runtime.startRun("test", { botId, prompt: "retry" });
		await waitFor(() => inner.handles.length === 1);
		const firstConnection = driver.connections.at(-1);
		driver.crashLatest();
		// The retry policy (explicit, maxAttempts=2) starts attempt 2 on a
		// freshly spawned worker.
		await waitFor(() => inner.handles.length === 2);
		expect(driver.connections.at(-1)).not.toBe(firstConnection);
		inner.handles[1].settle({ outputText: "second time lucky" });
		await waitFor(() => stores.runs.get(accepted.runId)?.state === "completed");
		expect(stores.runs.get(accepted.runId)?.outputText).toBe(
			"second time lucky",
		);
		const attempts = stores.attempts.listByRun(accepted.runId);
		expect(attempts.map((attempt) => attempt.state)).toEqual([
			"failed",
			"completed",
		]);
	});
});

describe("idle reaping and heartbeats", () => {
	it("reaps a worker after the idle window and respawns on demand", async () => {
		let now = 1_000;
		const { supervisor } = createSupervisor({
			idleReapMs: 500,
			clock: () => now,
		});
		const port = supervisor.enginePort();
		const botId = createBotId();
		await port.start(invocationFor(botId, "one")).result;
		expect(supervisor.workerCount).toBe(1);
		now += 100;
		supervisor.sweep();
		expect(supervisor.workerCount, "not idle long enough").toBe(1);
		now += 1_000;
		supervisor.sweep();
		expect(supervisor.workerCount).toBe(0);
		// The next execution simply spawns a fresh worker.
		await port.start(invocationFor(botId, "two")).result;
		expect(supervisor.workerCount).toBe(1);
	});

	it("kills a worker whose heartbeat goes unanswered (hang = crash)", async () => {
		let now = 1_000;
		// A connection that swallows heartbeats: the host never sees them.
		const inner = new ScriptedEnginePort();
		const driver = new InProcessWorkerDriver(() => inner);
		const supervisor = new WorkerSupervisor({
			driver,
			isolationPolicy: "development",
			spawnSpecFor: () => SPAWN_SPEC,
			clock: () => now,
			heartbeatIntervalMs: 100,
			heartbeatTimeoutMs: 300,
		});
		const port = supervisor.enginePort();
		const handle = port.start(invocationFor(createBotId(), "hang"));
		await waitFor(() => inner.handles.length === 1);
		// Hang the worker: alive but no longer answering heartbeats.
		driver.connections.at(-1)?.hang();

		now += 150;
		supervisor.sweep(); // sends the heartbeat (never answered)
		now += 400;
		supervisor.sweep(); // timeout exceeded: kill = crash path
		const outcome = await handle.result;
		expect(outcome.status).toBe("failed");
		expect(outcome.error?.name).toBe("WorkerCrashed");
		expect(supervisor.workerCount).toBe(0);
	});
});

describe("isolation policy", () => {
	it("required isolation refuses non-production drivers outright", () => {
		const driver = new InProcessWorkerDriver(() => new ScriptedEnginePort());
		expect(
			() =>
				new WorkerSupervisor({
					driver,
					spawnSpecFor: () => SPAWN_SPEC,
				}),
		).toThrow(WorkerIsolationUnavailableError);
	});

	it("the seatbelt driver fails closed on non-macOS platforms", async () => {
		const driver = new SandboxProcessWorkerDriver({
			entry: { command: process.execPath, args: ["nonexistent.mjs"] },
			platform: "linux",
		});
		expect(driver.availability().available).toBe(false);
		await expect(
			driver.spawn({
				workerId: "wrk_testworker001" as never,
				botId: createBotId(),
				...SPAWN_SPEC,
			}),
		).rejects.toThrow(WorkerIsolationUnavailableError);
	});

	it("a failing spawn surfaces as a failed attempt, never a degraded one", async () => {
		const driver = new SandboxProcessWorkerDriver({
			entry: { command: process.execPath, args: ["nonexistent.mjs"] },
			platform: "linux",
		});
		const supervisor = new WorkerSupervisor({
			driver,
			// Even in development policy, an unavailable driver fails closed.
			isolationPolicy: "development",
			spawnSpecFor: () => SPAWN_SPEC,
		});
		const outcome = await supervisor
			.enginePort()
			.start(invocationFor(createBotId(), "x")).result;
		expect(outcome.status).toBe("failed");
		expect(outcome.error?.name).toBe("WorkerIsolationUnavailable");
	});

	it("rejects spawn specs that smuggle credential env vars directly", async () => {
		const driver = new SandboxProcessWorkerDriver({
			entry: { command: process.execPath, args: ["worker.mjs"] },
			unsandboxedDevelopmentMode: true,
		});
		await expect(
			driver.spawn({
				workerId: "wrk_testworker002" as never,
				botId: createBotId(),
				mounts: { writeRoots: [], readRoots: [] },
				network: { allowedDomains: ["api.anthropic.com"] },
				credentials: [
					{ envVar: "ANTHROPIC_API_KEY", injectHosts: ["api.anthropic.com"] },
				],
				env: { ANTHROPIC_API_KEY: "sk-super-secret" },
			}),
		).rejects.toThrow(/must not carry credential variable/);
	});

	it("the development-only unsandboxed mode is explicit and visible in health", () => {
		const driver = new SandboxProcessWorkerDriver({
			entry: { command: process.execPath, args: ["worker.mjs"] },
			unsandboxedDevelopmentMode: true,
		});
		expect(driver.isolation).toBe("unsandboxed-development");
		const supervisor = new WorkerSupervisor({
			driver,
			isolationPolicy: "development",
			spawnSpecFor: () => SPAWN_SPEC,
		});
		const health = supervisor.health();
		expect(health.isolation).toBe("unsandboxed-development");
		expect(health.development).toBe(true);
		expect(health.isolationPolicy).toBe("development");
	});
});

describe("real out-of-process worker (dev-unsandboxed driver)", () => {
	it("speaks the stdio protocol end-to-end and leaks no host secrets", async () => {
		process.env.WORKER_TEST_SECRET = "do-not-leak";
		try {
			const driver = new SandboxProcessWorkerDriver({
				entry: {
					command: process.execPath,
					args: [
						join(import.meta.dirname, "fixtures", "echo-worker-entry.mjs"),
					],
				},
				unsandboxedDevelopmentMode: true,
			});
			const supervisor = new WorkerSupervisor({
				driver,
				isolationPolicy: "development",
				spawnSpecFor: () => SPAWN_SPEC,
				initializeTimeoutMs: 15_000,
			});
			const outcome = await supervisor
				.enginePort()
				.start(invocationFor(createBotId(), "over-the-wire")).result;
			expect(outcome.status).toBe("completed");
			// The child echoed the input AND confirmed the host env secret
			// never reached its environment (allowlist filtering).
			expect(outcome.outputText).toBe("echo:over-the-wire;secret:unset");
			supervisor.stop();
		} finally {
			delete process.env.WORKER_TEST_SECRET;
		}
	}, 30_000);
});
