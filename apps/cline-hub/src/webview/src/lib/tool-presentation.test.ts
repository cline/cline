import { describe, expect, it } from "vitest";
import { buildToolPresentations, type ToolEvent } from "./tool-presentation";

function toolEvent(
	overrides: Partial<ToolEvent> & { name: string },
): ToolEvent {
	return {
		id: "call-1",
		text: "",
		state: "output-available",
		...overrides,
	};
}

const WINDOWS_COMMAND = `cd 'c:\\Users\\kazuki\\Share\\play\\cline'`;

describe("buildToolPresentations", () => {
	it("keeps a Windows drive path intact in the label and details", () => {
		const [presentation] = buildToolPresentations(
			toolEvent({
				name: "run_commands",
				input: { commands: [WINDOWS_COMMAND] },
				output: "ok",
			}),
		);

		expect(presentation?.summary.label).toContain(WINDOWS_COMMAND);
		expect(presentation?.summary.details).toEqual([WINDOWS_COMMAND]);
	});

	it("labels a completed command with the shared summary wording", () => {
		const [presentation] = buildToolPresentations(
			toolEvent({
				name: "run_commands",
				input: { commands: ["bun test"] },
				output: "12 tests passed",
			}),
		);

		expect(presentation?.summary.kind).toBe("command");
		expect(presentation?.summary.label).toBe("Ran command bun test");
	});

	it("labels an in-progress command as running", () => {
		const [presentation] = buildToolPresentations(
			toolEvent({
				name: "run_commands",
				state: "input-available",
				input: { commands: ["bun test"] },
			}),
		);

		expect(presentation?.summary.label).toBe("Running command bun test");
	});

	it("renders one card per command result and marks failures", () => {
		const presentations = buildToolPresentations(
			toolEvent({
				name: "run_commands",
				input: { commands: [WINDOWS_COMMAND, "false"] },
				output: [
					{ query: WINDOWS_COMMAND, result: "ok", success: true },
					{ query: "false", result: "exit 1", success: false },
				],
			}),
		);

		expect(presentations.map((p) => p.id)).toEqual(["call-1-0", "call-1-1"]);
		expect(presentations[0]?.state).toBe("output-available");
		expect(presentations[0]?.summary.label).toContain(WINDOWS_COMMAND);
		expect(presentations[1]?.state).toBe("output-error");
		expect(presentations[1]?.error).toBe("exit 1");
	});

	it("summarizes file reads with the path in details", () => {
		const [presentation] = buildToolPresentations(
			toolEvent({
				name: "read_files",
				input: { files: [{ path: "src/index.ts" }] },
				output: "120 lines",
			}),
		);

		expect(presentation?.summary.kind).toBe("read");
		expect(presentation?.summary.details).toEqual(["src/index.ts"]);
	});

	it("passes the raw output through to the output panel", () => {
		const [presentation] = buildToolPresentations(
			toolEvent({
				name: "run_commands",
				input: { commands: ["ls"] },
				output: "file-a\nfile-b",
			}),
		);

		expect(presentation?.output).toBe("file-a\nfile-b");
	});

	it("prefers the event error over the raw output", () => {
		const [presentation] = buildToolPresentations(
			toolEvent({
				name: "run_commands",
				state: "output-error",
				input: { commands: ["false"] },
				output: { exitCode: 1 },
				error: "Command failed with exit code 1",
			}),
		);

		expect(presentation?.output).toBe("Command failed with exit code 1");
		expect(presentation?.error).toBe("Command failed with exit code 1");
	});

	it("degrades to a generic label for unparsable payloads", () => {
		const [presentation] = buildToolPresentations(
			toolEvent({ name: "read_files", input: 42, output: "done" }),
		);

		expect(presentation?.summary.label).toBe("Read file");
		expect(presentation?.summary.details).toEqual([]);
	});
});
