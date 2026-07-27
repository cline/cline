import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDefaultMcpServerClientFactory } from "./client";
import type { McpServerRegistration } from "./types";

/**
 * Integration tests for MCP client request timeouts against a real stdio
 * child process. The fake server is a Node script speaking newline-delimited
 * JSON-RPC with an env-controlled response delay, so the tests cross the
 * actual process/stdio boundary where the timeout risk lives.
 */

const FAKE_SERVER_SCRIPT = `
if (process.env.FAKE_MCP_PID_FILE) {
	require("node:fs").writeFileSync(process.env.FAKE_MCP_PID_FILE, String(process.pid));
}
let buffer = "";
const responseTimers = new Set();
process.stdin.on("data", (chunk) => {
	buffer += chunk.toString("utf8");
	let idx;
	while ((idx = buffer.indexOf("\\n")) >= 0) {
		const line = buffer.slice(0, idx).trim();
		buffer = buffer.slice(idx + 1);
		if (!line) continue;
		let msg;
		try {
			msg = JSON.parse(line);
		} catch {
			// Tolerate the framed-mode probe attempt: its Content-Length header
			// line is not JSON, but the embedded body line is handled next.
			continue;
		}
		if (msg.id === undefined || !msg.method || msg.method.startsWith("notifications/")) continue;
		const delay = Number(
			msg.method === "initialize"
				? (process.env.FAKE_MCP_INIT_DELAY_MS ?? "0")
				: (process.env.FAKE_MCP_DELAY_MS ?? "0"),
		);
		const responseTimer = setTimeout(() => {
			responseTimers.delete(responseTimer);
			let result;
			if (msg.method === "initialize") {
				result = {
					protocolVersion: "2024-11-05",
					capabilities: {},
					serverInfo: { name: "fake", version: "0.0.0" },
				};
			} else if (msg.method === "tools/list") {
				result = { tools: [] };
			} else if (msg.method === "tools/call") {
				result = { content: [{ type: "text", text: "ok" }] };
			} else {
				result = {};
			}
			process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\\n");
		}, delay);
		responseTimers.add(responseTimer);
	}
});
process.stdin.on("end", () => {
	for (const responseTimer of responseTimers) clearTimeout(responseTimer);
	process.exit(0);
});
`;

let tempRoot: string;

beforeAll(() => {
	tempRoot = mkdtempSync(join(tmpdir(), "mcp-client-test-"));
	writeFileSync(join(tempRoot, "fake-server.js"), FAKE_SERVER_SCRIPT, "utf8");
});

afterAll(() => {
	rmSync(tempRoot, { recursive: true, force: true });
});

function fakeServerRegistration(options: {
	timeoutSeconds?: number;
	delayMs: number;
	initDelayMs?: number;
	pidFile?: string;
}): McpServerRegistration {
	return {
		name: "fake-server",
		transport: {
			type: "stdio",
			// Quoted for the win32 shell:true spawn path, where the runtime may
			// live under a directory containing spaces.
			command:
				process.platform === "win32"
					? `"${process.execPath}"`
					: process.execPath,
			args: [join(tempRoot, "fake-server.js")],
			env: {
				FAKE_MCP_DELAY_MS: String(options.delayMs),
				...(options.initDelayMs === undefined
					? {}
					: { FAKE_MCP_INIT_DELAY_MS: String(options.initDelayMs) }),
				...(options.pidFile === undefined
					? {}
					: { FAKE_MCP_PID_FILE: options.pidFile }),
			},
		},
		...(options.timeoutSeconds === undefined
			? {}
			: { timeoutSeconds: options.timeoutSeconds }),
	};
}

async function waitFor(
	predicate: () => boolean,
	timeoutMs = 5_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) {
			throw new Error("Timed out waiting for condition");
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}

describe("mcp client request timeout", () => {
	it("lets a slow server respond beyond the old 5s default when configured higher", async () => {
		const factory = createDefaultMcpServerClientFactory();
		const client = await factory(
			fakeServerRegistration({ timeoutSeconds: 30, delayMs: 6_000 }),
		);
		try {
			await client.connect();
			const tools = await client.listTools();
			expect(tools).toEqual([]);
		} finally {
			await client.disconnect();
		}
	}, 30_000);

	it("times out with a message naming the bound and the field to change", async () => {
		const factory = createDefaultMcpServerClientFactory();
		const client = await factory(
			fakeServerRegistration({ timeoutSeconds: 1, delayMs: 5_000 }),
		);
		try {
			await client.connect();
			await expect(client.callTool({ name: "anything" })).rejects.toThrow(
				/timed out for "fake-server" \(tools\/call\) after 1s.*"timeout" field \(in seconds\)/s,
			);
		} finally {
			await client.disconnect();
		}
	}, 30_000);

	it("raises the initialize probe budget when a timeout is configured", async () => {
		const factory = createDefaultMcpServerClientFactory();
		// 3s of startup work would fail the old 1.5s probe; the configured
		// 10s timeout lets initialize finish.
		const client = await factory(
			fakeServerRegistration({
				timeoutSeconds: 10,
				delayMs: 0,
				initDelayMs: 3_000,
			}),
		);
		try {
			await client.connect();
			const tools = await client.listTools();
			expect(tools).toEqual([]);
		} finally {
			await client.disconnect();
		}
	}, 30_000);

	it("keeps the fast probe default when no timeout is configured", async () => {
		const factory = createDefaultMcpServerClientFactory();
		// 3s of startup work exceeds the 1.5s default probe, so connect must
		// fail quickly instead of stalling startup.
		const client = await factory(
			fakeServerRegistration({ delayMs: 0, initDelayMs: 3_000 }),
		);
		const startedAt = Date.now();
		try {
			await expect(client.connect()).rejects.toThrow(/timed out/);
			expect(Date.now() - startedAt).toBeLessThan(8_000);
		} finally {
			await client.disconnect();
		}
	}, 30_000);

	it("fails initialize with the timeout hint when the server never responds", async () => {
		const factory = createDefaultMcpServerClientFactory();
		const client = await factory(
			fakeServerRegistration({
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

	it("shares one configured initialize timeout across both protocol probes", async () => {
		const factory = createDefaultMcpServerClientFactory();
		const client = await factory(
			fakeServerRegistration({
				timeoutSeconds: 2,
				delayMs: 0,
				initDelayMs: 10_000,
			}),
		);
		const startedAt = Date.now();
		try {
			await expect(client.connect()).rejects.toThrow(/after 2s/);
			// Two independent 2s probes would exceed this bound.
			expect(Date.now() - startedAt).toBeLessThan(3_500);
		} finally {
			await client.disconnect();
		}
	}, 30_000);

	it("terminates the real child when the final initialize attempt fails", async () => {
		const pidFile = join(tempRoot, `failed-init-${Date.now()}.pid`);
		const factory = createDefaultMcpServerClientFactory();
		const client = await factory(
			fakeServerRegistration({
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

	it("aborts a long stdio tool call without waiting for its timeout", async () => {
		const factory = createDefaultMcpServerClientFactory();
		const client = await factory(
			fakeServerRegistration({ timeoutSeconds: 30, delayMs: 10_000 }),
		);
		const controller = new AbortController();
		try {
			await client.connect();
			const call = client.callTool({
				name: "anything",
				context: {
					agentId: "test-agent",
					iteration: 1,
					signal: controller.signal,
				},
			});
			controller.abort();
			await expect(call).rejects.toMatchObject({ name: "AbortError" });
		} finally {
			await client.disconnect();
		}
	}, 30_000);
});
