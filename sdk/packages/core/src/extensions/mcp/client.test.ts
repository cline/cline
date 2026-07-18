import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:child_process")>()),
	spawn: spawnMock,
}));

vi.mock("./oauth", () => ({
	createMcpOAuthProviderContext: vi.fn(),
	createMcpSdkTransport: vi.fn(),
}));

import { createDefaultMcpServerClientFactory } from "./client";

function createChildProcess(): ChildProcessWithoutNullStreams {
	const child = new EventEmitter() as ChildProcessWithoutNullStreams;
	Object.assign(child, {
		stdin: new PassThrough(),
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		kill: vi.fn(() => true),
	});
	return child;
}

describe("stdio mcp client", () => {
	afterEach(() => {
		vi.useRealTimers();
		spawnMock.mockReset();
	});

	it("uses the configured initialize timeout for each protocol attempt", async () => {
		vi.useFakeTimers();
		spawnMock.mockImplementation(createChildProcess);
		const client = await createDefaultMcpServerClientFactory()({
			name: "slow-server",
			transport: { type: "stdio", command: "slow-server" },
			initializeTimeoutMs: 250,
		});

		const connection = client.connect();
		const result = connection.catch((error: unknown) => error);
		await vi.advanceTimersByTimeAsync(0);
		expect(spawnMock).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(249);
		expect(spawnMock).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(1);
		expect(spawnMock).toHaveBeenCalledTimes(2);

		await vi.advanceTimersByTimeAsync(250);
		expect(await result).toEqual(
			new Error('MCP request timed out for "slow-server" (initialize).'),
		);
	});
});
