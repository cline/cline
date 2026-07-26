import { describe, expect, it } from "vitest";
import { workRecordFromToolEvent } from "./work-from-tool";

describe("workRecordFromToolEvent", () => {
	it("maps write_to_file to edit", () => {
		const work = workRecordFromToolEvent({
			toolName: "write_to_file",
			status: "completed",
			input: { path: "src/a.ts", new_text: "export const a = 1" },
		});
		expect(work).toEqual({
			kind: "edit",
			path: "src/a.ts",
			summary: "export const a = 1",
		});
	});

	it("maps bash to command and test runners to test_result", () => {
		expect(
			workRecordFromToolEvent({
				toolName: "bash",
				status: "completed",
				input: { command: "ls -la" },
				output: "ok",
			}),
		).toMatchObject({ kind: "command", command: "ls -la", failed: false });

		expect(
			workRecordFromToolEvent({
				toolName: "run_commands",
				status: "failed",
				input: { command: "bun test" },
				error: "1 failed",
			}),
		).toMatchObject({
			kind: "test_result",
			label: "bun test",
			passed: false,
		});
	});

	it("returns null for non-stage tools", () => {
		expect(
			workRecordFromToolEvent({
				toolName: "web_search",
				status: "completed",
				output: "{}",
			}),
		).toBeNull();
	});
});
