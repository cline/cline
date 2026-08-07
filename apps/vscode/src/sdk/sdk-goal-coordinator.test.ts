import { formatGoalVerificationPrompt, MAX_GOAL_VERIFICATION_ROUNDS } from "@cline/core"
import type { AgentResult } from "@cline/shared"
import { parseGoalCommand } from "@shared/slashCommands"
import { describe, expect, it, vi } from "vitest"
import { SdkGoalCoordinator } from "./sdk-goal-coordinator"

const completed = { finishReason: "completed" } as AgentResult
const aborted = { finishReason: "aborted" } as AgentResult

const toolContext = { agentId: "agent", iteration: 0 }

function makeCoordinator(sendResult = true) {
	const sendVerificationTurn = vi.fn((_sessionId: string, _prompt: string) => sendResult)
	const onGoalCompleted = vi.fn()
	const coordinator = new SdkGoalCoordinator({ sendVerificationTurn, onGoalCompleted })
	return { coordinator, sendVerificationTurn, onGoalCompleted }
}

describe("parseGoalCommand", () => {
	it("parses set, status, and clear subcommands", () => {
		expect(parseGoalCommand("/goal fix the tests")).toEqual({ kind: "set", goal: "fix the tests" })
		expect(parseGoalCommand("/goal")).toEqual({ kind: "status" })
		expect(parseGoalCommand("/goal status")).toEqual({ kind: "status" })
		expect(parseGoalCommand("/goal STATUS")).toEqual({ kind: "status" })
		for (const alias of ["off", "clear", "stop", "disable", "OFF"]) {
			expect(parseGoalCommand(`/goal ${alias}`)).toEqual({ kind: "clear" })
		}
	})

	it("keeps multi-line goal text", () => {
		expect(parseGoalCommand("/goal fix the tests\nand the lints")).toEqual({
			kind: "set",
			goal: "fix the tests\nand the lints",
		})
	})

	it("ignores ordinary prompts and mid-text mentions", () => {
		expect(parseGoalCommand("what does /goal do?")).toBeUndefined()
		expect(parseGoalCommand("goal: fix tests")).toBeUndefined()
		expect(parseGoalCommand("/goals are great")).toBeUndefined()
		expect(parseGoalCommand("")).toBeUndefined()
	})
})

describe("SdkGoalCoordinator", () => {
	it("sends a verification turn after a completed run with an active goal", () => {
		const { coordinator, sendVerificationTurn } = makeCoordinator()
		coordinator.setGoal("fix tests")

		coordinator.handleSendStart("user", 1)
		coordinator.handleTurnSettled("session-1", completed, "user", 1)

		expect(sendVerificationTurn).toHaveBeenCalledWith("session-1", formatGoalVerificationPrompt("fix tests"))
		expect(coordinator.formatStatus()).toContain("awaiting verification")
	})

	it("does nothing without an active goal", () => {
		const { coordinator, sendVerificationTurn } = makeCoordinator()

		coordinator.handleTurnSettled("session-1", completed, "user", 1)

		expect(sendVerificationTurn).not.toHaveBeenCalled()
	})

	it("skips verification when the turn did not complete", () => {
		const { coordinator, sendVerificationTurn } = makeCoordinator()
		coordinator.setGoal("fix tests")

		coordinator.handleTurnSettled("session-1", aborted, "user", 1)

		expect(sendVerificationTurn).not.toHaveBeenCalled()
		expect(coordinator.formatStatus()).not.toContain("awaiting verification")
	})

	it("caps automatic verification rounds per user submission but keeps the goal", () => {
		const { coordinator, sendVerificationTurn } = makeCoordinator()
		coordinator.setGoal("fix tests")

		coordinator.handleSendStart("user", 1)
		coordinator.handleTurnSettled("session-1", completed, "user", 1)
		for (let round = 1; round < MAX_GOAL_VERIFICATION_ROUNDS + 2; round += 1) {
			coordinator.handleTurnSettled("session-1", completed, "goal-verification", 1)
		}

		expect(sendVerificationTurn).toHaveBeenCalledTimes(MAX_GOAL_VERIFICATION_ROUNDS)
		// Past the cap the goal stays active with authorization closed, so the
		// next completed run nudges again.
		expect(coordinator.hasActiveGoal()).toBe(true)
		expect(coordinator.formatStatus()).not.toContain("awaiting verification")
	})

	it("resets the round budget on the next user submission", () => {
		const { coordinator, sendVerificationTurn } = makeCoordinator()
		coordinator.setGoal("fix tests")

		coordinator.handleSendStart("user", 1)
		coordinator.handleTurnSettled("session-1", completed, "user", 1)
		for (let round = 1; round < MAX_GOAL_VERIFICATION_ROUNDS; round += 1) {
			coordinator.handleTurnSettled("session-1", completed, "goal-verification", 1)
		}
		expect(sendVerificationTurn).toHaveBeenCalledTimes(MAX_GOAL_VERIFICATION_ROUNDS)

		coordinator.handleSendStart("user", 1)
		coordinator.handleTurnSettled("session-1", completed, "user", 1)

		expect(sendVerificationTurn).toHaveBeenCalledTimes(MAX_GOAL_VERIFICATION_ROUNDS + 1)
	})

	it("does not reset the round budget for system continuations", () => {
		const { coordinator, sendVerificationTurn } = makeCoordinator()
		coordinator.setGoal("fix tests")

		coordinator.handleSendStart("user", 1)
		coordinator.handleTurnSettled("session-1", completed, "user", 1)
		for (let round = 1; round < MAX_GOAL_VERIFICATION_ROUNDS; round += 1) {
			coordinator.handleTurnSettled("session-1", completed, "goal-verification", 1)
		}

		coordinator.handleSendStart("system", 1)
		coordinator.handleTurnSettled("session-1", completed, "system", 1)

		expect(sendVerificationTurn).toHaveBeenCalledTimes(MAX_GOAL_VERIFICATION_ROUNDS)
	})

	it("revokes stale verification authorization when a user submission starts", async () => {
		const { coordinator } = makeCoordinator()
		coordinator.setGoal("fix tests")
		coordinator.handleSendStart("user", 1)
		coordinator.handleTurnSettled("session-1", completed, "user", 1)
		expect(coordinator.formatStatus()).toContain("awaiting verification")

		// e.g. the verification turn was aborted; the next user submission
		// must not inherit its authorization.
		coordinator.handleSendStart("user", 1)

		const result = (await coordinator.markGoalCompleteTool.execute?.({}, toolContext as never)) as Record<string, unknown>
		expect(result).toMatchObject({ completed: false })
		expect(coordinator.hasActiveGoal()).toBe(true)
	})

	it("accepts mark_goal_complete during a verification turn and stops nudging", async () => {
		const { coordinator, sendVerificationTurn, onGoalCompleted } = makeCoordinator()
		coordinator.setGoal("fix tests")
		coordinator.handleSendStart("user", 1)
		coordinator.handleTurnSettled("session-1", completed, "user", 1)

		const result = (await coordinator.markGoalCompleteTool.execute?.({ summary: "done" }, toolContext as never)) as Record<
			string,
			unknown
		>
		expect(result).toMatchObject({ completed: true, goal: "fix tests" })
		expect(coordinator.hasActiveGoal()).toBe(false)

		coordinator.handleTurnSettled("session-1", completed, "goal-verification", 1)
		expect(sendVerificationTurn).toHaveBeenCalledTimes(1)
		expect(coordinator.formatStatus()).toContain("Last completed goal: fix tests — done")
		// The completion is reported exactly once, when the verification turn
		// that carried the tool call settles.
		expect(onGoalCompleted).toHaveBeenCalledTimes(1)
		expect(onGoalCompleted).toHaveBeenCalledWith(expect.objectContaining({ goal: "fix tests", summary: "done" }))
		coordinator.handleTurnSettled("session-1", completed, "user", 1)
		expect(onGoalCompleted).toHaveBeenCalledTimes(1)
	})

	it("closes verification authorization when a turn is abandoned", async () => {
		const { coordinator } = makeCoordinator()
		coordinator.setGoal("fix tests")
		coordinator.handleSendStart("user", 1)
		coordinator.handleTurnSettled("session-1", completed, "user", 1)
		expect(coordinator.formatStatus()).toContain("awaiting verification")

		// The verification send rejected or was aborted before settling.
		coordinator.handleTurnAbandoned(2)

		expect(coordinator.formatStatus()).not.toContain("awaiting verification")
		const result = (await coordinator.markGoalCompleteTool.execute?.({}, toolContext as never)) as Record<string, unknown>
		expect(result).toMatchObject({ completed: false })
		expect(coordinator.hasActiveGoal()).toBe(true)
	})

	it("still reports a completion recorded before the turn was abandoned", async () => {
		const { coordinator, onGoalCompleted } = makeCoordinator()
		coordinator.setGoal("fix tests")
		coordinator.handleSendStart("user", 1)
		coordinator.handleTurnSettled("session-1", completed, "user", 1)
		await coordinator.markGoalCompleteTool.execute?.({ summary: "done" }, toolContext as never)

		// e.g. the user aborted the verification turn right after the tool call.
		coordinator.handleTurnAbandoned(2)

		expect(onGoalCompleted).toHaveBeenCalledTimes(1)
		expect(onGoalCompleted).toHaveBeenCalledWith(expect.objectContaining({ goal: "fix tests", summary: "done" }))
	})

	it("ignores a stale settle from a send that predates a newer user submission", async () => {
		const { coordinator, sendVerificationTurn } = makeCoordinator()
		coordinator.setGoal("fix tests")
		coordinator.handleSendStart("user", 1)
		coordinator.handleTurnSettled("session-1", completed, "user", 1)
		expect(sendVerificationTurn).toHaveBeenCalledTimes(1)

		// While the verification send (id 2) is in flight, the user queues a
		// new ordinary submission (id 3), which revokes authorization...
		coordinator.handleSendStart("goal-verification", 2)
		coordinator.handleSendStart("user", 3)

		// ...then the older verification send settles. It must not reopen the
		// authorization window: the newer ordinary turn would otherwise be
		// able to call mark_goal_complete without a verification prompt.
		coordinator.handleTurnSettled("session-1", completed, "goal-verification", 2)

		expect(sendVerificationTurn).toHaveBeenCalledTimes(1)
		expect(coordinator.formatStatus()).not.toContain("awaiting verification")
		const result = (await coordinator.markGoalCompleteTool.execute?.({}, toolContext as never)) as Record<string, unknown>
		expect(result).toMatchObject({ completed: false })
		expect(coordinator.hasActiveGoal()).toBe(true)
	})

	it("ignores a stale abandonment once a newer verification send is armed", async () => {
		const { coordinator } = makeCoordinator()
		coordinator.setGoal("fix tests")
		// First sequence: verification send (id 2) goes out but is superseded
		// (e.g. by a session rebuild) while in flight.
		coordinator.handleSendStart("user", 1)
		coordinator.handleTurnSettled("session-1", completed, "user", 1)
		coordinator.handleSendStart("goal-verification", 2)

		// Second sequence arms a fresh window and its own verification send.
		coordinator.handleSendStart("user", 3)
		coordinator.handleTurnSettled("session-1", completed, "user", 3)
		coordinator.handleSendStart("goal-verification", 4)
		expect(coordinator.formatStatus()).toContain("awaiting verification")

		// The old send's late abandonment must not revoke the fresh window:
		// the model answering the new verification prompt could no longer
		// complete the goal.
		coordinator.handleTurnAbandoned(2)

		expect(coordinator.formatStatus()).toContain("awaiting verification")
		const result = (await coordinator.markGoalCompleteTool.execute?.({ summary: "done" }, toolContext as never)) as Record<
			string,
			unknown
		>
		expect(result).toMatchObject({ completed: true })
	})

	it("rolls the round back when the verification send is skipped", () => {
		const { coordinator, sendVerificationTurn } = makeCoordinator(false)
		coordinator.setGoal("fix tests")

		coordinator.handleSendStart("user", 1)
		coordinator.handleTurnSettled("session-1", completed, "user", 1)

		expect(sendVerificationTurn).toHaveBeenCalledTimes(1)
		// The skipped send must not consume the budget or leave authorization open.
		expect(coordinator.formatStatus()).not.toContain("awaiting verification")
		coordinator.handleTurnSettled("session-1", completed, "user", 1)
		expect(sendVerificationTurn).toHaveBeenCalledTimes(2)
	})

	it("clears the goal on demand", () => {
		const { coordinator, sendVerificationTurn } = makeCoordinator()
		coordinator.setGoal("fix tests")
		expect(coordinator.clearGoal()).toBe("Goal cleared.")
		expect(coordinator.hasActiveGoal()).toBe(false)

		coordinator.handleTurnSettled("session-1", completed, "user", 1)
		expect(sendVerificationTurn).not.toHaveBeenCalled()
	})
})
