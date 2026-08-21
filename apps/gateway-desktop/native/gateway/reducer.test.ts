import type { GatewayEvent } from "@cline/shared/gateway";
import { describe, expect, it } from "vitest";
import {
	MANAGED_WORKSPACE_PROJECTION_ID,
	MAX_PROJECTION_MESSAGE_CHARS,
} from "../../shared/projection";
import {
	addApproval,
	applyGatewayEvent,
	createReducerContext,
	flattenMessageText,
	hydrate,
	removeApproval,
	setConnection,
	workspaceIdForPath,
} from "./reducer";

const BOT = "bot_test0001";
const SESSION = "ses_test0001";
const RUN = "run_test0001";

function event(
	sequence: number,
	name: string,
	payload?: Record<string, unknown>,
	scope: Record<string, string> = {
		botId: BOT,
		sessionId: SESSION,
		runId: RUN,
	},
): GatewayEvent {
	return {
		version: 1,
		sequence,
		event: name,
		scope,
		...(payload ? { payload } : {}),
	} as GatewayEvent;
}

function hydratedContext() {
	const context = createReducerContext(() => 1_000);
	hydrate(context, {
		hello: { gatewayId: "gw_x", instanceId: "gwi_x", protocolVersion: 1 },
		status: {
			executionMode: "development",
			sandboxed: false,
			defaultBotId: BOT,
			counts: { lastEventSequence: 0 },
		},
		bots: [
			{
				identity: {
					botId: BOT as never,
					name: "cline",
					role: "lead" as never,
					parentBotId: null,
					provenance: { createdBy: "bootstrap" },
					createdAt: 1,
				},
				config: {} as never,
				status: "active",
				revision: 0,
			},
		],
		sessions: [
			{
				sessionId: SESSION as never,
				botId: BOT as never,
				workspace: Object.freeze({ rootPath: "/home/user/.cline/ws1" }),
				state: "active",
				createdAt: 1,
				revision: 0,
			},
		],
		pendingRuns: [],
		snapshot: {
			session: {
				sessionId: SESSION as never,
				botId: BOT as never,
				workspace: Object.freeze({ rootPath: "/home/user/.cline/ws1" }),
				state: "active",
				createdAt: 1,
				revision: 0,
			},
			runs: [],
			messages: [],
			totalMessageCount: 0,
			lastEventSequence: 0,
		},
		cursorBasis: 0,
	});
	return context;
}

describe("hydration", () => {
	it("builds a connected projection with the default lead bot selected", () => {
		const context = hydratedContext();
		const projection = context.projection;
		expect(projection.connection.state).toBe("connected");
		expect(projection.connection.executionMode).toBe("development");
		expect(projection.connection.sandboxed).toBe(false);
		expect(projection.selectedBotId).toBe(BOT);
		expect(projection.bots[0].isDefaultLead).toBe(true);
		expect(projection.sessions).toHaveLength(1);
		expect(context.cursorSequence).toBe(0);
	});

	it("never leaks workspace paths into the projection", () => {
		const context = hydratedContext();
		const serialized = JSON.stringify(context.projection);
		expect(serialized).not.toContain("/home/user");
		expect(serialized).not.toContain(".cline/ws1");
		// The path lives only in the broker-side map.
		const workspaceId = workspaceIdForPath(context, "/home/user/.cline/ws1");
		expect(context.workspacePathById.get(workspaceId)).toBe(
			"/home/user/.cline/ws1",
		);
		expect(
			context.projection.workspaces.some(
				(workspace) => workspace.workspaceId === workspaceId,
			),
		).toBe(true);
	});

	it("always offers the managed workspace choice", () => {
		const context = hydratedContext();
		expect(
			context.projection.workspaces.some(
				(workspace) =>
					workspace.workspaceId === MANAGED_WORKSPACE_PROJECTION_ID &&
					workspace.kind === "managed",
			),
		).toBe(true);
	});
});

describe("contiguous event application", () => {
	it("applies contiguous events and tracks the cursor", () => {
		const context = hydratedContext();
		expect(
			applyGatewayEvent(
				context,
				event(1, "run.queued", { state: "queued", acceptedAt: 5 }),
			).outcome,
		).toBe("applied");
		expect(
			applyGatewayEvent(context, event(2, "run.started", { state: "running" }))
				.outcome,
		).toBe("applied");
		expect(context.cursorSequence).toBe(2);
		expect(context.projection.activeSession?.currentRun?.state).toBe("running");
	});

	it("skips duplicates without changing state", () => {
		const context = hydratedContext();
		applyGatewayEvent(context, event(1, "run.queued", { state: "queued" }));
		const revision = context.projection.revision;
		expect(
			applyGatewayEvent(context, event(1, "run.queued", { state: "queued" }))
				.outcome,
		).toBe("duplicate");
		expect(context.projection.revision).toBe(revision);
	});

	it("stops on a sequence gap and demands rehydration", () => {
		const context = hydratedContext();
		applyGatewayEvent(context, event(1, "run.queued", { state: "queued" }));
		const result = applyGatewayEvent(
			context,
			event(3, "run.started", { state: "running" }),
		);
		expect(result.outcome).toBe("gap");
		// Nothing past the gap was applied.
		expect(context.cursorSequence).toBe(1);
		expect(context.projection.activeSession?.currentRun?.state).toBe("queued");
	});
});

describe("run lifecycle projection", () => {
	it("marks failed runs retryable and captures the error", () => {
		const context = hydratedContext();
		applyGatewayEvent(context, event(1, "run.queued", { state: "queued" }));
		applyGatewayEvent(context, event(2, "run.started", { state: "running" }));
		applyGatewayEvent(
			context,
			event(3, "run.failed", {
				state: "failed",
				endedAt: 9,
				error: { name: "EngineError", message: "boom" },
			}),
		);
		const run = context.projection.activeSession?.currentRun;
		expect(run?.state).toBe("failed");
		expect(run?.retryable).toBe(true);
		expect(run?.error?.message).toBe("boom");
		expect(
			context.projection.sessions.find((s) => s.sessionId === SESSION)
				?.activity,
		).toBe("idle");
	});

	it("tracks queued turns FIFO and clears them when runs start", () => {
		const context = hydratedContext();
		applyGatewayEvent(context, event(1, "run.queued", { state: "queued" }));
		applyGatewayEvent(context, event(2, "run.started", { state: "running" }));
		applyGatewayEvent(
			context,
			event(
				3,
				"run.queued",
				{ state: "queued" },
				{ botId: BOT, sessionId: SESSION, runId: "run_test0002" },
			),
		);
		expect(
			context.projection.activeSession?.queuedTurns.map((turn) => turn.runId),
		).toEqual(["run_test0002"]);
		applyGatewayEvent(
			context,
			event(4, "run.completed", { state: "completed" }),
		);
		applyGatewayEvent(
			context,
			event(
				5,
				"run.started",
				{ state: "running" },
				{ botId: BOT, sessionId: SESSION, runId: "run_test0002" },
			),
		);
		expect(context.projection.activeSession?.queuedTurns).toEqual([]);
		expect(context.projection.activeSession?.currentRun?.runId).toBe(
			"run_test0002",
		);
	});

	it("accumulates streaming text and resets it on the assistant message", () => {
		const context = hydratedContext();
		applyGatewayEvent(context, event(1, "run.queued", { state: "queued" }));
		applyGatewayEvent(context, event(2, "run.started", { state: "running" }));
		applyGatewayEvent(
			context,
			event(3, "engine.textDelta", { type: "text-delta", text: "Hello " }),
		);
		applyGatewayEvent(
			context,
			event(4, "engine.textDelta", { type: "text-delta", text: "world" }),
		);
		expect(context.projection.activeSession?.streaming?.text).toBe(
			"Hello world",
		);
		applyGatewayEvent(
			context,
			event(5, "run.messageAppended", {
				message: {
					id: "msg_1",
					role: "assistant",
					content: [{ type: "text", text: "Hello world" }],
					createdAt: 10,
				},
			}),
		);
		expect(context.projection.activeSession?.streaming).toBeUndefined();
		expect(context.projection.activeSession?.messages.at(-1)?.text).toBe(
			"Hello world",
		);
	});

	it("bumps the attempt number from attemptStarted events", () => {
		const context = hydratedContext();
		applyGatewayEvent(context, event(1, "run.queued", { state: "queued" }));
		applyGatewayEvent(context, event(2, "run.started", { state: "running" }));
		applyGatewayEvent(context, event(3, "run.attemptStarted", { attempt: 2 }));
		expect(context.projection.activeSession?.currentRun?.attempt).toBe(2);
	});

	it("captures the submit_and_exit summary on a completed run", () => {
		const context = hydratedContext();
		applyGatewayEvent(context, event(1, "run.queued", { state: "queued" }));
		applyGatewayEvent(context, event(2, "run.started", { state: "running" }));
		applyGatewayEvent(
			context,
			event(3, "run.completed", {
				state: "completed",
				outputText: "Research Assistant could not be created.",
			}),
		);
		expect(context.projection.activeSession?.currentRun).toMatchObject({
			state: "completed",
			outputPreview: "Research Assistant could not be created.",
		});
	});
});

describe("untrusted payload handling", () => {
	it("ignores malformed messages instead of crashing", () => {
		const context = hydratedContext();
		applyGatewayEvent(context, event(1, "run.queued", { state: "queued" }));
		expect(
			applyGatewayEvent(
				context,
				event(2, "run.messageAppended", {
					message: { nonsense: true },
				}),
			).outcome,
		).toBe("applied");
		expect(context.projection.activeSession?.messages).toHaveLength(0);
	});

	it("bounds flattened message text", () => {
		const flattened = flattenMessageText({
			content: [
				{ type: "text", text: "y".repeat(MAX_PROJECTION_MESSAGE_CHARS * 2) },
			],
		});
		expect(flattened.truncated).toBe(true);
		expect(flattened.text.length).toBeLessThanOrEqual(
			MAX_PROJECTION_MESSAGE_CHARS + 1,
		);
	});

	it("tolerates unknown additive event names", () => {
		const context = hydratedContext();
		expect(
			applyGatewayEvent(
				context,
				event(1, "gateway.futureFeature", {
					anything: true,
				}),
			).outcome,
		).toBe("applied");
	});
});

describe("approvals", () => {
	it("adds and removes approvals independently of events", () => {
		const context = hydratedContext();
		addApproval(context, {
			version: 1,
			id: "srq_1",
			method: "client.requestToolApproval",
			scope: {
				botId: BOT as never,
				sessionId: SESSION as never,
				runId: RUN as never,
			},
			params: { toolName: "write_file", toolCallId: "call_1", input: { a: 1 } },
		});
		expect(context.projection.approvals).toHaveLength(1);
		expect(context.projection.approvals[0].toolName).toBe("write_file");
		expect(context.projection.activeSession?.outstandingApprovalIds).toContain(
			"srq_1",
		);
		removeApproval(context, "srq_1");
		expect(context.projection.approvals).toHaveLength(0);
		expect(context.projection.activeSession?.outstandingApprovalIds).toEqual(
			[],
		);
	});

	it("dismisses approvals on the approval.resolved broadcast", () => {
		const context = hydratedContext();
		addApproval(context, {
			version: 1,
			id: "srq_2",
			method: "client.requestToolApproval",
			scope: { sessionId: SESSION as never },
			params: {},
		});
		applyGatewayEvent(
			context,
			event(1, "approval.resolved", {
				requestId: "srq_2",
				approved: true,
			}),
		);
		expect(context.projection.approvals).toHaveLength(0);
	});
});

describe("connection state", () => {
	it("attaches copyable start instructions when unavailable", () => {
		const context = createReducerContext(() => 1);
		setConnection(context, { state: "unavailable" });
		expect(context.projection.connection.startInstructions).toContain(
			"clinegate",
		);
	});
});
