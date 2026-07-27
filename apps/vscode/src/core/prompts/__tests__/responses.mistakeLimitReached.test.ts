import { describe, it } from "bun:test";
import "should";
import { formatResponse } from "../responses";

describe("formatResponse.mistakeLimitReached", () => {
	it("explains missing tool invocations when the streak is narration-only", () => {
		const message = formatResponse.mistakeLimitReached({
			consecutiveMistakes: 3,
			fromNoToolTurns: true,
		});
		message.should.containEql("without calling a tool 3 times");
		message.should.containEql("attempt_completion");
		message.should.not.containEql("tool call failures");
	});

	it("keeps the tool-failure copy for real tool error streaks", () => {
		const message = formatResponse.mistakeLimitReached({
			consecutiveMistakes: 3,
			fromNoToolTurns: false,
		});
		message.should.equal(
			"Cline hit repeated tool call failures. Try guiding it with a new prompt.",
		);
	});
});
