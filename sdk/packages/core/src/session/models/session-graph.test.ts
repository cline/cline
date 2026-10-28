import { describe, expect, it } from "vitest";
import { parseSubSessionId, parseTeamTaskSubSessionId } from "./session-graph";

describe("parseTeamTaskSubSessionId", () => {
	it.each([
		"aB3xQz",
		"aB3x__",
		"aB3xQ_",
		"1777_x",
	])("parses a task suffix of %s", (suffix) => {
		const sessionId = `root-session__teamtask__java-haiku-agent__${suffix}`;

		expect(parseTeamTaskSubSessionId(sessionId)).toEqual({
			rootSessionId: "root-session",
			agentId: "java-haiku-agent",
			teamTaskId: suffix,
		});
		expect(parseSubSessionId(sessionId)).toBeNull();
	});
});
