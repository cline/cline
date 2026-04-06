import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@clinebot/core", async () => {
	const actual =
		await vi.importActual<typeof import("@clinebot/core")>("@clinebot/core");
	return {
		...actual,
		createPersistentSubprocessHooks: vi.fn(() => ({
			hooks: {},
			client: { close: vi.fn() },
		})),
	};
});

import { createRuntimeHooks } from "./hooks";

describe("createRuntimeHooks", () => {
	const originalArgv = process.argv.slice();
	const originalEnv = { ...process.env };

	afterEach(() => {
		process.argv = originalArgv.slice();
		process.env = { ...originalEnv };
		vi.restoreAllMocks();
	});

	it("disables runtime hooks in yolo mode", async () => {
		process.argv = [process.argv[0] || "node", "/tmp/clite.js"];

		const runtimeHooks = createRuntimeHooks({ yolo: true });

		expect(runtimeHooks.hooks).toBeUndefined();
		await expect(runtimeHooks.shutdown()).resolves.toBeUndefined();
	});

	it("returns hooks when the CLI entrypoint is available", async () => {
		process.argv = [process.argv[0] || "node", "/tmp/clite.js"];

		const runtimeHooks = createRuntimeHooks({ yolo: false });

		expect(runtimeHooks.hooks).toBeDefined();
		await expect(runtimeHooks.shutdown()).resolves.toBeUndefined();
	});

	it("disables runtime hooks for internal hook-worker processes", async () => {
		process.argv = [process.argv[0] || "node", "/tmp/clite.js"];
		process.env.CLINE_INTERNAL_ROLE = "hook-worker";

		const runtimeHooks = createRuntimeHooks({ yolo: false });

		expect(runtimeHooks.hooks).toBeUndefined();
		await expect(runtimeHooks.shutdown()).resolves.toBeUndefined();
	});
});
