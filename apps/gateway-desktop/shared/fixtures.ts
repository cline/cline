/**
 * Fixture projections: deterministic `DesktopProjection` states used by
 * webview development mode (`?fixtures=<name>`), unit tests, and the
 * screenshots in the README. They contain no real IDs or paths.
 */

import {
	createInitialProjection,
	type DesktopProjection,
	MANAGED_WORKSPACE_PROJECTION_ID,
} from "./projection";

function base(): DesktopProjection {
	const projection = createInitialProjection();
	projection.revision = 1;
	projection.generatedAt = 1_700_000_000_000;
	return projection;
}

export function fixtureUnavailable(): DesktopProjection {
	const projection = base();
	projection.connection = {
		state: "unavailable",
		startInstructions: [
			"# Start the Cline Gateway, then press Reconnect:",
			"cline-gateway start",
		].join("\n"),
		lastError: {
			code: "gateway_unreachable",
			message: "No Gateway discovery record was found",
			retryable: true,
			action: "start_gateway",
		},
	};
	return projection;
}

export function fixtureIncompatible(): DesktopProjection {
	const projection = base();
	projection.connection = {
		state: "incompatible",
		lastError: {
			code: "protocol_version_unsupported",
			message: "The Gateway speaks protocol 2; this client supports 1",
			retryable: false,
			action: "update_client",
		},
	};
	return projection;
}

export function fixtureConnectedIdle(): DesktopProjection {
	const projection = base();
	projection.connection = {
		state: "connected",
		gatewayId: "gw_fixture0000000001",
		instanceId: "gwi_fixture000000001",
		protocolVersion: 1,
		executionMode: "development",
		sandboxed: false,
		isolation: "in-process-direct",
		developmentExecution: true,
	};
	projection.diagnostics.plugins = {
		generation: 3,
		pluginCount: 2,
		heldGenerations: [3],
		pinnedByRuns: 0,
		lastReloadOk: true,
	};
	projection.diagnostics.catalogGeneration = 3;
	projection.connectors = [
		{
			connectorId: "con_fixture0000001",
			botId: "bot_fixturelead000001",
			kind: "telegram",
			name: "team-telegram",
			status: "enabled",
			hasCredential: true,
			workerState: "running",
			workerRestarts: 0,
		},
	];
	projection.schedules = [
		{
			scheduleId: "sch_fixture0000001",
			botId: "bot_fixturelead000001",
			name: "nightly-summary",
			trigger: "every 86400000ms",
			enabled: true,
			nextDueAt: 1_700_086_400_000,
			lastJobState: "completed",
			lastRunId: "run_fixture00000009",
		},
	];
	projection.bots = [
		{
			botId: "bot_fixturelead000001",
			name: "cline",
			role: "lead",
			status: "active",
			isDefaultLead: true,
		},
	];
	projection.selectedBotId = "bot_fixturelead000001";
	projection.selectedWorkspaceId = MANAGED_WORKSPACE_PROJECTION_ID;
	projection.diagnostics.lastEventSequence = 12;
	projection.diagnostics.eventsApplied = 12;
	return projection;
}

export function fixtureStreamingRun(): DesktopProjection {
	const projection = fixtureConnectedIdle();
	projection.revision = 2;
	const sessionId = "ses_fixture000000001";
	projection.sessions = [
		{
			sessionId,
			botId: "bot_fixturelead000001",
			state: "active",
			createdAt: 1_700_000_000_500,
			workspaceId: MANAGED_WORKSPACE_PROJECTION_ID,
			activity: "running",
			lastRunState: "running",
		},
	];
	projection.selectedSessionId = sessionId;
	projection.activeSession = {
		sessionId,
		botId: "bot_fixturelead000001",
		workspaceId: MANAGED_WORKSPACE_PROJECTION_ID,
		state: "active",
		messages: [
			{
				id: "msg_fixture_user_1",
				role: "user",
				text: "Summarize the Gateway RFC in one paragraph.",
				createdAt: 1_700_000_001_000,
				runId: "run_fixture00000001",
			},
		],
		queuedTurns: [
			{
				runId: "run_fixture00000002",
				promptPreview: "Then list the Phase 3 acceptance criteria.",
				acceptedAt: 1_700_000_002_000,
			},
		],
		currentRun: {
			runId: "run_fixture00000001",
			state: "running",
			attempt: 1,
			acceptedAt: 1_700_000_001_000,
			startedAt: 1_700_000_001_100,
			retryable: false,
		},
		runs: [
			{
				runId: "run_fixture00000001",
				state: "running",
				attempt: 1,
				acceptedAt: 1_700_000_001_000,
				startedAt: 1_700_000_001_100,
				retryable: false,
			},
		],
		streaming: {
			runId: "run_fixture00000001",
			text: "The Gateway RFC replaces per-app runtimes with one durable authority…",
		},
		tools: [
			{
				toolCallId: "call_fixture_1",
				toolName: "read_file",
				state: "finished",
			},
		],
		usage: { inputTokens: 1200, outputTokens: 250, totalCost: 0.004 },
		outstandingApprovalIds: [],
	};
	return projection;
}

export function fixtureApprovalPending(): DesktopProjection {
	const projection = fixtureStreamingRun();
	projection.revision = 3;
	projection.approvals = [
		{
			requestId: "srq_fixture_1",
			method: "client.requestToolApproval",
			botId: "bot_fixturelead000001",
			sessionId: "ses_fixture000000001",
			runId: "run_fixture00000001",
			toolName: "write_file",
			toolCallId: "call_fixture_2",
			inputPreview: '{"path":"notes.md"}',
			receivedAt: 1_700_000_003_000,
		},
	];
	if (projection.activeSession) {
		projection.activeSession.outstandingApprovalIds = ["srq_fixture_1"];
	}
	return projection;
}

export function fixtureFailedRun(): DesktopProjection {
	const projection = fixtureConnectedIdle();
	projection.revision = 2;
	const sessionId = "ses_fixture000000001";
	projection.sessions = [
		{
			sessionId,
			botId: "bot_fixturelead000001",
			state: "active",
			createdAt: 1_700_000_000_500,
			workspaceId: MANAGED_WORKSPACE_PROJECTION_ID,
			activity: "idle",
			lastRunState: "failed",
		},
	];
	projection.selectedSessionId = sessionId;
	projection.activeSession = {
		sessionId,
		botId: "bot_fixturelead000001",
		workspaceId: MANAGED_WORKSPACE_PROJECTION_ID,
		state: "active",
		messages: [
			{
				id: "msg_fixture_user_1",
				role: "user",
				text: "Run the flaky data export.",
				createdAt: 1_700_000_001_000,
				runId: "run_fixture00000001",
			},
		],
		queuedTurns: [],
		currentRun: {
			runId: "run_fixture00000001",
			state: "failed",
			attempt: 1,
			acceptedAt: 1_700_000_001_000,
			startedAt: 1_700_000_001_100,
			endedAt: 1_700_000_004_000,
			retryable: true,
			error: { name: "EngineError", message: "provider timeout" },
		},
		runs: [
			{
				runId: "run_fixture00000001",
				state: "failed",
				attempt: 1,
				acceptedAt: 1_700_000_001_000,
				startedAt: 1_700_000_001_100,
				endedAt: 1_700_000_004_000,
				retryable: true,
				error: { name: "EngineError", message: "provider timeout" },
			},
		],
		tools: [],
		outstandingApprovalIds: [],
	};
	return projection;
}

export const FIXTURE_PROJECTIONS: Record<string, () => DesktopProjection> = {
	unavailable: fixtureUnavailable,
	incompatible: fixtureIncompatible,
	idle: fixtureConnectedIdle,
	streaming: fixtureStreamingRun,
	approval: fixtureApprovalPending,
	failed: fixtureFailedRun,
};
