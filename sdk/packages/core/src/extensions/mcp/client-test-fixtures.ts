import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServerRegistration } from "./types";

/**
 * Shared fixtures for the MCP client integration tests. The suites exercise
 * real stdio child processes with env-controlled response delays, so several
 * tests necessarily wait multiple wall-clock seconds. They are split across
 * client.test.ts / client-connect.test.ts / client-init-failure.test.ts so
 * Vitest's fork pool runs those waits concurrently instead of serializing
 * ~30s of delays in a single file.
 */

export const FAKE_SERVER_SCRIPT = `
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

export const FRAMED_SERVER_SCRIPT = `
let buffer = "";
const initializeDelayMs = Number(process.env.FAKE_MCP_INIT_DELAY_MS ?? "0");
function write(payload) {
	const body = JSON.stringify(payload);
	process.stdout.write("Content-Length: " + Buffer.byteLength(body, "utf8") + "\\r\\n\\r\\n" + body);
}
process.stdin.on("data", (chunk) => {
	buffer += chunk.toString("utf8");
	while (true) {
		const separator = buffer.indexOf("\\r\\n\\r\\n");
		if (separator < 0) break;
		const header = buffer.slice(0, separator);
		const match = header.match(/Content-Length:\\s*(\\d+)/i);
		if (!match) throw new Error("missing content length");
		const length = Number(match[1]);
		const start = separator + 4;
		const end = start + length;
		if (buffer.length < end) break;
		const message = JSON.parse(buffer.slice(start, end));
		buffer = buffer.slice(end);
		if (message.method === "notifications/initialized") continue;
		const result = message.method === "initialize"
			? { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "framed", version: "0.0.0" } }
			: message.method === "tools/list"
				? { tools: [] }
				: { content: [] };
		setTimeout(() => write({ jsonrpc: "2.0", id: message.id, result }), message.method === "initialize" ? initializeDelayMs : 0);
	}
});
`;

// Rejects every newline-delimited request with a JSON-RPC error and never
// answers framed input (the framed body carries no trailing newline, so it
// stays buffered), making the two initialize attempts fail differently.
export const NEWLINE_REJECTING_SERVER_SCRIPT = `
let buffer = "";
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
			continue;
		}
		if (msg.id === undefined) continue;
		process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "newline framing rejected" } }) + "\\n");
	}
});
`;

export interface McpServerFixture {
	tempRoot: string;
	cleanup(): void;
}

/** Writes the fake server scripts into a fresh temp dir for one test file. */
export function createMcpServerFixture(): McpServerFixture {
	const tempRoot = mkdtempSync(join(tmpdir(), "mcp-client-test-"));
	writeFileSync(join(tempRoot, "fake-server.js"), FAKE_SERVER_SCRIPT, "utf8");
	writeFileSync(
		join(tempRoot, "framed-server.js"),
		FRAMED_SERVER_SCRIPT,
		"utf8",
	);
	writeFileSync(
		join(tempRoot, "newline-rejecting-server.js"),
		NEWLINE_REJECTING_SERVER_SCRIPT,
		"utf8",
	);
	return {
		tempRoot,
		cleanup() {
			rmSync(tempRoot, { recursive: true, force: true });
		},
	};
}

// Quoted for the win32 shell:true spawn path, where the runtime may live
// under a directory containing spaces.
export const serverCommand =
	process.platform === "win32" ? `"${process.execPath}"` : process.execPath;

export function fakeServerRegistration(
	tempRoot: string,
	options: {
		timeoutSeconds?: number;
		delayMs: number;
		initDelayMs?: number;
		pidFile?: string;
	},
): McpServerRegistration {
	return {
		name: "fake-server",
		transport: {
			type: "stdio",
			command: serverCommand,
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

export async function waitFor(
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

export function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}
