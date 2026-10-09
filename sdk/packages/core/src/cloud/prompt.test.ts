import { describe, expect, it } from "vitest";
import {
	buildCloudSessionSystemPrompt,
	CLOUD_SESSION_SYSTEM_PROMPT,
	cloudSessionWorkBranch,
} from "./prompt";

describe("cloud session system prompt", () => {
	const record = {
		id: "ses-outer-id",
		metadata: { taskId: "tsk-1234ABCD" },
	};

	it("names the work branch after the task id", () => {
		expect(cloudSessionWorkBranch(record)).toBe("cline/1234abcd");
		expect(cloudSessionWorkBranch({ id: "ses-0000FFFF", metadata: {} })).toBe(
			"cline/0000ffff",
		);
	});

	it("asks a resumable sandbox to push only on request", () => {
		const prompt = buildCloudSessionSystemPrompt({
			...record,
			sandboxType: "resumable",
		});
		expect(prompt.startsWith(CLOUD_SESSION_SYSTEM_PROMPT)).toBe(true);
		expect(prompt).toContain("`cline/1234abcd`");
		expect(prompt).toContain("Commit and push only when the user asks.");
		expect(prompt).not.toContain("SAVE YOUR WORK");
	});

	it("has a temporary sandbox push its work as it goes", () => {
		const prompt = buildCloudSessionSystemPrompt(record);
		expect(prompt).toContain("SAVE YOUR WORK");
		expect(prompt).toContain("git push -u origin cline/1234abcd");
	});
});
