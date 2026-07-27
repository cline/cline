import { afterEach, describe, expect, it, vi } from "vitest";

describe("runAcpMode", () => {
	afterEach(() => {
		vi.doUnmock("@agentclientprotocol/sdk");
		vi.doUnmock("./acpAgent");
		vi.restoreAllMocks();
	});

	it("writes the startup diagnostic without labeling it as an error", async () => {
		const stderrWrite = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);

		vi.doMock("@agentclientprotocol/sdk", () => ({
			ndJsonStream: vi.fn(() => ({})),
			AgentSideConnection: class {
				closed = Promise.resolve();
			},
		}));
		vi.doMock("./acpAgent", () => ({
			AcpAgent: class {},
		}));

		const { runAcpMode } = await import("./index");

		await runAcpMode();

		expect(stderrWrite).toHaveBeenCalledWith(
			"[acp] starting ACP mode over stdio…\n",
		);
		expect(stderrWrite).not.toHaveBeenCalledWith(
			expect.stringContaining("error:"),
		);
	});
});
