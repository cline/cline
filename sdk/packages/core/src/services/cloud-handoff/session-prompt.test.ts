import { describe, expect, it } from "vitest";
import {
	buildCloudHandoffNotice,
	buildCloudHandoffSystemPrompt,
	CLOUD_GITHUB_AUTH_SYSTEM_PROMPT,
	CLOUD_HANDOFF_WORKSPACE_ROOT,
} from "./session-prompt";

describe("cloud handoff session prompt", () => {
	it("describes the fresh cloud clone and stale local environment", () => {
		const notice = buildCloudHandoffNotice({
			repoUrl: "https://github.com/cline/cline",
			branch: "main",
		});
		expect(notice).toContain(
			`https://github.com/cline/cline@main at ${CLOUD_HANDOFF_WORKSPACE_ROOT}`,
		);
		expect(notice).toContain("absolute paths");
	});

	it("combines the shared GitHub authentication contract with the notice", () => {
		const prompt = buildCloudHandoffSystemPrompt({
			repoUrl: "https://github.com/cline/cline",
			branch: "feature/handoff",
		});
		expect(prompt).toContain(CLOUD_GITHUB_AUTH_SYSTEM_PROMPT);
		expect(prompt).toContain("feature/handoff");
	});
});
