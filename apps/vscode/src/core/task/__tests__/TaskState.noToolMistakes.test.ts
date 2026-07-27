import { describe, it } from "bun:test";
import "should";
import { TaskState } from "../TaskState";

describe("TaskState no-tool mistake tracking", () => {
	it("treats a pure narration-only streak as fromNoTools", () => {
		const state = new TaskState();
		state.recordNoToolMistake();
		state.recordNoToolMistake();
		state.recordNoToolMistake();

		state.consecutiveMistakeCount.should.equal(3);
		state.consecutiveNoToolMistakeCount.should.equal(3);
		state.isConsecutiveMistakeStreakFromNoTools.should.be.true();
	});

	it("clears the no-tool streak when a tool mistake increments the counter", () => {
		const state = new TaskState();
		state.recordNoToolMistake();
		state.recordNoToolMistake();
		state.consecutiveMistakeCount++; // tool-handler style increment

		state.consecutiveMistakeCount.should.equal(3);
		state.consecutiveNoToolMistakeCount.should.equal(0);
		state.isConsecutiveMistakeStreakFromNoTools.should.be.false();
	});

	it("resets both counters when consecutiveMistakeCount is set to 0", () => {
		const state = new TaskState();
		state.recordNoToolMistake();
		state.recordNoToolMistake();
		state.consecutiveMistakeCount = 0;

		state.consecutiveMistakeCount.should.equal(0);
		state.consecutiveNoToolMistakeCount.should.equal(0);
		state.isConsecutiveMistakeStreakFromNoTools.should.be.false();
	});

	it("clears the no-tool streak when loop detection forces the counter to max", () => {
		const state = new TaskState();
		state.recordNoToolMistake();
		state.consecutiveMistakeCount = 3;

		state.consecutiveMistakeCount.should.equal(3);
		state.consecutiveNoToolMistakeCount.should.equal(0);
		state.isConsecutiveMistakeStreakFromNoTools.should.be.false();
	});
});
