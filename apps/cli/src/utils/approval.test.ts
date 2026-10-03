import { afterEach, describe, expect, it, vi } from "vitest";
import { askQuestionInTerminal, NO_OPERATOR_ANSWER } from "./approval";

function setTty(
	stream: NodeJS.ReadStream | NodeJS.WriteStream,
	value: boolean,
) {
	Object.defineProperty(stream, "isTTY", { value, configurable: true });
}

describe("askQuestionInTerminal", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		setTty(process.stdin, false);
		setTty(process.stdout, false);
	});

	it("does not auto-pick the first option when there is no terminal", async () => {
		setTty(process.stdin, false);
		setTty(process.stdout, false);
		const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

		const answer = await askQuestionInTerminal("pm?", ["npm", "pnpm"]);

		expect(answer).toBe(NO_OPERATOR_ANSWER);
		expect(answer).not.toBe("npm");
		expect(stderr).toHaveBeenCalledWith(
			expect.stringContaining("not answered"),
		);
	});
});
