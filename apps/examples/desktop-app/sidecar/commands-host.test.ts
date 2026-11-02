import { afterEach, describe, expect, it, vi } from "vitest";
import { handleCommand } from "./commands";
import { createSidecarContext } from "./context";
const { spawn } = vi.hoisted(() => ({
	spawn: vi.fn(() => ({ once: vi.fn(), unref: vi.fn() })),
}));
vi.mock("node:child_process", async (original) => ({
	...(await original<typeof import("node:child_process")>()),
	spawn,
}));
afterEach(() => vi.clearAllMocks());
describe("browser development host actions", () => {
	it("opens an absolute settings path with the platform opener without a shell", async () => {
		const path =
			process.platform === "win32"
				? "C:\\settings\\mcp.json"
				: "/tmp/MCP settings.json";
		expect(
			await handleCommand(
				createSidecarContext("/workspace"),
				"open_local_path",
				{ path },
			),
		).toEqual({ opened: true });
		expect(spawn).toHaveBeenCalledWith(
			process.platform === "darwin"
				? "open"
				: process.platform === "win32"
					? "explorer.exe"
					: "xdg-open",
			[path],
			expect.objectContaining({ stdio: "ignore" }),
		);
	});
	it("rejects missing or relative settings paths", async () => {
		for (const path of [undefined, "relative.json"]) {
			await expect(
				handleCommand(createSidecarContext("/workspace"), "open_local_path", {
					path,
				}),
			).rejects.toThrow("absolute");
		}
		expect(spawn).not.toHaveBeenCalled();
	});
});
