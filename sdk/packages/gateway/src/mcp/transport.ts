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
			clientInfo: { name: "cline-gateway", version: "1" },
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

/** Default factory: stdio definitions get the real child transport. */
export function createStdioTransportFactory(): McpTransportFactory {
	return (definition, context) => new StdioMcpTransport(definition, context);
}
