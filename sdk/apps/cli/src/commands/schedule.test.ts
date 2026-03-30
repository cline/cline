import { afterEach, describe, expect, it, vi } from "vitest";
import { createScheduleCommand } from "./schedule";

const mockListSchedules = vi.hoisted(() => vi.fn());
const mockClientClose = vi.hoisted(() => vi.fn());
const mockGetRpcServerHealth = vi.hoisted(() => vi.fn());

vi.mock("@clinebot/rpc", () => ({
	RPC_BUILD_VERSION: "rpc-build-test",
	getRpcServerHealth: mockGetRpcServerHealth,
	RpcSessionClient: class {
		async listSchedules(input: unknown) {
			return mockListSchedules(input);
		}

		close() {
			mockClientClose();
		}
	},
}));

vi.mock("./rpc", () => ({
	runRpcEnsureCommand: vi.fn(async () => 0),
}));

async function runScheduleCommand(
	args: string[],
	io: { writeln: (text?: string) => void; writeErr: (text: string) => void },
): Promise<number> {
	let exitCode = 0;
	const cmd = createScheduleCommand(io, (code) => {
		exitCode = code;
	});
	await cmd.parseAsync(args, { from: "user" });
	return exitCode;
}

describe("runScheduleCommand list output", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('prints "No schedules found." for empty non-json list output', async () => {
		mockGetRpcServerHealth.mockResolvedValue({ running: true });
		mockListSchedules.mockResolvedValue([]);

		const output: string[] = [];
		const errors: string[] = [];
		const code = await runScheduleCommand(["list"], {
			writeln: (text?: string) => {
				output.push(text ?? "");
			},
			writeErr: (text: string) => {
				errors.push(text);
			},
		});

		expect(code).toBe(0);
		expect(errors).toEqual([]);
		expect(output).toEqual(["No schedules found."]);
		expect(mockListSchedules).toHaveBeenCalledWith({
			limit: 100,
			enabled: undefined,
			tags: undefined,
		});
		expect(mockClientClose).toHaveBeenCalledTimes(1);
	});

	it("keeps JSON list output unchanged when --json is provided", async () => {
		mockGetRpcServerHealth.mockResolvedValue({ running: true });
		mockListSchedules.mockResolvedValue([]);

		const output: string[] = [];
		const errors: string[] = [];
		const code = await runScheduleCommand(["list", "--json"], {
			writeln: (text?: string) => {
				output.push(text ?? "");
			},
			writeErr: (text: string) => {
				errors.push(text);
			},
		});

		expect(code).toBe(0);
		expect(errors).toEqual([]);
		expect(output).toEqual(["[]"]);
		expect(mockClientClose).toHaveBeenCalledTimes(1);
	});
});
