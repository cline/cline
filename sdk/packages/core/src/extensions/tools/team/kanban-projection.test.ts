import { describe, expect, it } from "vitest";
import { AgentTeamsRuntime, type TeamEvent } from "./multi-agent";
import {
	buildTeamProgressSummary,
	toTeamProgressLifecycleEvent,
} from "./projections";

describe("local Kanban projection", () => {
	it("projects task creation, assignment, status, and optimistic revisions from one runtime record", () => {
		const events: TeamEvent[] = [];
		const runtime = new AgentTeamsRuntime({
			teamName: "phase-10",
			onTeamEvent: (event) => events.push(event),
		});

		const created = runtime.createTask({
			title: "Implement local teams",
			description: "Use one persisted task model",
			createdBy: "lead",
		});
		expect(created.status).toBe("backlog");

		const ready = runtime.updateTask({
			taskId: created.id,
			expectedRevision: created.revision,
			status: "ready",
		});
		const assigned = runtime.updateTask({
			taskId: ready.id,
			expectedRevision: ready.revision,
			status: "in-progress",
			assignedAgentId: "worker-1",
			worktreePath: "C:\\managed\\worker-1",
			branch: "team/worker-1",
		});
		const review = runtime.completeTask(
			assigned.id,
			"lead",
			"Implementation is ready for user review",
		);
		const _done = runtime.updateTask({
			taskId: review.id,
			expectedRevision: review.revision,
			status: "done",
		});

		const board = runtime.getBoardSnapshot();
		expect(board.version).toBe(2);
		expect(board.revision).toBe(5);
		expect(board.tasks).toEqual([
			expect.objectContaining({
				id: created.id,
				status: "done",
				assignedAgentId: "worker-1",
				worktreePath: "C:\\managed\\worker-1",
				branch: "team/worker-1",
				revision: 5,
			}),
		]);

		const taskEvents = events.filter(
			(event): event is Extract<TeamEvent, { type: "team_task_updated" }> =>
				event.type === "team_task_updated",
		);
		expect(taskEvents.map((event) => event.task.status)).toEqual([
			"backlog",
			"ready",
			"in-progress",
			"review",
			"done",
		]);
		expect(
			toTeamProgressLifecycleEvent({
				teamName: "phase-10",
				sessionId: "root-session",
				event: taskEvents[2],
			}),
		).toEqual(
			expect.objectContaining({
				eventType: "team_task_updated",
				taskId: created.id,
				agentId: "worker-1",
			}),
		);
		expect(
			buildTeamProgressSummary("phase-10", runtime.exportState()).tasks,
		).toEqual(
			expect.objectContaining({
				byStatus: expect.objectContaining({ done: 1 }),
				completionPct: 100,
			}),
		);
	});
});
