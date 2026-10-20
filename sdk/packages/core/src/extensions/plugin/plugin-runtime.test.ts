import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({ existsSync: vi.fn() }));

beforeEach(() => {
	vi.resetModules();
	vi.mocked(existsSync).mockReset().mockReturnValue(false);
	vi.stubEnv("CLINE_PLUGIN_RUNTIME_DIR", "");
});
afterEach(() => {
	vi.unstubAllEnvs();
});

describe("plugin runtime discovery", () => {
	it("caches the package walk, including an absent runtime", async () => {
		const { resolvePluginRuntimeDirectory } = await import("./plugin-runtime");
		expect(resolvePluginRuntimeDirectory()).toBeUndefined();
		const probes = vi.mocked(existsSync).mock.calls.length;
		expect(probes).toBeGreaterThan(0);
		expect(resolvePluginRuntimeDirectory()).toBeUndefined();
		expect(existsSync).toHaveBeenCalledTimes(probes);
	});

	it("validates and resolves explicit configuration even after a cached discovery miss", async () => {
		const { resolvePluginRuntimeDirectory } = await import("./plugin-runtime");
		resolvePluginRuntimeDirectory();
		vi.stubEnv("CLINE_PLUGIN_RUNTIME_DIR", "./configured-runtime");
		vi.mocked(existsSync).mockReturnValue(true);
		expect(resolvePluginRuntimeDirectory()).toBe(
			resolve("./configured-runtime"),
		);
		vi.mocked(existsSync).mockReturnValue(false);
		expect(resolvePluginRuntimeDirectory).toThrow(
			"does not contain a complete plugin runtime",
		);
	});
});
