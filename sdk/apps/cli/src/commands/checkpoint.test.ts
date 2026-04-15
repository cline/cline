import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionMocks = vi.hoisted(() => ({
	getSessionRow: vi.fn(),
	getLatestSessionRow: vi.fn(),
}));

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("../session/session", () => sessionMocks);
vi.mock("node:child_process", () => ({
	execFile: execFileMock,
}));

describe("checkpoint commands", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		process.stdout.write = originalStdoutWrite;
	});

	const io = {
		writeln: vi.fn(),
		writeErr: vi.fn(),
	};

	const session = {
		sessionId: "sess_1",
		cwd: "/tmp/repo",
		metadata: {
			checkpoint: {
				latest: {
					ref: "abc123",
					createdAt: 1_700_000_000_000,
					runCount: 2,
				},
				history: [
					{
						ref: "def456",
						createdAt: 1_699_000_000_000,
						runCount: 1,
					},
					{
						ref: "abc123",
						createdAt: 1_700_000_000_000,
						runCount: 2,
					},
				],
			},
		},
	};

	const originalStdoutWrite = process.stdout.write.bind(process.stdout);

	it("prints checkpoint status in text mode", async () => {
		sessionMocks.getSessionRow.mockResolvedValue(session);
		const { runCheckpointStatus } = await import("./checkpoint");

		const code = await runCheckpointStatus({
			sessionId: "sess_1",
			outputMode: "text",
			io,
		});

		expect(code).toBe(0);
		expect(io.writeln).toHaveBeenCalledWith("Session: sess_1");
		expect(io.writeln).toHaveBeenCalledWith("Latest checkpoint: abc123");
	});

	it("prints checkpoint list in json mode", async () => {
		sessionMocks.getSessionRow.mockResolvedValue(session);
		let captured = "";
		process.stdout.write = vi.fn((chunk: string | Uint8Array) => {
			captured += String(chunk);
			return true;
		}) as typeof process.stdout.write;
		const { runCheckpointList } = await import("./checkpoint");

		const code = await runCheckpointList({
			sessionId: "sess_1",
			outputMode: "json",
			io,
		});

		expect(code).toBe(0);
		expect(JSON.parse(captured)).toMatchObject({
			sessionId: "sess_1",
			checkpoints: [
				{ index: 1, ref: "abc123", runCount: 2 },
				{ index: 2, ref: "def456", runCount: 1 },
			],
		});
	});

	it("restores the selected checkpoint", async () => {
		sessionMocks.getSessionRow.mockResolvedValue(session);
		execFileMock.mockImplementation(
			(
				_file: string,
				args: string[],
				_options: unknown,
				callback: (
					error: Error | null,
					result: { stdout: string; stderr: string },
				) => void,
			) => {
				if (args.includes("rev-parse")) {
					callback(null, { stdout: "true\n", stderr: "" });
					return;
				}
				callback(null, { stdout: "", stderr: "" });
			},
		);
		const { runCheckpointRestore } = await import("./checkpoint");

		const code = await runCheckpointRestore({
			sessionId: "sess_1",
			selector: "2",
			yes: true,
			outputMode: "text",
			io,
		});

		expect(code).toBe(0);
		expect(execFileMock).toHaveBeenCalledWith(
			"git",
			["-C", "/tmp/repo", "stash", "apply", "def456"],
			{ windowsHide: true },
			expect.any(Function),
		);
		expect(io.writeln).toHaveBeenCalledWith("Restored checkpoint def456");
	});

	it("returns gracefully when checkpoint metadata is missing in text mode", async () => {
		sessionMocks.getLatestSessionRow.mockResolvedValue({
			sessionId: "sess_2",
			cwd: "/tmp/repo",
			metadata: {},
		});
		const { runCheckpointStatus } = await import("./checkpoint");

		const code = await runCheckpointStatus({
			outputMode: "text",
			io,
		});

		expect(code).toBe(0);
		expect(io.writeln).toHaveBeenCalledWith(
			"No checkpoint metadata found for session sess_2",
		);
	});

	it("still returns an error when checkpoint metadata is missing in json mode", async () => {
		sessionMocks.getLatestSessionRow.mockResolvedValue({
			sessionId: "sess_2",
			cwd: "/tmp/repo",
			metadata: {},
		});
		const { runCheckpointStatus } = await import("./checkpoint");

		const code = await runCheckpointStatus({
			outputMode: "json",
			io,
		});

		expect(code).toBe(1);
		expect(io.writeErr).toHaveBeenCalledWith(
			"No checkpoint metadata found for session sess_2",
		);
	});
});
