import { TeamMessageType } from "@cline/shared";
import { describe, expect, it } from "vitest";
import type { TeamEvent } from "./multi-agent";
import {
	isDurableTeamEvent,
	shouldFlushTeamEventImmediately,
	TEAM_RUN_RESULT_TEXT_LIMIT,
	toPersistableTeamEvent,
	toTeamRunResultRecord,
} from "./persistence-policy";

const fullResult = {
	text: "final answer",
	usage: { inputTokens: 10, outputTokens: 5, totalCost: 0.01 },
	messages: [{ role: "user", content: "x".repeat(10_000) }],
	toolCalls: [{ name: "read_files" }],
	iterations: 3,
	finishReason: "completed",
	model: { id: "m", provider: "p" },
	startedAt: new Date(),
	endedAt: new Date(),
	durationMs: 42,
};

const baseRun = {
	id: "run_00001",
	agentId: "a",
	status: "completed" as const,
	message: "do it",
	priority: 0,
	retryCount: 0,
	maxRetries: 0,
	startedAt: new Date(),
};

describe("team persistence policy", () => {
	it("classifies streamed chunks and heartbeats as telemetry", () => {
		expect(
			isDurableTeamEvent({
				type: TeamMessageType.AgentEvent,
				agentId: "a",
				event: { type: "content_start" },
			} as unknown as TeamEvent),
		).toBe(false);
		expect(
			isDurableTeamEvent({
				type: TeamMessageType.RunProgress,
				run: baseRun,
				message: "heartbeat",
			}),
		).toBe(false);
	});

	it("treats a scheduled retry as a durable, immediate write", () => {
		const retry: TeamEvent = {
			type: TeamMessageType.RunProgress,
			run: { ...baseRun, status: "queued", retryCount: 1, maxRetries: 2 },
			message: "retry_scheduled_1",
		};
		expect(isDurableTeamEvent(retry)).toBe(true);
		expect(shouldFlushTeamEventImmediately(retry)).toBe(true);
	});

	it("classifies state-changing events as durable", () => {
		expect(
			isDurableTeamEvent({ type: TeamMessageType.RunCompleted, run: baseRun }),
		).toBe(true);
		expect(
			isDurableTeamEvent({
				type: TeamMessageType.TeammateShutdown,
				agentId: "a",
			}),
		).toBe(true);
	});

	it("flushes terminal run states and membership changes immediately", () => {
		expect(
			shouldFlushTeamEventImmediately({
				type: TeamMessageType.RunCompleted,
				run: baseRun,
			}),
		).toBe(true);
		expect(
			shouldFlushTeamEventImmediately({
				type: TeamMessageType.RunStarted,
				run: baseRun,
			}),
		).toBe(false);
	});

	it("compacts an AgentResult to the summary fields only", () => {
		const record = toTeamRunResultRecord(fullResult);
		expect(record).toEqual({
			text: "final answer",
			iterations: 3,
			finishReason: "completed",
			durationMs: 42,
			usage: {
				inputTokens: 10,
				outputTokens: 5,
				cacheReadTokens: undefined,
				cacheWriteTokens: undefined,
				totalCost: 0.01,
			},
		});
		expect(JSON.stringify(record)).not.toContain("messages");
	});

	it("truncates very long result text", () => {
		const record = toTeamRunResultRecord({
			...fullResult,
			text: "y".repeat(TEAM_RUN_RESULT_TEXT_LIMIT * 2),
		});
		expect(record?.text.length).toBe(TEAM_RUN_RESULT_TEXT_LIMIT);
	});

	it("returns undefined for missing results", () => {
		expect(toTeamRunResultRecord(undefined)).toBeUndefined();
		expect(toTeamRunResultRecord("nope")).toBeUndefined();
	});

	it("strips transcripts from task_end and run events before logging", () => {
		const taskEnd = toPersistableTeamEvent({
			type: TeamMessageType.TaskEnd,
			agentId: "a",
			result: fullResult as never,
			messages: fullResult.messages as never,
			error: new Error("boom"),
		});
		const serialized = JSON.stringify(taskEnd);
		expect(serialized).not.toContain("xxxxxxxx");
		expect(serialized).toContain("boom");

		const runDone = toPersistableTeamEvent({
			type: TeamMessageType.RunCompleted,
			run: { ...baseRun, result: fullResult },
		});
		expect(JSON.stringify(runDone)).not.toContain("xxxxxxxx");
	});
});
