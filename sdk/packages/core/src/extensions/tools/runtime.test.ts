import { describe, expect, it } from "vitest";
import {
	getCoreBuiltinToolCatalog,
	getCoreDefaultEnabledToolIds,
	getCoreHeadlessToolNames,
	resolveCoreSelectedToolIds,
} from "./runtime";

describe("builtin tool catalog", () => {
	it("includes spawn and teams entries", () => {
		const catalog = getCoreBuiltinToolCatalog({ mode: "act" });
		expect(catalog.some((entry) => entry.id === "spawn_agent")).toBe(true);
		expect(catalog.some((entry) => entry.id === "teams")).toBe(true);
	});

	it("marks teams enabled by default in act mode", () => {
		const catalog = getCoreBuiltinToolCatalog({ mode: "act" });
		expect(catalog.find((entry) => entry.id === "teams")?.defaultEnabled).toBe(
			true,
		);
		expect(
			catalog.find((entry) => entry.id === "spawn_agent")?.defaultEnabled,
		).toBe(true);
	});

	it("marks teams and spawn disabled by default in plan mode", () => {
		const catalog = getCoreBuiltinToolCatalog({ mode: "plan" });
		expect(catalog.find((entry) => entry.id === "teams")?.defaultEnabled).toBe(
			false,
		);
		expect(
			catalog.find((entry) => entry.id === "spawn_agent")?.defaultEnabled,
		).toBe(false);
	});

	it("expands grouped headless tool names for selected entries", () => {
		const names = getCoreHeadlessToolNames(new Set(["teams", "read_files"]), {
			mode: "act",
		});
		expect(names).toContain("read_files");
		expect(names).toContain("team_status");
		expect(names).toContain("team_run_task");
	});

	it("uses a single editor catalog entry for Bedrock models", () => {
		const actCatalog = getCoreBuiltinToolCatalog({ mode: "act" });
		expect(actCatalog.some((entry) => entry.id === "apply_patch")).toBe(false);
		expect(
			actCatalog.find((entry) => entry.id === "editor")?.headlessToolNames,
		).toEqual(["editor"]);

		const bedrockCatalog = getCoreBuiltinToolCatalog({
			mode: "act",
			modelId: "anthropic.claude-sonnet-4-6",
			providerId: "bedrock",
		});
		expect(
			bedrockCatalog.find((entry) => entry.id === "editor")?.headlessToolNames,
		).toEqual(["editor"]);
		expect(bedrockCatalog.some((entry) => entry.id === "submit_and_exit")).toBe(
			false,
		);
	});

	it("resolves default selected ids from the catalog", () => {
		const selected = resolveCoreSelectedToolIds({
			enabled: true,
			availabilityContext: { mode: "act" },
		});
		expect(selected.has("teams")).toBe(true);
		expect(selected.has("spawn_agent")).toBe(true);
		expect(getCoreDefaultEnabledToolIds({ mode: "act" })).toContain("teams");
	});
});
