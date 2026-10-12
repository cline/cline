import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HUB_DEFAULT_COMMAND_TIMEOUT_MS } from "@cline/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createDefaultMcpServerClientFactory,
	DEFAULT_HTTP_MCP_CONNECT_TIMEOUT_MS,
	DEFAULT_MCP_CONNECT_TIMEOUT_MS,
	probeMcpServerConnection,
} from "./client";
import { resolveMcpServerRegistrations } from "./config-loader";
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

const FRAMED_SERVER_SCRIPT = `
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
const NEWLINE_REJECTING_SERVER_SCRIPT = `
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

// Answers initialize normally, then crashes (exit code 3) the moment a
// tools/call request starts arriving -- without draining stdin. A request body larger than the
// pipe buffer is then still partly queued on the client side when the reader
// disappears, which is how a stdin write fails asynchronously with EPIPE.
const EXIT_ON_CALL_SERVER_SCRIPT = `
let buffer = "";
process.stdin.on("data", (chunk) => {
	const text = chunk.toString("utf8");
	if (text.includes('"tools/call"')) {
		process.stderr.write("fatal: server crashed while reading request\\n");
		process.exit(3);
	}
	buffer += text;
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
		if (msg.id === undefined || msg.method !== "initialize") continue;
		const result = {
			protocolVersion: "2024-11-05",
			capabilities: {},
			serverInfo: { name: "fake", version: "0.0.0" },
		};
		process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\\n");
	}
});
`;

// Answers initialize, then closes its stdin the moment a tools/call request
// starts arriving and either stays alive or (FAKE_MCP_EXIT_AFTER_CLOSE_MS)
// exits with code 7 shortly after. FAKE_MCP_IGNORE_SIGTERM makes it survive
// SIGTERM. It reads fd 0 directly rather than through process.stdin so that
// libuv holds no handle on it and the close is real.
const CLOSE_STDIN_SERVER_SCRIPT = `
const fs = require("node:fs");
if (process.env.FAKE_MCP_PID_FILE) {
	fs.writeFileSync(process.env.FAKE_MCP_PID_FILE, String(process.pid));
}
if (process.env.FAKE_MCP_IGNORE_SIGTERM) {
	process.on("SIGTERM", () => {});
}
const chunk = Buffer.alloc(4096);
let buffer = "";
for (;;) {
	let read;
	try {
		read = fs.readSync(0, chunk, 0, chunk.length, null);
	} catch (error) {
		if (error.code === "EAGAIN") continue;
		throw error;
	}
	if (read === 0) break;
	const text = chunk.toString("utf8", 0, read);
	if (text.includes('"tools/call"')) {
		fs.closeSync(0);
		const exitAfterMs = Number(process.env.FAKE_MCP_EXIT_AFTER_CLOSE_MS);
		if (Number.isFinite(exitAfterMs)) {
			setTimeout(() => process.exit(7), exitAfterMs);
		} else {
			setInterval(() => {}, 1000);
		}
		break;
	}
	buffer += text;
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
		if (msg.id === undefined || msg.method !== "initialize") continue;
		const result = {
			protocolVersion: "2024-11-05",
			capabilities: {},
			serverInfo: { name: "fake", version: "0.0.0" },
		};
		fs.writeSync(1, JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\\n");
	}
}
`;

let tempRoot: string;

beforeAll(() => {
	tempRoot = mkdtempSync(join(tmpdir(), "mcp-client-test-"));
	writeFileSync(join(tempRoot, "fake-server.js"), FAKE_SERVER_SCRIPT, "utf8");
	writeFileSync(
		join(tempRoot, "exit-on-call-server.js"),
		EXIT_ON_CALL_SERVER_SCRIPT,
		"utf8",
	);
	writeFileSync(
		join(tempRoot, "close-stdin-server.js"),
		CLOSE_STDIN_SERVER_SCRIPT,
		"utf8",
	);
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
});

afterAll(() => {
	rmSync(tempRoot, { recursive: true, force: true });
});

function fakeServerRegistration(options: {
	timeoutSeconds?: number;
	delayMs: number;
	initDelayMs?: number;
	pidFile?: string;
	script?: string;
	exitAfterCloseMs?: number;
	ignoreSigterm?: boolean;
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
			args: [join(tempRoot, options.script ?? "fake-server.js")],
			env: {
				FAKE_MCP_DELAY_MS: String(options.delayMs),
				...(options.initDelayMs === undefined
					? {}
					: { FAKE_MCP_INIT_DELAY_MS: String(options.initDelayMs) }),
				...(options.pidFile === undefined
					? {}
					: { FAKE_MCP_PID_FILE: options.pidFile }),
				...(options.exitAfterCloseMs === undefined
					? {}
					: {
							FAKE_MCP_EXIT_AFTER_CLOSE_MS: String(options.exitAfterCloseMs),
						}),
				...(options.ignoreSigterm ? { FAKE_MCP_IGNORE_SIGTERM: "1" } : {}),
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
				/request to "fake-server" \(tools\/call\) timed out after 1s.*"timeout" field \(in seconds\)/s,
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

	it("connects a moderately slow server without a configured timeout", async () => {
		const factory = createDefaultMcpServerClientFactory();
		// The old 1.5s initialize probe killed servers that needed ~2s to answer
		// (https://github.com/cline/cline/issues/13035), and the 3s budget that
		// replaced it still dropped `npx`/`uvx`-launched servers on Windows,
		// where reaching initialize routinely takes 3-6s. The default budget
		// must cover them. It deliberately stays small beyond that: initialize
		// runs on the session.create critical path, so genuinely slow starters
		// (e.g. JVM-based Oracle SQLcl) opt into patience with an explicit
		// `timeout` instead of the default stalling every session.
		const client = await factory(
			fakeServerRegistration({ delayMs: 0, initDelayMs: 5_000 }),
		);
		try {
			await client.connect();
			expect(await client.listTools()).toEqual([]);
		} finally {
			await client.disconnect();
		}
	}, 30_000);

	it("connects a slow-starting server when a timeout is configured", async () => {
		const factory = createDefaultMcpServerClientFactory();
		const client = await factory(
			fakeServerRegistration({
				timeoutSeconds: 15,
				delayMs: 0,
				initDelayMs: 4_000,
			}),
		);
		try {
			await client.connect();
			expect(await client.listTools()).toEqual([]);
		} finally {
			await client.disconnect();
		}
	}, 30_000);

	it("uses the default connect budget when a malformed settings timeout is ignored", async () => {
		const filePath = join(tempRoot, `malformed-timeout-${Date.now()}.json`);
		writeFileSync(
			filePath,
			JSON.stringify({
				mcpServers: {
					"fake-server": {
						transport: fakeServerRegistration({
							delayMs: 0,
							initDelayMs: 2_000,
						}).transport,
						timeout: "60",
					},
				},
			}),
			"utf8",
		);
		const [registration] = resolveMcpServerRegistrations({ filePath });
		expect(registration.timeoutSeconds).toBeUndefined();
		const client = await createDefaultMcpServerClientFactory()(registration);
		try {
			await client.connect();
			expect(await client.listTools()).toEqual([]);
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

	it("uses the full configured timeout for the initialize request", async () => {
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
			expect(Date.now() - startedAt).toBeLessThan(4_500);
		} finally {
			await client.disconnect();
		}
	}, 30_000);

	it("applies the configured timeout to the Content-Length compatibility request", async () => {
		const command =
			process.platform === "win32" ? `"${process.execPath}"` : process.execPath;
		const client = await createDefaultMcpServerClientFactory()({
			name: "framed-server",
			transport: {
				type: "stdio",
				command,
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
		const command =
			process.platform === "win32" ? `"${process.execPath}"` : process.execPath;
		const client = await createDefaultMcpServerClientFactory()({
			name: "rejecting-server",
			transport: {
				type: "stdio",
				command,
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

	it("waits for the stdio child to close before disconnect resolves", async () => {
		const serverCwd = mkdtempSync(join(tempRoot, "disconnect-cwd-"));
		const pidFile = join(tempRoot, `disconnect-${Date.now()}.pid`);
		const registration = fakeServerRegistration({
			delayMs: 0,
			pidFile,
		});
		if (registration.transport.type !== "stdio") {
			throw new Error("Expected stdio registration.");
		}
		registration.transport.cwd = serverCwd;
		const client = await createDefaultMcpServerClientFactory()(registration);

		try {
			await client.connect();
			await waitFor(() => existsSync(pidFile));
			const pid = Number(readFileSync(pidFile, "utf8"));
			expect(isProcessRunning(pid)).toBe(true);

			await client.disconnect();

			expect(isProcessRunning(pid)).toBe(false);
			expect(() =>
				rmSync(serverCwd, { recursive: true, force: true }),
			).not.toThrow();
		} finally {
			await client.disconnect().catch(() => {});
		}
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

describe("remote MCP OAuth connection", () => {
	it("reports authorization required without starting an interactive OAuth flow", async () => {
		const settingsPath = join(tempRoot, "remote-oauth-settings.json");
		writeFileSync(
			settingsPath,
			JSON.stringify({
				mcpServers: {
					github: {
						transport: {
							type: "streamableHttp",
							url: "https://api.githubcopilot.com/mcp/",
						},
					},
				},
			}),
			"utf8",
		);
		const fetchMock = vi.fn(async () =>
			Promise.resolve(
				new Response(null, {
					status: 401,
					headers: { "www-authenticate": "Bearer" },
				}),
			),
		);
		const result = await probeMcpServerConnection({
			serverName: "github",
			filePath: settingsPath,
			fetch: fetchMock,
		});

		expect(result).toMatchObject({
			serverName: "github",
			connected: false,
			authorizationRequired: true,
			error: expect.stringMatching(
				/MCP server "github" requires OAuth authorization/,
			),
		});

		const written = JSON.parse(readFileSync(settingsPath, "utf8"));
		expect(written.mcpServers.github.oauth).toMatchObject({
			authorizationRequired: true,
		});
		expect(written.mcpServers.github.oauth).not.toHaveProperty("codeVerifier");
		expect(written.mcpServers.github.oauth).not.toHaveProperty(
			"discoveryState",
		);
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("surfaces a rejected static Authorization header as a connection error", async () => {
		const settingsPath = join(tempRoot, "remote-static-auth-settings.json");
		writeFileSync(
			settingsPath,
			JSON.stringify({
				mcpServers: {
					notion: {
						transport: {
							type: "streamableHttp",
							url: "https://mcp.notion.com/mcp",
							headers: { Authorization: "Bearer token" },
						},
					},
				},
			}),
			"utf8",
		);

		const result = await probeMcpServerConnection({
			serverName: "notion",
			filePath: settingsPath,
			fetch: async () =>
				new Response(null, {
					status: 401,
					headers: { "www-authenticate": "Bearer" },
				}),
		});

		expect(result).toEqual({
			serverName: "notion",
			connected: false,
			authorizationRequired: false,
			error:
				'MCP server "notion" rejected its configured Authorization header. Update or remove that header before connecting with OAuth.',
		});
	});
});

describe("default connect budget", () => {
	it("keeps the doubled initialize budget well under the hub command timeout", () => {
		// MCP initialize runs on the session.create critical path, and connect()
		// can spend the budget twice (newline then Content-Length framing). If
		// the doubled total approaches HUB_DEFAULT_COMMAND_TIMEOUT_MS, a server
		// that never initializes stalls session.create past the hub deadline and
		// the whole session is torn down (a hung server used to kill the CLI
		// this way). Keep headroom for the rest of session creation.
		expect(DEFAULT_MCP_CONNECT_TIMEOUT_MS * 2).toBeLessThanOrEqual(
			HUB_DEFAULT_COMMAND_TIMEOUT_MS - 10_000,
		);
	});

	it("keeps the remote connect budget well under the hub command timeout", () => {
		// Remote (SSE/streamable HTTP) connect also runs on the session.create
		// critical path. Without this bound an offline remote server stalls
		// session.create past the hub deadline and takes the whole session
		// down (this crashed the CLI).
		expect(DEFAULT_HTTP_MCP_CONNECT_TIMEOUT_MS).toBeLessThanOrEqual(
			HUB_DEFAULT_COMMAND_TIMEOUT_MS / 2,
		);
	});
});

describe("mcp client stdin failures", () => {
	it("reports the server's exit, not the broken pipe, when it dies mid-write", async () => {
		const uncaught: unknown[] = [];
		const onUncaught: NodeJS.UncaughtExceptionListener = (error) => {
			uncaught.push(error);
		};
		process.on("uncaughtException", onUncaught);
		const factory = createDefaultMcpServerClientFactory();
		const client = await factory(
			fakeServerRegistration({ delayMs: 0, script: "exit-on-call-server.js" }),
		);
		try {
			await client.connect();
			await expect(
				client.callTool({
					name: "anything",
					arguments: { blob: "x".repeat(1_000_000) },
				}),
			).rejects.toThrow(/MCP process exited for "fake-server" \(code=3/);
			// Give a late pipe error a chance to surface before asserting.
			await new Promise((resolve) => setTimeout(resolve, 200));
			expect(uncaught).toEqual([]);
		} finally {
			process.removeListener("uncaughtException", onUncaught);
			await client.disconnect();
		}
	}, 30_000);

	// On win32 the server runs under a cmd.exe wrapper (shell: true) that holds
	// the pipe open, so closing stdin inside the script never fails the write.
	for (const ignoreSigterm of [false, true]) {
		it.skipIf(process.platform === "win32")(
			`fails the request at once and stops a server that closes stdin but stays alive (${ignoreSigterm ? "ignores" : "honors"} SIGTERM)`,
			async () => {
				const pidFile = join(
					tempRoot,
					`close-stdin-${ignoreSigterm ? "ignores" : "honors"}-sigterm.pid`,
				);
				const factory = createDefaultMcpServerClientFactory();
				const client = await factory(
					fakeServerRegistration({
						delayMs: 0,
						timeoutSeconds: 20,
						script: "close-stdin-server.js",
						pidFile,
						ignoreSigterm,
					}),
				);
				try {
					await client.connect();
					const pid = Number(readFileSync(pidFile, "utf8"));
					const startedAt = Date.now();
					await expect(
						client.callTool({
							name: "anything",
							arguments: { blob: "x".repeat(1_000_000) },
						}),
					).rejects.toThrow(
						/MCP server "fake-server" stopped reading its input .*\(write EPIPE\) and did not exit/,
					);
					// Well under the 20s request timeout: no reply could ever come.
					expect(Date.now() - startedAt).toBeLessThan(5_000);
					// Escalates to SIGKILL when SIGTERM is ignored.
					await waitFor(() => !isProcessRunning(pid), 10_000);
				} finally {
					await client.disconnect();
				}
			},
			30_000,
		);
	}

	it.skipIf(process.platform === "win32")(
		"still reports the server's own exit code when it exits shortly after closing stdin",
		async () => {
			const factory = createDefaultMcpServerClientFactory();
			const client = await factory(
				fakeServerRegistration({
					delayMs: 0,
					timeoutSeconds: 20,
					script: "close-stdin-server.js",
					exitAfterCloseMs: 50,
				}),
			);
			try {
				await client.connect();
				// The stdin write fails as soon as the server closes its end, but
				// the server is about to exit on its own; the client must wait for
				// that rather than kill it and report SIGTERM.
				await expect(
					client.callTool({
						name: "anything",
						arguments: { blob: "x".repeat(1_000_000) },
					}),
				).rejects.toThrow(/MCP process exited for "fake-server" \(code=7/);
			} finally {
				await client.disconnect();
			}
		},
		30_000,
	);
});
