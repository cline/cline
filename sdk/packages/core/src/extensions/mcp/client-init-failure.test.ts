import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDefaultMcpServerClientFactory } from "./client";
import {
	createMcpServerFixture,
	fakeServerRegistration,
	isProcessRunning,
	type McpServerFixture,
	serverCommand,
	waitFor,
} from "./client-test-fixtures";

/**
 * Initialize-failure and framing-fallback integration tests over real stdio
 * child processes (see client-test-fixtures.ts). Successful-connect cases run
 * in client-connect.test.ts; request-timeout cases run in client.test.ts.
 */

let fixture: McpServerFixture;
let tempRoot: string;

beforeAll(() => {
	fixture = createMcpServerFixture();
	tempRoot = fixture.tempRoot;
});

afterAll(() => {
	fixture.cleanup();
});

describe("mcp client initialize failures and framing", () => {
	it("fails initialize with the timeout hint when the server never responds", async () => {
		const factory = createDefaultMcpServerClientFactory();
		const client = await factory(
			fakeServerRegistration(tempRoot, {
				timeoutSeconds: 1,
				delayMs: 0,
				initDelayMs: 10_000,
			}),
		);
		const startedAt = Date.now();
		try {
			await expect(client.connect()).rejects.toThrow(
				/timed out.*"timeout" field \(in seconds\)/s,
			);
			expect(Date.now() - startedAt).toBeLessThan(8_000);
		} finally {
			await client.disconnect();
		}
	}, 30_000);

	it("uses the full configured timeout for the initialize request", async () => {
		const factory = createDefaultMcpServerClientFactory();
		const client = await factory(
			fakeServerRegistration(tempRoot, {
				timeoutSeconds: 2,
				delayMs: 0,
				initDelayMs: 10_000,
			}),
		);
		const startedAt = Date.now();
		try {
			await expect(client.connect()).rejects.toThrow(/after 2s/);
			expect(Date.now() - startedAt).toBeLessThan(4_500);
		} finally {
			await client.disconnect();
		}
	}, 30_000);

	it("applies the configured timeout to the Content-Length compatibility request", async () => {
		const client = await createDefaultMcpServerClientFactory()({
			name: "framed-server",
			transport: {
				type: "stdio",
				command: serverCommand,
				args: [join(tempRoot, "framed-server.js")],
				env: { FAKE_MCP_INIT_DELAY_MS: "2000" },
			},
			timeoutSeconds: 3,
		});
		const startedAt = Date.now();
		try {
			await client.connect();
			expect(await client.listTools()).toEqual([]);
			expect(Date.now() - startedAt).toBeGreaterThanOrEqual(4_500);
			expect(Date.now() - startedAt).toBeLessThan(7_000);
		} finally {
			await client.disconnect();
		}
	}, 30_000);

	it("names both framing attempts when they fail differently", async () => {
		const client = await createDefaultMcpServerClientFactory()({
			name: "rejecting-server",
			transport: {
				type: "stdio",
				command: serverCommand,
				args: [join(tempRoot, "newline-rejecting-server.js")],
			},
			timeoutSeconds: 1,
		});
		try {
			await expect(client.connect()).rejects.toThrow(
				/Newline-delimited attempt: newline framing rejected.*Content-Length framed attempt: .*timed out/s,
			);
		} finally {
			await client.disconnect();
		}
	}, 30_000);

	it("terminates the real child when the final initialize attempt fails", async () => {
		const pidFile = join(tempRoot, `failed-init-${Date.now()}.pid`);
		const factory = createDefaultMcpServerClientFactory();
		const client = await factory(
			fakeServerRegistration(tempRoot, {
				timeoutSeconds: 1,
				delayMs: 0,
				initDelayMs: 10_000,
				pidFile,
			}),
		);

		await expect(client.connect()).rejects.toThrow(/timed out/);
		await waitFor(() => existsSync(pidFile));
		const pid = Number(readFileSync(pidFile, "utf8"));
		await waitFor(() => !isProcessRunning(pid));
	}, 30_000);
});
