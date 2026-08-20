/**
 * MCP pooling (Gateway RFC, Phase 5): scope-keyed safe reuse,
 * cross-principal/bot/workspace isolation, reference-counted lease
 * lifetimes, selective generation drain on credential/definition change,
 * bounded reconnect storms with exponential backoff, the schema cache,
 * and policy-filtered session tool views.
 */

import { createBotId, createPrincipalId } from "@cline/shared/gateway";
import { describe, expect, it } from "vitest";
import { definitionRevision, type McpServerDefinition } from "./definitions";
import { McpConnectBackoffError, McpConnectionPool, mcpPoolKey } from "./pool";
import type { McpTransport, McpTransportContext } from "./transport";
import { McpToolDeniedError, SessionMcpToolView } from "./views";

const DEFINITION: McpServerDefinition = {
	name: "files",
	transport: { kind: "stdio", command: "file-server" },
	authScope: "files-token",
};

class FakeTransport implements McpTransport {
	static created: FakeTransport[] = [];
	readonly definition: McpServerDefinition;
	readonly context: McpTransportContext;
	started = 0;
	closed = 0;
	listToolsCalls = 0;
	callToolCalls: { name: string; args?: Record<string, unknown> }[] = [];
	failToStart = false;
	private closeListeners = new Set<(error?: Error) => void>();

	constructor(definition: McpServerDefinition, context: McpTransportContext) {
		this.definition = definition;
		this.context = context;
		FakeTransport.created.push(this);
	}

	async start(): Promise<void> {
		this.started += 1;
		if (this.failToStart) {
			throw new Error("connect refused");
		}
	}

	async request(method: string, params?: unknown): Promise<unknown> {
		if (method === "tools/list") {
			this.listToolsCalls += 1;
			return {
				tools: [
					{ name: "read_file", description: "Read a file" },
					{ name: "delete_file", description: "Delete a file" },
				],
			};
		}
		if (method === "tools/call") {
			const call = params as {
				name: string;
				arguments?: Record<string, unknown>;
			};
			this.callToolCalls.push({ name: call.name, args: call.arguments });
			return { ok: true, tool: call.name };
		}
		throw new Error(`Unexpected method ${method}`);
	}

	async close(): Promise<void> {
		this.closed += 1;
		for (const listener of this.closeListeners) {
			listener();
		}
	}

	onClose(listener: (error?: Error) => void): () => void {
		this.closeListeners.add(listener);
		return () => {
			this.closeListeners.delete(listener);
		};
	}
}

function createPool(
	options: {
		failToStart?: () => boolean;
		clock?: () => number;
		backoff?: { baseMs?: number; maxMs?: number };
	} = {},
) {
	FakeTransport.created = [];
	const pool = new McpConnectionPool({
		transportFactory: (definition, context) => {
			const transport = new FakeTransport(definition, context);
			transport.failToStart = options.failToStart?.() ?? false;
			return transport;
		},
		resolveCredential: (scope) => `secret-for-${scope}`,
		clock: options.clock,
		backoff: options.backoff ?? { baseMs: 100, maxMs: 1_000 },
	});
	return pool;
}

describe("pool keys", () => {
	it("include definition revision, principal, bot, workspace, and auth scope", () => {
		const principalId = createPrincipalId();
		const base = { definition: DEFINITION, principalId };
		const key = mcpPoolKey(base);
		expect(key).toContain(definitionRevision(DEFINITION));
		expect(key).toContain(principalId);
		expect(mcpPoolKey({ ...base, botId: createBotId() })).not.toBe(key);
		expect(mcpPoolKey({ ...base, workspaceId: "ws-1" })).not.toBe(key);
		expect(mcpPoolKey({ ...base, authScope: "other" })).not.toBe(key);
		// A definition content change changes the revision, hence the key.
		expect(
			mcpPoolKey({
				...base,
				definition: {
					...DEFINITION,
					transport: { kind: "stdio", command: "file-server-v2" },
				},
			}),
		).not.toBe(key);
	});
});

describe("safe reuse and isolation", () => {
	it("reuses one connection for the same scope key", async () => {
		const pool = createPool();
		const principalId = createPrincipalId();
		const a = await pool.acquire({ definition: DEFINITION, principalId });
		const b = await pool.acquire({ definition: DEFINITION, principalId });
		expect(FakeTransport.created).toHaveLength(1);
		expect(a.connection.generation).toBe(b.connection.generation);
		a.release();
		b.release();
	});

	it("never shares a connection across principals or workspaces", async () => {
		const pool = createPool();
		const principalA = createPrincipalId();
		const principalB = createPrincipalId();
		await pool.acquire({ definition: DEFINITION, principalId: principalA });
		await pool.acquire({ definition: DEFINITION, principalId: principalB });
		expect(FakeTransport.created).toHaveLength(2);
		await pool.acquire({
			definition: DEFINITION,
			principalId: principalA,
			workspaceId: "ws-1",
		});
		await pool.acquire({
			definition: DEFINITION,
			principalId: principalA,
			workspaceId: "ws-2",
		});
		expect(FakeTransport.created).toHaveLength(4);
	});

	it("resolves credentials by auth scope, never exposing them on leases", async () => {
		const pool = createPool();
		const lease = await pool.acquire({
			definition: DEFINITION,
			principalId: createPrincipalId(),
		});
		expect(FakeTransport.created[0].context.credential).toBe(
			"secret-for-files-token",
		);
		expect(FakeTransport.created[0].context.authScope).toBe("files-token");
		// The lease surface carries no credential anywhere.
		expect(JSON.stringify(lease)).not.toContain("secret-for");
		lease.release();
	});
});

describe("lease lifetime", () => {
	it("releasing one lease does not close a connection used elsewhere", async () => {
		const pool = createPool();
		const principalId = createPrincipalId();
		const a = await pool.acquire({ definition: DEFINITION, principalId });
		const b = await pool.acquire({ definition: DEFINITION, principalId });
		a.release();
		expect(FakeTransport.created[0].closed).toBe(0);
		expect(await b.connection.listTools()).toHaveLength(2);
		b.release();
		// Active (non-draining) connections stay pooled for reuse.
		expect(FakeTransport.created[0].closed).toBe(0);
		const c = await pool.acquire({ definition: DEFINITION, principalId });
		expect(FakeTransport.created).toHaveLength(1);
		c.release();
	});

	it("release is idempotent", async () => {
		const pool = createPool();
		const lease = await pool.acquire({
			definition: DEFINITION,
			principalId: createPrincipalId(),
		});
		lease.release();
		lease.release();
		expect(pool.stats().active).toBe(1);
	});
});

describe("generation drain", () => {
	it("credential change drains only the affected auth scope", async () => {
		const pool = createPool();
		const principalId = createPrincipalId();
		const otherDefinition: McpServerDefinition = {
			name: "web",
			transport: { kind: "http", url: "https://example.com/mcp" },
			authScope: "web-token",
		};
		const files = await pool.acquire({ definition: DEFINITION, principalId });
		const web = await pool.acquire({
			definition: otherDefinition,
			principalId,
		});
		const drained = pool.drainAuthScope("files-token");
		expect(drained).toBe(1);

		// The existing lease keeps its (draining) connection until released.
		expect(files.connection.state).toBe("draining");
		expect(await files.connection.listTools()).toHaveLength(2);
		// The unaffected scope is untouched.
		expect(web.connection.state).toBe("ready");

		// A new acquire under the drained scope builds a NEW generation.
		const fresh = await pool.acquire({ definition: DEFINITION, principalId });
		expect(fresh.connection.generation).not.toBe(files.connection.generation);
		expect(FakeTransport.created).toHaveLength(3);

		// Releasing the last old lease closes the drained connection only.
		files.release();
		expect(FakeTransport.created[0].closed).toBe(1);
		expect(FakeTransport.created[1].closed).toBe(0);
		fresh.release();
		web.release();
	});

	it("definition change drains only connections built from it", async () => {
		const pool = createPool();
		const principalId = createPrincipalId();
		const other: McpServerDefinition = {
			name: "web",
			transport: { kind: "http", url: "https://example.com/mcp" },
		};
		const a = await pool.acquire({ definition: DEFINITION, principalId });
		const b = await pool.acquire({ definition: other, principalId });
		expect(pool.drainDefinition("files")).toBe(1);
		expect(a.connection.state).toBe("draining");
		expect(b.connection.state).toBe("ready");
		a.release();
		b.release();
	});
});

describe("reconnect storms", () => {
	it("shares one in-flight connect across concurrent acquires", async () => {
		const pool = createPool();
		const principalId = createPrincipalId();
		const leases = await Promise.all(
			Array.from({ length: 8 }, () =>
				pool.acquire({ definition: DEFINITION, principalId }),
			),
		);
		expect(FakeTransport.created).toHaveLength(1);
		expect(FakeTransport.created[0].started).toBe(1);
		for (const lease of leases) {
			lease.release();
		}
	});

	it("bounds repeated failures with exponential backoff", async () => {
		let now = 10_000;
		let failing = true;
		const pool = createPool({
			failToStart: () => failing,
			clock: () => now,
			backoff: { baseMs: 100, maxMs: 400 },
		});
		const principalId = createPrincipalId();
		const context = { definition: DEFINITION, principalId };

		await expect(pool.acquire(context)).rejects.toThrow("connect refused");
		// Immediately retrying is refused — no storm.
		await expect(pool.acquire(context)).rejects.toThrow(McpConnectBackoffError);
		expect(pool.connectAttemptsFor(context)).toBe(1);

		now += 101; // past the first backoff window (100ms)
		await expect(pool.acquire(context)).rejects.toThrow("connect refused");
		expect(pool.connectAttemptsFor(context)).toBe(2);
		// The second failure doubles the wait.
		now += 150;
		await expect(pool.acquire(context)).rejects.toThrow(McpConnectBackoffError);
		now += 100; // total 250 > 200
		failing = false;
		const lease = await pool.acquire(context);
		expect(lease.connection.state).toBe("ready");
		expect(pool.connectAttemptsFor(context)).toBe(3);
		lease.release();
	});
});

describe("schema cache and filtered views", () => {
	it("caches tools/list per connection", async () => {
		const pool = createPool();
		const lease = await pool.acquire({
			definition: DEFINITION,
			principalId: createPrincipalId(),
		});
		await lease.connection.listTools();
		await lease.connection.listTools();
		await lease.connection.listTools();
		expect(FakeTransport.created[0].listToolsCalls).toBe(1);
		lease.release();
	});

	it("session views filter both listing and calling", async () => {
		const pool = createPool();
		const lease = await pool.acquire({
			definition: DEFINITION,
			principalId: createPrincipalId(),
		});
		const view = new SessionMcpToolView(lease, {
			allowTool: (_server, tool) => tool.name !== "delete_file",
		});
		const tools = await view.listTools();
		expect(tools.map((tool) => tool.name)).toEqual(["read_file"]);
		await expect(view.callTool("delete_file")).rejects.toThrow(
			McpToolDeniedError,
		);
		await expect(view.callTool("not_a_tool")).rejects.toThrow(
			McpToolDeniedError,
		);
		const result = await view.callTool("read_file", { path: "/tmp/x" });
		expect(result).toEqual({ ok: true, tool: "read_file" });
		expect(FakeTransport.created[0].callToolCalls).toEqual([
			{ name: "read_file", args: { path: "/tmp/x" } },
		]);
		lease.release();
	});
});
