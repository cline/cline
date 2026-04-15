import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const clientCloseMock = vi.hoisted(() => vi.fn());

vi.mock("@clinebot/rpc", () => ({
	RpcSessionClient: class {
		close = clientCloseMock;
		streamEvents = vi.fn(() => () => {});
		abortRuntimeSession = vi.fn();
		stopRuntimeSession = vi.fn();
		getSession = vi.fn();
	},
}));

describe("RpcSessionHost", () => {
	it("does not close the shared backend on dispose", async () => {
		const { RpcSessionHost } = await import("./rpc-session-host");
		const backend = {
			address: "127.0.0.1:4317",
			close: vi.fn(),
		} as unknown as import("./rpc-session-service").RpcCoreSessionService;

		const host = new RpcSessionHost(backend, undefined, undefined);
		await host.dispose();

		expect(clientCloseMock).toHaveBeenCalledTimes(1);
		expect(backend.close).not.toHaveBeenCalled();
	});

	it("returns an empty transcript when maxChars is zero", async () => {
		const { RpcSessionHost } = await import("./rpc-session-host");
		const dir = await mkdtemp(join(tmpdir(), "rpc-session-host-test-"));
		const transcriptPath = join(dir, "transcript.txt");
		await writeFile(transcriptPath, "hello world", "utf8");
		const backend = {
			address: "127.0.0.1:4317",
			close: vi.fn(),
		} as unknown as import("./rpc-session-service").RpcCoreSessionService;

		const host = new RpcSessionHost(backend, undefined, undefined);
		const client = (
			host as unknown as {
				client: { getSession: ReturnType<typeof vi.fn> };
			}
		).client;
		client.getSession.mockResolvedValue({
			transcriptPath,
		});

		await expect(host.readTranscript("session-1", 0)).resolves.toBe("");

		await rm(dir, { recursive: true, force: true });
	});
});
