import { describe, expect, it } from "vitest";
import {
	appendEnvironmentDetails,
	buildEnvironmentDetails,
} from "./environment-details";

describe("environment details", () => {
	it("builds a classic environment_details block", () => {
		const details = buildEnvironmentDetails({
			cwd: "/tmp/project",
			mode: "plan",
			workspaceMetadata: '{"root":"/tmp/project"}',
			now: new Date("2026-07-03T12:00:00.000Z"),
		});

		expect(details).toContain("<environment_details>");
		expect(details).toContain("# Current Working Directory\n/tmp/project");
		expect(details).toContain(
			'# Workspace Configuration\n{"root":"/tmp/project"}',
		);
		expect(details).toContain("# Current Time\n");
		expect(details).toContain("# Current Mode\nPLAN MODE");
		expect(details).toContain("</environment_details>");
	});

	it("does not append a duplicate environment_details block", () => {
		const prompt =
			'<user_input mode="act">hello</user_input>\n\n<environment_details>\nexisting\n</environment_details>';

		expect(
			appendEnvironmentDetails(prompt, {
				cwd: "/tmp/project",
				mode: "act",
			}),
		).toBe(prompt);
	});
});
