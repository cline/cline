import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createScheduleCommand } from "./schedule";

const mockSendHubCommand = vi.hoisted(() => vi.fn());
const mockEnsureCliHubServer = vi.hoisted(() => vi.fn());

vi.mock("@clinebot/core", () => ({
	sendHubCommand: mockSendHubCommand,
}));

vi.mock("../utils/hub-runtime", () => ({
	ensureCliHubServer: mockEnsureCliHubServer,
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
		mockEnsureCliHubServer.mockResolvedValue("ws://127.0.0.1:25463/hub");
		mockSendHubCommand.mockResolvedValue({
			ok: true,
			payload: { schedules: [] },
		});

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
		expect(mockSendHubCommand).toHaveBeenCalledWith(
			{},
			{
				clientId: "clite-schedule",
				command: "schedule.list",
				payload: {
					limit: 100,
					enabled: undefined,
					tags: undefined,
				},
			},
		);
	});

	it("keeps JSON list output unchanged when --json is provided", async () => {
		mockEnsureCliHubServer.mockResolvedValue("ws://127.0.0.1:25463/hub");
		mockSendHubCommand.mockResolvedValue({
			ok: true,
			payload: { schedules: [] },
		});

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
		expect(mockSendHubCommand).toHaveBeenCalled();
	});
});

describe("runScheduleCommand import", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("preserves exported modelSelection providerId/modelId values", async () => {
		mockEnsureCliHubServer.mockResolvedValue("ws://127.0.0.1:25463/hub");
		mockSendHubCommand.mockResolvedValue({
			ok: true,
			payload: { schedule: { scheduleId: "sched_123" } },
		});

		const sourcePath = join(
			tmpdir(),
			`clite-schedule-import-${Date.now()}.json`,
		);
		await writeFile(
			sourcePath,
			JSON.stringify({
				name: "Daily Review",
				cronPattern: "0 9 * * *",
				prompt: "review status",
				workspaceRoot: "/tmp/workspace",
				modelSelection: {
					providerId: "anthropic",
					modelId: "claude-sonnet-4-6",
				},
			}),
			"utf8",
		);

		const output: string[] = [];
		const errors: string[] = [];
		const code = await runScheduleCommand(["import", sourcePath], {
			writeln: (text?: string) => {
				output.push(text ?? "");
			},
			writeErr: (text: string) => {
				errors.push(text);
			},
		});

		expect(code).toBe(0);
		expect(errors).toEqual([]);
		expect(output).toEqual(['{\n  "scheduleId": "sched_123"\n}']);
		expect(mockSendHubCommand).toHaveBeenCalledWith(
			{},
			{
				clientId: "clite-schedule",
				command: "schedule.create",
				payload: expect.objectContaining({
					provider: "anthropic",
					model: "claude-sonnet-4-6",
				}),
			},
		);
	});
});
