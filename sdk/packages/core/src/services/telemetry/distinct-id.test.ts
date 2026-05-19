import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const machineIdSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node-machine-id", () => ({
	machineIdSync: machineIdSyncMock,
}));

describe("resolveCoreDistinctId", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		machineIdSyncMock.mockReset();
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it("returns the explicit distinct ID override when provided", async () => {
		const { resolveCoreDistinctId } = await import("./distinct-id");

		expect(resolveCoreDistinctId("  user-provided-id  ")).toBe(
			"user-provided-id",
		);
		expect(machineIdSyncMock).not.toHaveBeenCalled();
	});

	it("uses node-machine-id when no explicit override is provided", async () => {
		machineIdSyncMock.mockReturnValue("machine-id-123");
		const { resolveCoreDistinctId } = await import("./distinct-id");

		expect(resolveCoreDistinctId()).toBe("machine-id-123");
	});

	it("persists and reuses a generated fallback when machine ID lookup fails", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "cline-distinct-id-"));
		try {
			vi.stubEnv("CLINE_DATA_DIR", tempDir);
			machineIdSyncMock.mockImplementation(() => {
				throw new Error("machine id unavailable");
			});

			const { resolveCoreDistinctId } = await import("./distinct-id");
			const first = resolveCoreDistinctId();
			const second = resolveCoreDistinctId();

			expect(first).toMatch(/^cl-/);
			expect(second).toBe(first);
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
