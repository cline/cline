import { describe, expect, it } from "vitest";
import {
	getToolErrorPresentation,
	isWarningToolError,
	unwrapToolError,
} from "./tool-errors";

describe("tool error presentation", () => {
	it("unwraps JSON-encoded tool errors", () => {
		const raw = JSON.stringify({
			error: "Tool call run_commands was rejected before execution: nope",
		});

		expect(unwrapToolError(raw)).toBe(
			"Tool call run_commands was rejected before execution: nope",
		);
	});

	it("summarizes invalid tool input as a warning", () => {
		const raw = JSON.stringify({
			error:
				'Tool call run_commands was rejected before execution: Invalid input for tool run_commands: Type validation failed: Value: {"commands":[{"command":"cat file"}]}.\nError message: []',
		});

		expect(getToolErrorPresentation(raw)).toMatchObject({
			severity: "warning",
			summary: "Invalid run_commands input; tool call skipped.",
		});
		expect(isWarningToolError(raw)).toBe(true);
	});

	it("summarizes generic pre-execution rejections as warnings", () => {
		expect(
			getToolErrorPresentation(
				"Tool call editor was rejected before execution: approval request failed",
			),
		).toMatchObject({
			severity: "warning",
			summary: "editor call was skipped before execution.",
		});
	});

	it("keeps non-rejection failures as errors", () => {
		const presentation = getToolErrorPresentation("command failed with exit 1");

		expect(presentation).toEqual({
			severity: "error",
			summary: "command failed with exit 1",
			detail: "command failed with exit 1",
		});
	});

	it("summarizes JSON-wrapped hard errors without dumping stacks", () => {
		const raw = JSON.stringify({
			error:
				"Error: command failed with exit 1\n    at runTool (/tmp/tool.ts:10:1)\n    at async main (/tmp/main.ts:5:1)",
		});

		expect(getToolErrorPresentation(raw)).toEqual({
			severity: "error",
			summary: "command failed with exit 1",
			detail:
				"Error: command failed with exit 1\n    at runTool (/tmp/tool.ts:10:1)\n    at async main (/tmp/main.ts:5:1)",
		});
	});

	it("collapses long one-line hard errors", () => {
		const detail = `Validation failed: ${"x".repeat(180)}`;
		const presentation = getToolErrorPresentation(detail);

		expect(presentation.severity).toBe("error");
		expect(presentation.detail).toBe(detail);
		expect(presentation.summary.length).toBeLessThanOrEqual(140);
		expect(presentation.summary.endsWith("...")).toBe(true);
	});

	it("uses a generic summary when no string error can be extracted", () => {
		const presentation = getToolErrorPresentation(
			JSON.stringify({ code: "E_TOOL", data: { value: 1 } }),
		);

		expect(presentation).toEqual({
			severity: "error",
			summary: "Tool returned a structured error.",
			detail: JSON.stringify({ code: "E_TOOL", data: { value: 1 } }),
		});
	});
});
