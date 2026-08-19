/**
 * MCP connection pool (Gateway RFC, Phase 5).
 *
 * The Gateway owns MCP server connections, their health, reconnect
 * backoff, and the tool-schema cache. Connections are pooled under the
 * scope key
 *
 *     (definitionRevision, principalId, botId?, workspaceId?, authScope)
 *
 * so two principals (or two workspaces, or two auth scopes) can never
 * share a connection — scope leaks are prevented by construction, not by
 * filtering.
 *
 * Sessions hold reference-counted leases. Releasing one lease never
 * closes a connection other leases still use. A credential or definition
 * change drains only the affected generation: existing leases keep their
 * connection until released, new acquires build a fresh connection.
 * Reconnect storms are bounded: concurrent acquires share one in-flight
 * connect, and repeated failures apply exponential backoff.
 */

import type { BotId, PrincipalId } from "@cline/shared/gateway";
import { definitionRevision, type McpServerDefinition } from "./definitions";
import type { McpTransport, McpTransportFactory } from "./transport";

export interface McpAcquireContext {
	readonly definition: McpServerDefinition;
	readonly principalId: PrincipalId;
	readonly botId?: BotId;
	readonly workspaceId?: string;
	/** Overrides the definition's authScope when provided. */
	readonly authScope?: string;
}

export function mcpPoolKey(context: McpAcquireContext): string {
	const scope = context.authScope ?? context.definition.authScope ?? "";
	return [
		definitionRevision(context.definition),
		context.principalId,
		context.botId ?? "",
		context.workspaceId ?? "",
		scope,
	].join("|");
}

export interface McpToolDescriptor {
	readonly name: string;
	readonly description?: string;
	readonly inputSchema?: unknown;
}

export interface McpClientConnection {
	readonly generation: number;
	readonly definitionName: string;
	readonly state: "ready" | "draining" | "closed";
	/** Cached `tools/list` (the schema cache); refreshed per connection. */
	listTools(): Promise<readonly McpToolDescriptor[]>;
	callTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
}

export interface McpLease {
	readonly key: string;
	readonly connection: McpClientConnection;
	release(): void;
}

export class McpConnectBackoffError extends Error {
	readonly retryAt: number;

	constructor(definitionName: string, retryAt: number) {
		super(
			`Connection to MCP server "${definitionName}" is backing off after repeated failures; retry after ${retryAt}`,
		);
		this.name = "McpConnectBackoffError";
		this.retryAt = retryAt;
	}
}

export interface McpPoolOptions {
	transportFactory: McpTransportFactory;
	/** Resolve the secret for an auth scope (Gateway-owned 0600 files). */
	resolveCredential?: (authScope: string) => string | undefined;
	clock?: () => number;
	backoff?: { baseMs?: number; maxMs?: number };
}

interface PoolEntry {
	readonly key: string;
	readonly definitionName: string;
	readonly authScope: string;
	readonly generation: number;
	state: "connecting" | "ready" | "draining" | "closed";
	transport?: McpTransport;
	connectPromise?: Promise<void>;
	toolsCache?: Promise<readonly McpToolDescriptor[]>;
	refCount: number;
	failures: number;
	nextAttemptAt: number;
	/** Connect attempts actually issued (reconnect-storm observability). */
	connectAttempts: number;
}

export class McpConnectionPool {
	private readonly options: McpPoolOptions;
	private readonly clock: () => number;
	/** Acquirable entries by key (one per key). */
	private readonly active = new Map<string, PoolEntry>();
	/** Drained-but-leased entries kept alive until their last release. */
	private readonly draining = new Set<PoolEntry>();
	private nextGeneration = 0;
	/** Per-key failure/backoff memory that outlives failed entries. */
	private readonly backoffByKey = new Map<
		string,
		{ failures: number; nextAttemptAt: number; connectAttempts: number }
	>();

	constructor(options: McpPoolOptions) {
		this.options = options;
		this.clock = options.clock ?? (() => Date.now());
	}

	/** Acquire a reference-counted lease on the pooled connection. */
	async acquire(context: McpAcquireContext): Promise<McpLease> {
		const key = mcpPoolKey(context);
		let entry = this.active.get(key);
		if (!entry || entry.state === "closed") {
			const now = this.clock();
			const backoff = this.backoffByKey.get(key);
			if (backoff && now < backoff.nextAttemptAt) {
				throw new McpConnectBackoffError(
					context.definition.name,
					backoff.nextAttemptAt,
				);
			}
			entry = this.createEntry(key, context);
			this.active.set(key, entry);
		}
		entry.refCount += 1;
		try {
			await entry.connectPromise;
		} catch (error) {
			entry.refCount -= 1;
			throw error;
		}
		return this.leaseFor(entry);
	}

	/** Definition changed: drain only connections built from it. */
	drainDefinition(definitionName: string): number {
		return this.drainWhere((entry) => entry.definitionName === definitionName);
	}

	/** Credential changed: drain only connections under that auth scope. */
	drainAuthScope(authScope: string): number {
		return this.drainWhere((entry) => entry.authScope === authScope);
	}

	stats(): {
		active: number;
		draining: number;
		byKey: Record<
			string,
			{
				state: string;
				refCount: number;
				generation: number;
				connectAttempts: number;
			}
		>;
	} {
		const byKey: Record<
			string,
			{
				state: string;
				refCount: number;
				generation: number;
				connectAttempts: number;
			}
		> = {};
		for (const entry of this.active.values()) {
			byKey[entry.key] = {
				state: entry.state,
				refCount: entry.refCount,
				generation: entry.generation,
				connectAttempts: entry.connectAttempts,
			};
		}
		return {
			active: this.active.size,
			draining: this.draining.size,
			byKey,
		};
	}

	/** Total connect attempts issued for a key (bounded-storm tests). */
	connectAttemptsFor(context: McpAcquireContext): number {
		return this.backoffByKey.get(mcpPoolKey(context))?.connectAttempts ?? 0;
	}

	async close(): Promise<void> {
		const entries = [...this.active.values(), ...this.draining];
		this.active.clear();
		this.draining.clear();
		await Promise.all(
			entries.map(async (entry) => {
				entry.state = "closed";
				await entry.transport?.close().catch(() => {});
			}),
		);
	}

	// ---------------------------------------------------------------------
	// Internals
	// ---------------------------------------------------------------------

	private createEntry(key: string, context: McpAcquireContext): PoolEntry {
		this.nextGeneration += 1;
		const authScope = context.authScope ?? context.definition.authScope ?? "";
		const entry: PoolEntry = {
			key,
			definitionName: context.definition.name,
			authScope,
			generation: this.nextGeneration,
			state: "connecting",
			refCount: 0,
			failures: this.backoffByKey.get(key)?.failures ?? 0,
			nextAttemptAt: 0,
			connectAttempts: 0,
		};
		const credential =
			authScope && this.options.resolveCredential
				? this.options.resolveCredential(authScope)
				: undefined;
		const transport = this.options.transportFactory(context.definition, {
			...(authScope ? { authScope } : {}),
			...(credential !== undefined ? { credential } : {}),
		});
		entry.transport = transport;
		transport.onClose(() => {
			// A dead connection is not acquirable; leases will surface
			// request failures and the next acquire reconnects (with backoff).
			if (entry.state !== "closed") {
				entry.state = "closed";
				if (this.active.get(key) === entry) {
					this.active.delete(key);
				}
				this.draining.delete(entry);
			}
		});
		const backoffMemory = this.ensureBackoffMemory(key);
		backoffMemory.connectAttempts += 1;
		entry.connectAttempts = backoffMemory.connectAttempts;
		// One in-flight connect shared by every concurrent acquire.
		entry.connectPromise = transport.start().then(
			() => {
				entry.state = "ready";
				backoffMemory.failures = 0;
				backoffMemory.nextAttemptAt = 0;
			},
			(error: unknown) => {
				entry.state = "closed";
				if (this.active.get(key) === entry) {
					this.active.delete(key);
				}
				backoffMemory.failures += 1;
				const baseMs = this.options.backoff?.baseMs ?? 250;
				const maxMs = this.options.backoff?.maxMs ?? 30_000;
				backoffMemory.nextAttemptAt =
					this.clock() +
					Math.min(maxMs, baseMs * 2 ** (backoffMemory.failures - 1));
				throw error instanceof Error ? error : new Error(String(error));
			},
		);
		return entry;
	}

	private ensureBackoffMemory(key: string): {
		failures: number;
		nextAttemptAt: number;
		connectAttempts: number;
	} {
		let memory = this.backoffByKey.get(key);
		if (!memory) {
			memory = { failures: 0, nextAttemptAt: 0, connectAttempts: 0 };
			this.backoffByKey.set(key, memory);
		}
		return memory;
	}

	private leaseFor(entry: PoolEntry): McpLease {
		let released = false;
		const connection: McpClientConnection = {
			get generation() {
				return entry.generation;
			},
			definitionName: entry.definitionName,
			get state() {
				return entry.state === "connecting" || entry.state === "ready"
					? ("ready" as const)
					: entry.state === "draining"
						? ("draining" as const)
						: ("closed" as const);
			},
			listTools: () => {
				if (!entry.toolsCache) {
					entry.toolsCache = (async () => {
						const result = (await entry.transport?.request("tools/list")) as
							| { tools?: unknown }
							| undefined;
						const tools = Array.isArray(result?.tools) ? result.tools : [];
						return tools
							.filter(
								(tool): tool is Record<string, unknown> =>
									typeof tool === "object" && tool !== null,
							)
							.map((tool) => ({
								name: String(tool.name ?? ""),
								...(typeof tool.description === "string"
									? { description: tool.description }
									: {}),
								...(tool.inputSchema !== undefined
									? { inputSchema: tool.inputSchema }
									: {}),
							}));
					})();
					entry.toolsCache.catch(() => {
						// A failed listing is not cached.
						entry.toolsCache = undefined;
					});
				}
				return entry.toolsCache;
			},
			callTool: async (name, args) => {
				if (entry.state === "closed") {
					throw new Error(`Connection to "${entry.definitionName}" is closed`);
				}
				return entry.transport?.request("tools/call", {
					name,
					arguments: args ?? {},
				});
			},
		};
		return {
			key: entry.key,
			connection,
			release: () => {
				if (released) {
					return;
				}
				released = true;
				entry.refCount -= 1;
				this.maybeClose(entry);
			},
		};
	}

	private drainWhere(predicate: (entry: PoolEntry) => boolean): number {
		let drained = 0;
		for (const [key, entry] of [...this.active.entries()]) {
			if (!predicate(entry)) {
				continue;
			}
			drained += 1;
			this.active.delete(key);
			// Reset backoff memory: the definition/credential changed, so a
			// fresh connection deserves a fresh start.
			this.backoffByKey.delete(key);
			if (entry.refCount > 0) {
				entry.state = "draining";
				this.draining.add(entry);
			} else {
				entry.state = "closed";
				void entry.transport?.close().catch(() => {});
			}
		}
		return drained;
	}

	private maybeClose(entry: PoolEntry): void {
		if (entry.refCount > 0) {
			return;
		}
		// Active entries stay pooled for reuse; draining entries close on
		// their last release.
		if (this.draining.has(entry)) {
			this.draining.delete(entry);
			entry.state = "closed";
			void entry.transport?.close().catch(() => {});
		}
	}
}
