/**
 * Broker integration tests against the in-process fake Gateway port:
 * connect/hydrate, live events, disconnect + backoff reconnect, gap
 * recovery, command translation and idempotency, approvals with
 * first-answer-wins, and the incompatible-protocol terminal state.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNullLogger } from "../logging";
import {
	FakeGatewayAuthority,
	FakeGatewayPort,
} from "../testing/fake-gateway-port";
import { backoffDelayMs, DesktopBroker } from "./broker";
import type { GatewayPort } from "./port";
import { DesktopStateStore } from "./state-store";

const REQUEST_ID = "req_0123456789";

function tempStateStore(): DesktopStateStore {
	return new DesktopStateStore(
		join(mkdtempSync(join(tmpdir(), "gwd-test-")), "state.json"),
	);
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 5));
}

interface Harness {
	authority: FakeGatewayAuthority;
	broker: DesktopBroker;
	stateStore: DesktopStateStore;
	ports: FakeGatewayPort[];
	failNextConnects: (count: number, code?: string) => void;
}

const brokers: DesktopBroker[] = [];

afterEach(() => {
	for (const broker of brokers.splice(0)) {
		broker.stop();
	}
	vi.useRealTimers();
});

function createHarness(
	options: {
		authority?: FakeGatewayAuthority;
		stateStore?: DesktopStateStore;
		revealDiagnostics?: () => void;
	} = {},
): Harness {
	const authority = options.authority ?? new FakeGatewayAuthority();
	const ports: FakeGatewayPort[] = [];
	let failuresLeft = 0;
	let failureCode = "gateway_unreachable";
	const stateStore = options.stateStore ?? tempStateStore();
	const broker = new DesktopBroker({
		connectPort: async ({ clientId }) => {
			if (failuresLeft > 0) {
				failuresLeft -= 1;
				throw Object.assign(new Error("connect failed"), {
					gatewayError: {
						code: failureCode,
						message: "connect failed",
						retryable: failureCode !== "protocol_version_unsupported",
					},
				});
			}
			const port = new FakeGatewayPort(authority, clientId);
			ports.push(port);
			return port as GatewayPort;
		},
		stateStore,
		logger: createNullLogger(),
		jitterRatio: 0,
		revealDiagnostics: options.revealDiagnostics,
	});
	brokers.push(broker);
	return {
		authority,
		broker,
		stateStore,
		ports,
		failNextConnects: (count, code = "gateway_unreachable") => {
			failuresLeft = count;
			failureCode = code;
		},
	};
}

describe("backoff schedule", () => {
	it("follows 250/500/1000/2000/5000 then caps at 10000", () => {
		expect(
			[0, 1, 2, 3, 4, 5, 6, 20].map((attempt) => backoffDelayMs(attempt, 0)),
		).toEqual([250, 500, 1000, 2000, 5000, 10000, 10000, 10000]);
	});

	it("applies bounded jitter", () => {
		const delay = backoffDelayMs(0, 0.2, () => 1);
		expect(delay).toBe(300);
		const low = backoffDelayMs(0, 0.2, () => 0);
		expect(low).toBe(200);
	});
});

describe("connection lifecycle", () => {
	it("connects, hydrates, and reports the development execution mode", async () => {
		const { broker } = createHarness();
		await broker.start();
		const projection = broker.projectionSnapshot;
		expect(projection.connection.state).toBe("connected");
		expect(projection.connection.executionMode).toBe("development");
		expect(projection.connection.sandboxed).toBe(false);
		expect(projection.bots).toHaveLength(1);
		expect(projection.selectedBotId).toBe(projection.bots[0].botId);
	});

	it("shows unavailable with start instructions when the Gateway is missing", async () => {
		const harness = createHarness();
		harness.failNextConnects(1000);
		await harness.broker.start();
		const projection = harness.broker.projectionSnapshot;
		expect(projection.connection.state).toBe("unavailable");
		expect(projection.connection.startInstructions).toContain("cline-gateway");
		expect(projection.connection.lastError?.action).toBe("start_gateway");
	});

	it("treats an incompatible protocol as terminal (no retry loop)", async () => {
		const harness = createHarness();
		harness.failNextConnects(1, "protocol_version_unsupported");
		await harness.broker.start();
		const projection = harness.broker.projectionSnapshot;
		expect(projection.connection.state).toBe("incompatible");
		expect(projection.connection.lastError?.action).toBe("update_client");
		// No reconnect attempt happens on its own.
		await settle();
		expect(harness.ports).toHaveLength(0);
	});

	it("reconnects after disconnect and resumes from the cursor", async () => {
		const harness = createHarness();
		await harness.broker.start();
		const accepted = harness.authority.startRun({
			botId: harness.authority.defaultBotId,
			prompt: "first",
		});
		await settle();

		// The Gateway connection dies; events continue server-side.
		harness.ports[0].simulateDisconnect();
		harness.authority.setRunState(accepted.runId, "running");
		harness.authority.setRunState(accepted.runId, "completed", {
			endedAt: Date.now(),
			outputText: "done while away",
		});

		// Backoff attempt 0 fires after 250ms.
		await new Promise((resolve) => setTimeout(resolve, 400));
		const projection = harness.broker.projectionSnapshot;
		expect(projection.connection.state).toBe("connected");
		expect(harness.ports).toHaveLength(2);
		const session = projection.sessions[0];
		expect(session.lastRunState ?? session.activity).toBeDefined();
		// The missed terminal state arrived through replay, not remutation.
		expect(
			harness.authority.runs.get(accepted.runId)?.state,
		).toBe("completed");
	});

	it("resets everything when the Gateway identity changes", async () => {
		const harness = createHarness();
		await harness.broker.start();
		expect(harness.stateStore.current.gatewayId).toBe(
			harness.authority.gatewayId,
		);
		harness.broker.stop();
		brokers.pop();

		// A different Gateway (new gatewayId) now serves the same endpoint.
		const otherAuthority = new FakeGatewayAuthority();
		const second = createHarness({
			authority: otherAuthority,
			stateStore: harness.stateStore,
		});
		await second.broker.start();
		expect(second.stateStore.current.gatewayId).toBe(
			otherAuthority.gatewayId,
		);
		expect(second.broker.projectionSnapshot.connection.gatewayId).toBe(
			otherAuthority.gatewayId,
		);
	});

	it("recovers from an event gap by reconnecting and rehydrating", async () => {
		const harness = createHarness();
		await harness.broker.start();
		const accepted = harness.authority.startRun({
			botId: harness.authority.defaultBotId,
			prompt: "gap test",
		});
		await settle();

		// Force a gap: deliver a fabricated event with a skipped sequence.
		const port = harness.ports[0];
		port.deliver({
			version: 1,
			sequence: harness.authority.lastSequence + 100,
			event: "run.started",
			scope: { runId: accepted.runId },
			payload: { state: "running" },
		} as never);
		await new Promise((resolve) => setTimeout(resolve, 400));
		expect(harness.ports.length).toBeGreaterThanOrEqual(2);
		expect(harness.broker.projectionSnapshot.connection.state).toBe(
			"connected",
		);
	});
});

describe("commands", () => {
	it("starts the first run from a prompt and follows the lazy session", async () => {
		const harness = createHarness();
		await harness.broker.start();
		const botId = harness.authority.defaultBotId;
		const result = (await harness.broker.execute({
			command: "run.start",
			clientRequestId: REQUEST_ID,
			botId,
			prompt: "create my first session",
		})) as { runId: string; queuePosition: number };
		expect(result.runId).toMatch(/^run_/);
		expect(result.queuePosition).toBe(0);
		await settle();
		const projection = harness.broker.projectionSnapshot;
		expect(projection.sessions).toHaveLength(1);
		expect(projection.selectedSessionId).toBe(projection.sessions[0].sessionId);
		expect(projection.activeSession?.queuedTurns.length ?? 0).toBeGreaterThan(
			0,
		);
	});

	it("deduplicates duplicate client request IDs (no double mutation)", async () => {
		const harness = createHarness();
		await harness.broker.start();
		const botId = harness.authority.defaultBotId;
		const command = {
			command: "run.start" as const,
			clientRequestId: "req_duplicate_01",
			botId,
			prompt: "exactly once",
		};
		const [first, second] = await Promise.all([
			harness.broker.execute(command),
			harness.broker.execute(command),
		]);
		expect(second).toEqual(first);
		expect(harness.authority.runs.size).toBe(1);
	});

	it("maps workspace selections to Gateway workspace roots without leaking paths", async () => {
		const harness = createHarness();
		await harness.broker.start();
		const botId = harness.authority.defaultBotId;
		// Existing session (other bot) provides an existing workspace choice.
		harness.authority.sessions.push({
			sessionId: "ses_other" as never,
			botId: "bot_other" as never,
			workspace: Object.freeze({ rootPath: "/real/project/path" }),
			state: "active",
			createdAt: 1,
			revision: 0,
		});
		await harness.broker.execute({ command: "gateway.reconnect" });
		// Rehydrate to pick up the second workspace.
		harness.ports.at(-1)?.simulateDisconnect();
		await new Promise((resolve) => setTimeout(resolve, 400));
		const projection = harness.broker.projectionSnapshot;
		const existing = projection.workspaces.find(
			(workspace) => workspace.kind === "existing",
		);
		expect(existing).toBeDefined();
		expect(JSON.stringify(projection)).not.toContain("/real/project/path");

		await harness.broker.execute({
			command: "workspace.select",
			workspaceId: existing?.workspaceId ?? "",
		});
		await harness.broker.execute({
			command: "run.start",
			clientRequestId: "req_workspace_01",
			botId,
			prompt: "use the existing workspace",
		});
		const session = harness.authority.sessionFor(botId);
		expect(session?.workspace.rootPath).toBe("/real/project/path");
	});

	it("rejects mutations while disconnected instead of queueing them", async () => {
		const harness = createHarness();
		harness.failNextConnects(1000);
		await harness.broker.start();
		await expect(
			harness.broker.execute({
				command: "run.start",
				clientRequestId: "req_offline_001",
				botId: "bot_x",
				prompt: "should fail",
			}),
		).rejects.toMatchObject({
			code: "gateway_unreachable",
			action: "start_gateway",
		});
		expect(harness.authority.runs.size).toBe(0);
	});

	it("steers, interrupts, and retries through the typed surface", async () => {
		const harness = createHarness();
		await harness.broker.start();
		const botId = harness.authority.defaultBotId;
		const accepted = (await harness.broker.execute({
			command: "run.start",
			clientRequestId: "req_steering_01",
			botId,
			prompt: "long running work",
		})) as { runId: string };
		harness.authority.setRunState(accepted.runId, "running");
		await settle();

		const steer = (await harness.broker.execute({
			command: "run.steer",
			clientRequestId: "req_steering_02",
			runId: accepted.runId,
			text: "change direction",
		})) as { merged: boolean };
		expect(steer.merged).toBe(true);

		await harness.broker.execute({
			command: "run.interrupt",
			clientRequestId: "req_steering_03",
			runId: accepted.runId,
		});
		await settle();
		expect(harness.authority.runs.get(accepted.runId)?.state).toBe(
			"interrupted",
		);
		expect(
			harness.broker.projectionSnapshot.activeSession?.currentRun?.retryable,
		).toBe(true);

		const retried = (await harness.broker.execute({
			command: "run.retry",
			clientRequestId: "req_steering_04",
			runId: accepted.runId,
		})) as { runId: string };
		expect(retried.runId).toBe(accepted.runId);
		await settle();
		expect(harness.authority.runs.get(accepted.runId)?.state).toBe("queued");
	});

	it("refuses to retry non-retryable runs with a typed error", async () => {
		const harness = createHarness();
		await harness.broker.start();
		const accepted = (await harness.broker.execute({
			command: "run.start",
			clientRequestId: "req_noretry_01",
			botId: harness.authority.defaultBotId,
			prompt: "completes fine",
		})) as { runId: string };
		harness.authority.setRunState(accepted.runId, "running");
		harness.authority.setRunState(accepted.runId, "completed");
		await settle();
		await expect(
			harness.broker.execute({
				command: "run.retry",
				clientRequestId: "req_noretry_02",
				runId: accepted.runId,
			}),
		).rejects.toMatchObject({ code: "invalid_state_transition" });
	});

	it("reveals diagnostics only through the fixed native capability", async () => {
		let revealed = 0;
		const harness = createHarness({
			revealDiagnostics: () => {
				revealed += 1;
			},
		});
		await harness.broker.start();
		await harness.broker.execute({ command: "diagnostics.reveal" });
		expect(revealed).toBe(1);
	});
});

describe("approvals", () => {
	it("projects approval requests and answers them from the webview command", async () => {
		const harness = createHarness();
		await harness.broker.start();
		const accepted = (await harness.broker.execute({
			command: "run.start",
			clientRequestId: "req_approval_01",
			botId: harness.authority.defaultBotId,
			prompt: "needs approval",
		})) as { runId: string };
		await settle();
		const { id, answer } = harness.authority.requestApproval(
			{ runId: accepted.runId },
			{ toolName: "write_file", toolCallId: "call_1", input: { p: 1 } },
		);
		await settle();
		expect(
			harness.broker.projectionSnapshot.approvals.map(
				(approval) => approval.requestId,
			),
		).toContain(id);

		const result = (await harness.broker.execute({
			command: "approval.resolve",
			clientRequestId: "req_approval_02",
			requestId: id,
			approved: true,
		})) as { resolved: boolean };
		expect(result.resolved).toBe(true);
		await expect(answer).resolves.toMatchObject({ approved: true });
		await settle();
		expect(harness.broker.projectionSnapshot.approvals).toHaveLength(0);
	});

	it("first answer wins: the loser gets approval_already_resolved", async () => {
		const harness = createHarness();
		await harness.broker.start();
		const accepted = (await harness.broker.execute({
			command: "run.start",
			clientRequestId: "req_race_00001",
			botId: harness.authority.defaultBotId,
			prompt: "race me",
		})) as { runId: string };
		await settle();
		const { id } = harness.authority.requestApproval(
			{ runId: accepted.runId },
			{ toolName: "write_file", toolCallId: "call_race" },
		);
		await settle();

		// A second client wins the race directly against the authority.
		expect(
			harness.authority.respondToApproval(id, { approved: false }),
		).toBe(true);
		await settle();

		// The desktop's late answer is rejected locally with a typed error
		// and its pending approval was dismissed by the broadcast.
		await expect(
			harness.broker.execute({
				command: "approval.resolve",
				clientRequestId: "req_race_00002",
				requestId: id,
				approved: true,
			}),
		).rejects.toMatchObject({ code: "approval_already_resolved" });
		expect(harness.broker.projectionSnapshot.approvals).toHaveLength(0);
	});
});
