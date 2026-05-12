import { describe, expect, it } from "vitest";
import {
	applyCliCompactionMode,
	buildCliCompactionConfig,
	DEFAULT_CLI_COMPACTION_MODE,
	formatCliCompactionMode,
	getCliCompactionMode,
	getNextCliCompactionMode,
	parseCliCompactionMode,
} from "./compaction-mode";
import type { Config } from "./types";

function createConfig(compaction?: Config["compaction"]): Config {
	return { compaction } as Config;
}

describe("CLI compaction mode helpers", () => {
	it("defaults enabled compaction to basic truncation", () => {
		expect(DEFAULT_CLI_COMPACTION_MODE).toBe("basic");
		expect(getCliCompactionMode(createConfig())).toBe(
			DEFAULT_CLI_COMPACTION_MODE,
		);
		expect(formatCliCompactionMode(DEFAULT_CLI_COMPACTION_MODE)).toBe(
			"Truncation",
		);
	});

	it("maps basic and off modes to core compaction config", () => {
		const config = createConfig({ enabled: true, maxInputTokens: 123 });

		applyCliCompactionMode(config, "basic");
		expect(config.compaction).toEqual({
			enabled: true,
			strategy: "basic",
			maxInputTokens: 123,
		});
		expect(getCliCompactionMode(config)).toBe("basic");

		applyCliCompactionMode(config, "off");
		expect(config.compaction).toEqual({
			enabled: false,
			maxInputTokens: 123,
		});
		expect(getCliCompactionMode(config)).toBe("off");
	});

	it("builds default and explicit core compaction config", () => {
		expect(buildCliCompactionConfig()).toEqual({
			enabled: true,
			strategy: "basic",
		});
		expect(buildCliCompactionConfig("agentic")).toEqual({
			enabled: true,
			strategy: "agentic",
		});
		expect(buildCliCompactionConfig("off")).toEqual({ enabled: false });
	});

	it("parses one CLI spelling per compaction mode", () => {
		expect(parseCliCompactionMode("agentic")).toBe("agentic");
		expect(parseCliCompactionMode("basic")).toBe("basic");
		expect(parseCliCompactionMode("off")).toBe("off");
		expect(parseCliCompactionMode("llm")).toBeUndefined();
		expect(parseCliCompactionMode("truncation")).toBeUndefined();
		expect(parseCliCompactionMode("truncate")).toBeUndefined();
		expect(parseCliCompactionMode("none")).toBeUndefined();
		expect(parseCliCompactionMode("disabled")).toBeUndefined();
	});

	it("does not mutate compaction when applying an undefined mode", () => {
		const config = createConfig({ enabled: true, strategy: "agentic" });

		applyCliCompactionMode(config, undefined);

		expect(config.compaction).toEqual({
			enabled: true,
			strategy: "agentic",
		});
	});

	it("cycles TUI choices in a stable order", () => {
		expect(getNextCliCompactionMode("basic")).toBe("agentic");
		expect(getNextCliCompactionMode("agentic")).toBe("off");
		expect(getNextCliCompactionMode("off")).toBe("basic");
	});
});
