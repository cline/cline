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

	it("marks teams and spawn disabled by default in yolo mode", () => {
		const catalog = getCoreBuiltinToolCatalog({ mode: "yolo" });
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

	it("uses a single editor catalog entry and maps to apply_patch when routed", () => {
		const actCatalog = getCoreBuiltinToolCatalog({ mode: "act" });
		expect(actCatalog.some((entry) => entry.id === "apply_patch")).toBe(false);
		expect(
			actCatalog.find((entry) => entry.id === "editor")?.headlessToolNames,
		).toEqual(["editor"]);

		const gptCatalog = getCoreBuiltinToolCatalog({
			mode: "act",
			modelId: "openai/gpt-5.4",
			providerId: "openai",
		});
		expect(
			gptCatalog.find((entry) => entry.id === "editor")?.headlessToolNames,
		).toEqual(["apply_patch"]);
		expect(gptCatalog.some((entry) => entry.id === "submit_and_exit")).toBe(
			false,
		);
	});

	it("keeps web_search disabled by default", () => {
		const catalog = getCoreBuiltinToolCatalog({ mode: "act" });
		const entry = catalog.find((item) => item.id === "web_search");
		expect(entry).toBeDefined();
		expect(entry?.defaultEnabled).toBe(false);
		expect(getCoreDefaultEnabledToolIds({ mode: "act" })).not.toContain(
			"web_search",
		);
	});

	it("enables web_search only via the enabledToolIds opt-in", () => {
		const optedIn = getCoreBuiltinToolCatalog({
			mode: "act",
			enabledToolIds: new Set(["web_search"]),
		});
		expect(
			optedIn.find((item) => item.id === "web_search")?.defaultEnabled,
		).toBe(true);

		const optedInButDisabled = getCoreBuiltinToolCatalog({
			mode: "act",
			enabledToolIds: new Set(["web_search"]),
			disabledToolIds: new Set(["web_search"]),
		});
		expect(
			optedInButDisabled.find((item) => item.id === "web_search")
				?.defaultEnabled,
		).toBe(false);
	});

	it("does not enable other tools through enabledToolIds", () => {
		const catalog = getCoreBuiltinToolCatalog({
			mode: "yolo",
			enabledToolIds: new Set(["teams", "search_codebase"]),
		});
		expect(catalog.find((item) => item.id === "teams")?.defaultEnabled).toBe(
			false,
		);
		expect(
			catalog.find((item) => item.id === "search_codebase")?.defaultEnabled,
		).toBe(false);
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
