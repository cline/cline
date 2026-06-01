import { describe, it } from "mocha"
import "should"
import { checkSemanticLoop, SEMANTIC_LOOP_SOFT_THRESHOLD } from "../loop-detection"
import { TaskState } from "../TaskState"

const search = (state: TaskState) => checkSemanticLoop(state, "search_files", { regex: "anything" })
const read = (state: TaskState, path: string) => checkSemanticLoop(state, "read_file", { path })

describe("loop-detection — checkSemanticLoop (search_files)", () => {
	it("trips the soft warning once zero-result searches reach the threshold", () => {
		const state = new TaskState()
		// Simulate the handler bumping the counter on each empty search of the same target.
		state.consecutiveZeroResultSearches = SEMANTIC_LOOP_SOFT_THRESHOLD
		search(state).softWarning.should.be.true()
	})

	it("does not warn below the threshold", () => {
		const state = new TaskState()
		state.consecutiveZeroResultSearches = SEMANTIC_LOOP_SOFT_THRESHOLD - 1
		search(state).softWarning.should.be.false()
	})

	it("escalates at the hard threshold", () => {
		const state = new TaskState()
		state.consecutiveZeroResultSearches = 5
		search(state).hardEscalation.should.be.true()
	})
})

describe("loop-detection — checkSemanticLoop (read_file)", () => {
	it("warns when the same path is read repeatedly within the window", () => {
		const state = new TaskState()
		let result = read(state, "src/foo.ts")
		result.softWarning.should.be.false()
		result = read(state, "src/foo.ts")
		result.softWarning.should.be.false()
		result = read(state, "src/foo.ts")
		result.softWarning.should.be.true()
	})

	it("does not warn when reading different paths", () => {
		const state = new TaskState()
		read(state, "a.ts").softWarning.should.be.false()
		read(state, "b.ts").softWarning.should.be.false()
		read(state, "c.ts").softWarning.should.be.false()
	})

	it("ignores reads with no path", () => {
		const state = new TaskState()
		checkSemanticLoop(state, "read_file", {}).softWarning.should.be.false()
	})
})

describe("loop-detection — checkSemanticLoop (other tools)", () => {
	it("never trips for unrelated tools", () => {
		const state = new TaskState()
		const result = checkSemanticLoop(state, "write_to_file", { path: "x.ts", content: "..." })
		result.softWarning.should.be.false()
		result.hardEscalation.should.be.false()
	})
})
