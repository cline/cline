import { describe, expect, it, vi } from "vitest";
import {
	createInteractiveGoalGuard,
	formatGoalTaskPrompt,
	formatGoalVerificationPrompt,
	isGoalVerificationPrompt,
	MAX_GOAL_VERIFICATION_ROUNDS,
	sendTurnWithGoalVerification,
} from "./goal-guard";

const toolContext = {
	agentId: "agent",
	iteration: 0,
};

describe("createInteractiveGoalGuard", () => {
	it("sets a goal and submits it wrapped as a /goal user command", () => {
		const guard = createInteractiveGoalGuard();

		const result = guard.setGoal("  fix the failing CLI tests  ");

		expect(result.reply).toContain("Goal set: fix the failing CLI tests");
		expect(result.submitPrompt).toBe(
			'<user_command slash="goal">fix the failing CLI tests</user_command>',
		);
		expect(guard.getActiveGoal()).toEqual({
			goal: "fix the failing CLI tests",
			createdAt: expect.any(String),
			awaitingVerification: false,
		});
	});

	it("replaces the active goal when a new one is set", () => {
		const guard = createInteractiveGoalGuard();
		guard.setGoal("first goal");

		guard.setGoal("second goal");

		expect(guard.getActiveGoal()?.goal).toBe("second goal");
	});

	it("reports status for no goal, an active goal, and verification", () => {
		const guard = createInteractiveGoalGuard();
		expect(guard.formatStatus()).toContain("No goal is active");

		guard.setGoal("ship the feature");
		expect(guard.formatStatus()).toContain("Active goal: ship the feature");
		expect(guard.formatStatus()).not.toContain("awaiting verification");

		guard.beginVerification();
		expect(guard.formatStatus()).toContain(
			"Active goal: ship the feature (awaiting verification)",
		);
	});

	it("clears the active goal", () => {
		const guard = createInteractiveGoalGuard();
		expect(guard.clearGoal()).toBe("No goal is active.");

		guard.setGoal("some goal");
		expect(guard.clearGoal()).toBe("Goal cleared.");
		expect(guard.getActiveGoal()).toBeUndefined();
	});

	it("refuses mark_goal_complete when no goal is active", async () => {
		const guard = createInteractiveGoalGuard();

		const result = await guard.markGoalCompleteTool.execute({}, toolContext);

		expect(result).toEqual({
			completed: false,
			message: "No goal is active for this session.",
		});
	});

	it("refuses mark_goal_complete before the verification prompt", async () => {
		const guard = createInteractiveGoalGuard();
		guard.setGoal("fix tests");

		const result = await guard.markGoalCompleteTool.execute(
			{ summary: "done" },
			toolContext,
		);

		expect(result).toEqual({
			completed: false,
			message:
				"Do not call mark_goal_complete until the follow-up verification prompt asks whether the goal is complete.",
		});
		expect(guard.getActiveGoal()?.goal).toBe("fix tests");
	});

	it("completes the goal after verification begins", async () => {
		const guard = createInteractiveGoalGuard();
		guard.setGoal("fix tests");
		guard.beginVerification();

		const result = await guard.markGoalCompleteTool.execute(
			{ summary: "all tests pass" },
			toolContext,
		);

		expect(result).toEqual({
			completed: true,
			goal: "fix tests",
			summary: "all tests pass",
		});
		expect(guard.getActiveGoal()).toBeUndefined();
		expect(guard.getLastCompletedGoal()).toEqual({
			goal: "fix tests",
			completedAt: expect.any(String),
			summary: "all tests pass",
		});
		expect(guard.formatStatus()).toContain(
			"Last completed goal: fix tests — all tests pass",
		);
	});

	it("returns undefined from beginVerification when no goal is active", () => {
		const guard = createInteractiveGoalGuard();
		expect(guard.beginVerification()).toBeUndefined();
	});

	it("revokes verification authorization via resetVerification", async () => {
		const guard = createInteractiveGoalGuard();
		guard.setGoal("fix tests");
		guard.beginVerification();

		guard.resetVerification();

		expect(guard.getActiveGoal()?.awaitingVerification).toBe(false);
		const result = await guard.markGoalCompleteTool.execute({}, toolContext);
		expect(result).toMatchObject({ completed: false });
	});
});

describe("sendTurnWithGoalVerification", () => {
	const completed = (iterations: number) => ({
		finishReason: "completed",
		iterations,
	});

	it("returns the initial result untouched when no goal is active", async () => {
		const guard = createInteractiveGoalGuard();
		const sendVerificationTurn = vi.fn();

		const result = await sendTurnWithGoalVerification({
			goalGuard: guard,
			sendInitialTurn: async () => completed(3),
			sendVerificationTurn,
		});

		expect(result).toEqual(completed(3));
		expect(sendVerificationTurn).not.toHaveBeenCalled();
	});

	it("skips verification when the initial turn did not complete", async () => {
		const guard = createInteractiveGoalGuard();
		guard.setGoal("fix tests");
		const sendVerificationTurn = vi.fn();

		const result = await sendTurnWithGoalVerification({
			goalGuard: guard,
			sendInitialTurn: async () => ({
				finishReason: "aborted",
				iterations: 2,
			}),
			sendVerificationTurn,
		});

		expect(result).toEqual({ finishReason: "aborted", iterations: 2 });
		expect(sendVerificationTurn).not.toHaveBeenCalled();
		expect(guard.getActiveGoal()?.awaitingVerification).toBe(false);
	});

	it("sends a verification turn and stops once the goal completes", async () => {
		const guard = createInteractiveGoalGuard();
		guard.setGoal("fix tests");
		const sendVerificationTurn = vi.fn(async (prompt: string) => {
			expect(prompt).toBe(formatGoalVerificationPrompt("fix tests"));
			// Simulate the model calling mark_goal_complete during verification.
			await guard.markGoalCompleteTool.execute(
				{ summary: "done" },
				toolContext,
			);
			return completed(1);
		});

		const result = await sendTurnWithGoalVerification({
			goalGuard: guard,
			sendInitialTurn: async () => completed(4),
			sendVerificationTurn,
		});

		expect(sendVerificationTurn).toHaveBeenCalledTimes(1);
		expect(result).toEqual(completed(5));
		expect(guard.getActiveGoal()).toBeUndefined();
	});

	it("keeps nudging until the verification round cap", async () => {
		const guard = createInteractiveGoalGuard();
		guard.setGoal("fix tests");
		const sendVerificationTurn = vi.fn(async () => completed(2));

		const result = await sendTurnWithGoalVerification({
			goalGuard: guard,
			sendInitialTurn: async () => completed(1),
			sendVerificationTurn,
		});

		expect(sendVerificationTurn).toHaveBeenCalledTimes(
			MAX_GOAL_VERIFICATION_ROUNDS,
		);
		expect(result).toEqual(completed(1 + 2 * MAX_GOAL_VERIFICATION_ROUNDS));
		// The goal stays active, so the next completed run nudges again.
		expect(guard.getActiveGoal()?.goal).toBe("fix tests");
	});

	it("returns the prior result when a verification turn yields nothing", async () => {
		const guard = createInteractiveGoalGuard();
		guard.setGoal("fix tests");

		const result = await sendTurnWithGoalVerification({
			goalGuard: guard,
			sendInitialTurn: async () => completed(4),
			sendVerificationTurn: async () => undefined,
		});

		expect(result).toEqual(completed(4));
	});

	it("closes verification authorization whenever the sequence ends with the goal active", async () => {
		const guard = createInteractiveGoalGuard();
		guard.setGoal("fix tests");

		// Cap reached with the goal still active.
		await sendTurnWithGoalVerification({
			goalGuard: guard,
			sendInitialTurn: async () => completed(1),
			sendVerificationTurn: async () => completed(1),
		});
		expect(guard.getActiveGoal()?.awaitingVerification).toBe(false);

		// Verification turn that did not complete (e.g. aborted).
		await sendTurnWithGoalVerification({
			goalGuard: guard,
			sendInitialTurn: async () => completed(1),
			sendVerificationTurn: async () => ({
				finishReason: "aborted",
				iterations: 1,
			}),
		});
		expect(guard.getActiveGoal()?.awaitingVerification).toBe(false);
	});

	it("refuses mark_goal_complete during the next work turn after a stale verification", async () => {
		const guard = createInteractiveGoalGuard();
		guard.setGoal("fix tests");
		// Simulate authorization left dangling by an interrupted sequence.
		guard.beginVerification();

		const initialTurnToolResult: unknown[] = [];
		const result = await sendTurnWithGoalVerification({
			goalGuard: guard,
			sendInitialTurn: async () => {
				// The model tries to complete the goal during ordinary work.
				initialTurnToolResult.push(
					await guard.markGoalCompleteTool.execute({}, toolContext),
				);
				return { finishReason: "aborted", iterations: 1 };
			},
			sendVerificationTurn: async () => completed(1),
		});

		expect(initialTurnToolResult[0]).toMatchObject({ completed: false });
		expect(guard.getActiveGoal()?.goal).toBe("fix tests");
		expect(result).toEqual({ finishReason: "aborted", iterations: 1 });
	});
});

describe("isGoalVerificationPrompt", () => {
	it("detects verification prompts for any goal text", () => {
		expect(
			isGoalVerificationPrompt(formatGoalVerificationPrompt("fix tests")),
		).toBe(true);
		expect(
			isGoalVerificationPrompt(
				formatGoalVerificationPrompt("a goal\nspanning lines"),
			),
		).toBe(true);
	});

	it("does not flag ordinary user messages", () => {
		expect(isGoalVerificationPrompt("fix tests")).toBe(false);
		expect(
			isGoalVerificationPrompt("Are you sure you've completed the goal: x"),
		).toBe(false);
	});
});

describe("formatGoalTaskPrompt", () => {
	it("wraps the goal in a /goal user command envelope", () => {
		expect(formatGoalTaskPrompt("fix tests")).toBe(
			'<user_command slash="goal">fix tests</user_command>',
		);
	});
});
