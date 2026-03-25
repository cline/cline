import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@clinebot/rpc", () => ({
	getRpcServerDefaultAddress: () => "ws://127.0.0.1:0",
	getRpcServerHealth: vi.fn(async () => undefined),
}));

describe("resolveSessionBackend", () => {
	afterEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
	});

	it("falls back to file session storage when sqlite initialization fails", async () => {
		vi.doMock("../storage/sqlite-session-store", () => ({
			SqliteSessionStore: class {
				init(): void {
					throw new Error("sqlite unavailable");
				}
			},
		}));

		const { resolveSessionBackend } = await import("./session-host");
		const { FileSessionService } = await import("./file-session-service");

		const backend = await resolveSessionBackend({ backendMode: "local" });
		expect(backend).toBeInstanceOf(FileSessionService);
	});
});
