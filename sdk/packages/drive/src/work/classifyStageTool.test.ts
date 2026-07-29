import { describe, expect, it } from "vitest";
import {
	classifyStageToolName,
	looksLikeTestCommand,
} from "./classifyStageTool.js";

describe("classifyStageToolName", () => {
	it("maps edit tools", () => {
		expect(classifyStageToolName("write_to_file")).toBe("edit");
		expect(classifyStageToolName("apply_patch")).toBe("edit");
	});

	it("maps bash to command unless command looks like a test", () => {
		expect(classifyStageToolName("bash", "ls -la")).toBe("command");
		expect(classifyStageToolName("bash", "bun test")).toBe("test");
		expect(looksLikeTestCommand("vitest run")).toBe(true);
	});

	it("returns null for unknown tools", () => {
		expect(classifyStageToolName("read_file")).toBeNull();
	});
});
