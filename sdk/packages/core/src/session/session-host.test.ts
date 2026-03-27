import { afterEach, describe, expect, it, vi } from "vitest";
import { FileSessionService } from "./file-session-service";
import { resolveSessionBackend } from "./session-host";

const sqliteInitMock = vi.hoisted(() => vi.fn());

vi.mock("@clinebot/rpc", () => ({
	getRpcServerDefaultAddress: () => "ws://127.0.0.1:0",
	getRpcServerHealth: vi.fn(async () => undefined),
}));

vi.mock("../storage/sqlite-session-store", () => ({
	SqliteSessionStore: class {
		init(): void {
			sqliteInitMock();
		}
	},
}));

describe("resolveSessionBackend", () => {
	afterEach(() => {
		sqliteInitMock.mockReset();
		vi.restoreAllMocks();
	});

	it("falls back to file session storage when sqlite initialization fails", async () => {
		sqliteInitMock.mockImplementation(() => {
			throw new Error("sqlite unavailable");
		});

		const backend = await resolveSessionBackend({ backendMode: "local" });
		expect(backend).toBeInstanceOf(FileSessionService);
	});
});
