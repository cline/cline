/**
 * MCP transports (Gateway RFC, Phase 5).
 *
 * The Gateway owns transports: the pool talks to an `McpTransport` and a
 * factory builds one per (definition, auth context). The real stdio
 * transport speaks JSON-RPC 2.0 over a child process's stdin/stdout and
 * performs the MCP `initialize` handshake in `start()`. Tests inject
 * scripted factories; HTTP and other transports slot in behind the same
 * interface.
 */

import { type ChildProcess, spawn } from "node:child_process";
import type { McpServerDefinition } from "./definitions";

const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const RESERVED_MCP_HTTP_HEADERS = new Set([
	"accept",
	"content-length",
	"content-type",
	"host",
	"mcp-session-id",
]);

function isLoopbackHostname(hostname: string): boolean {
	return (
		hostname === "localhost" ||
		hostname === "127.0.0.1" ||
		hostname === "::1" ||
		hostname.endsWith(".localhost")
	);
}

function validateHttpTransportDefinition(
	definition: McpServerDefinition,
): void {
	if (definition.transport.kind !== "http") return;
	let url: URL;
	try {
		url = new URL(definition.transport.url);
	} catch {
		throw new Error("MCP HTTP URL is invalid");
	}
	if (
		url.protocol !== "https:" &&
		!(url.protocol === "http:" && isLoopbackHostname(url.hostname))
	) {
		throw new Error(
			"MCP HTTP URL must use HTTPS (HTTP is allowed only on loopback)",
		);
	}
	if (url.username || url.password) {
		throw new Error("MCP HTTP URL cannot contain credentials");
	}
	if (url.hash) throw new Error("MCP HTTP URL cannot contain a fragment");
	for (const [name, value] of Object.entries(
		definition.transport.headers ?? {},
	)) {
		if (!HTTP_HEADER_NAME_PATTERN.test(name) || name.length > 128) {
			throw new Error(`MCP HTTP header name is invalid: ${name}`);
		}
		if (RESERVED_MCP_HTTP_HEADERS.has(name.toLowerCase())) {
			throw new Error(`MCP HTTP header is managed by the Gateway: ${name}`);
		}
		if (value.length > 8_192 || /[\0\r\n]/.test(value)) {
			throw new Error(`MCP HTTP header value is invalid: ${name}`);
		}
	}
}

export interface McpTransportContext {
	/** Auth scope name from the pool key (never the credential itself). */
	readonly authScope?: string;
	/** Secret resolved by the Gateway for that scope, when one exists. */
	readonly credential?: string;
}

export interface McpTransport {
	start(): Promise<void>;
	request(method: string, params?: unknown): Promise<unknown>;
	close(): Promise<void>;
	onClose(listener: (error?: Error) => void): () => void;
}

export type McpTransportFactory = (
	definition: McpServerDefinition,
	context: McpTransportContext,
) => McpTransport;

interface PendingRpc {
	resolve(value: unknown): void;
	reject(error: Error): void;
}

/** JSON-RPC 2.0 over NDJSON on a child process's stdio. */
export class StdioMcpTransport implements McpTransport {
	private readonly definition: McpServerDefinition;
	private readonly context: McpTransportContext;
	private child: ChildProcess | undefined;
	private readonly pending = new Map<number, PendingRpc>();
	private readonly closeListeners = new Set<(error?: Error) => void>();
	private nextId = 0;
	private buffer = "";
	private closed = false;

	constructor(definition: McpServerDefinition, context: McpTransportContext) {
		if (definition.transport.kind !== "stdio") {
			throw new Error(
				`StdioMcpTransport requires a stdio definition; got ${definition.transport.kind}`,
			);
		}
		this.definition = definition;
		this.context = context;
	}

	async start(): Promise<void> {
		const spec = this.definition.transport;
		if (spec.kind !== "stdio") {
			throw new Error("unreachable");
		}
		const child = spawn(spec.command, [...(spec.args ?? [])], {
			stdio: ["pipe", "pipe", "inherit"],
			cwd: spec.cwd,
			env: {
				...process.env,
				...spec.env,
				...(this.context.credential
					? { MCP_AUTH_TOKEN: this.context.credential }
					: {}),
			},
		});
		this.child = child;
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => this.feed(chunk));
		child.on("exit", () => this.emitClose());
		child.on("error", (error) => this.emitClose(error));
		await this.request("initialize", {
			protocolVersion: "2024-11-05",
			clientInfo: { name: "clinegate", version: "1" },
			capabilities: {},
		});
		this.notify("notifications/initialized", {});
	}

	request(method: string, params?: unknown): Promise<unknown> {
		const child = this.child;
		if (!child || this.closed) {
			return Promise.reject(new Error("Transport is not started"));
		}
		this.nextId += 1;
		const id = this.nextId;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			child.stdin?.write(
				`${JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} })}\n`,
			);
		});
	}

	private notify(method: string, params?: unknown): void {
		this.child?.stdin?.write(
			`${JSON.stringify({ jsonrpc: "2.0", method, params: params ?? {} })}\n`,
		);
	}

	async close(): Promise<void> {
		this.closed = true;
		this.child?.kill();
		this.emitClose();
	}

	onClose(listener: (error?: Error) => void): () => void {
		this.closeListeners.add(listener);
		return () => {
			this.closeListeners.delete(listener);
		};
	}

	private feed(chunk: string): void {
		this.buffer += chunk;
		for (;;) {
			const newline = this.buffer.indexOf("\n");
			if (newline === -1) {
				return;
			}
			const line = this.buffer.slice(0, newline).trim();
			this.buffer = this.buffer.slice(newline + 1);
			if (!line) {
				continue;
			}
			let value: unknown;
			try {
				value = JSON.parse(line);
			} catch {
				continue;
			}
			const frame = value as {
				id?: unknown;
				result?: unknown;
				error?: { message?: string };
			};
			if (typeof frame.id !== "number") {
				continue;
			}
			const pending = this.pending.get(frame.id);
			if (!pending) {
				continue;
			}
			this.pending.delete(frame.id);
			if (frame.error) {
				pending.reject(new Error(frame.error.message ?? "MCP request failed"));
			} else {
				pending.resolve(frame.result);
			}
		}
	}

	private emitClose(error?: Error): void {
		for (const pending of this.pending.values()) {
			pending.reject(error ?? new Error("MCP transport closed"));
		}
		this.pending.clear();
		for (const listener of this.closeListeners) {
			listener(error);
		}
		this.closeListeners.clear();
	}
}

/** MCP Streamable HTTP transport (one JSON-RPC POST per request). */
export class HttpMcpTransport implements McpTransport {
	private readonly definition: McpServerDefinition;
	private readonly context: McpTransportContext;
	private readonly closeListeners = new Set<(error?: Error) => void>();
	private sessionId: string | undefined;
	private nextId = 0;
	private closed = false;

	constructor(definition: McpServerDefinition, context: McpTransportContext) {
		if (definition.transport.kind !== "http") {
			throw new Error(
				`HttpMcpTransport requires an http definition; got ${definition.transport.kind}`,
			);
		}
		validateHttpTransportDefinition(definition);
		this.definition = definition;
		this.context = context;
	}

	async start(): Promise<void> {
		await this.request("initialize", {
			protocolVersion: "2025-03-26",
			clientInfo: { name: "clinegate", version: "1" },
			capabilities: {},
		});
		await this.notify("notifications/initialized", {});
	}

	async request(method: string, params?: unknown): Promise<unknown> {
		if (this.closed) throw new Error("Transport is closed");
		this.nextId += 1;
		return this.send({
			jsonrpc: "2.0",
			id: this.nextId,
			method,
			params: params ?? {},
		});
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		for (const listener of this.closeListeners) listener();
		this.closeListeners.clear();
	}

	onClose(listener: (error?: Error) => void): () => void {
		this.closeListeners.add(listener);
		return () => this.closeListeners.delete(listener);
	}

	private async notify(method: string, params?: unknown): Promise<void> {
		await this.send({ jsonrpc: "2.0", method, params: params ?? {} }, true);
	}

	private async send(
		frame: Record<string, unknown>,
		notification = false,
	): Promise<unknown> {
		const transport = this.definition.transport;
		if (transport.kind !== "http") throw new Error("unreachable");
		const headers: Record<string, string> = {
			...transport.headers,
			Accept: "application/json, text/event-stream",
			"Content-Type": "application/json",
		};
		const hasAuthorization = Object.keys(headers).some(
			(name) => name.toLowerCase() === "authorization",
		);
		if (this.context.credential && !hasAuthorization) {
			headers.Authorization = `Bearer ${this.context.credential}`;
		}
		if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
		let response: Response;
		try {
			response = await fetch(transport.url, {
				method: "POST",
				headers,
				body: JSON.stringify(frame),
				redirect: "error",
				signal: AbortSignal.timeout(30_000),
			});
		} catch (error) {
			throw new Error(
				`MCP HTTP request failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		if (!response.ok) {
			throw new Error(
				`MCP HTTP request failed: ${response.status} ${response.statusText}`.trim(),
			);
		}
		this.sessionId = response.headers.get("mcp-session-id") ?? this.sessionId;
		if (notification || response.status === 202) return undefined;
		const contentType =
			response.headers.get("content-type")?.toLowerCase() ?? "";
		const text = await response.text();
		const payload = contentType.includes("text/event-stream")
			? parseLastSseJson(text)
			: JSON.parse(text);
		const result = payload as {
			result?: unknown;
			error?: { message?: unknown };
		};
		if (result.error) {
			throw new Error(
				typeof result.error.message === "string"
					? result.error.message
					: "MCP request failed",
			);
		}
		return result.result;
	}
}

function parseLastSseJson(value: string): unknown {
	const data = value
		.split(/\r?\n/)
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).trim())
		.filter((line) => line && line !== "[DONE]")
		.at(-1);
	if (!data)
		throw new Error("MCP HTTP response did not contain an SSE data event");
	return JSON.parse(data);
}

/** Default factory: stdio definitions get the real child transport. */
export function createStdioTransportFactory(): McpTransportFactory {
	return (definition, context) => new StdioMcpTransport(definition, context);
}

/** Default Gateway factory for every currently executable MCP transport. */
export function createMcpTransportFactory(): McpTransportFactory {
	return (definition, context) =>
		definition.transport.kind === "stdio"
			? new StdioMcpTransport(definition, context)
			: new HttpMcpTransport(definition, context);
}
