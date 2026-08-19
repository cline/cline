/**
 * Filtered MCP tool views (Gateway RFC, Phase 5).
 *
 * A session never talks to the pool directly: it holds leases and sees a
 * policy-filtered view of each connection's tools. Filtering applies to
 * both listing and calling — a tool hidden by policy cannot be invoked
 * through the view, even by name.
 */

import type { McpLease, McpToolDescriptor } from "./pool";

export interface McpToolPolicy {
	allowTool?(serverName: string, tool: McpToolDescriptor): boolean;
}

export class McpToolDeniedError extends Error {
	constructor(serverName: string, toolName: string) {
		super(
			`Tool "${toolName}" on MCP server "${serverName}" is not visible to this session`,
		);
		this.name = "McpToolDeniedError";
	}
}

export class SessionMcpToolView {
	private readonly lease: McpLease;
	private readonly policy: McpToolPolicy;

	constructor(lease: McpLease, policy: McpToolPolicy = {}) {
		this.lease = lease;
		this.policy = policy;
	}

	get serverName(): string {
		return this.lease.connection.definitionName;
	}

	async listTools(): Promise<readonly McpToolDescriptor[]> {
		const tools = await this.lease.connection.listTools();
		const allow = this.policy.allowTool;
		return allow ? tools.filter((tool) => allow(this.serverName, tool)) : tools;
	}

	async callTool(
		name: string,
		args?: Record<string, unknown>,
	): Promise<unknown> {
		const tools = await this.lease.connection.listTools();
		const tool = tools.find((candidate) => candidate.name === name);
		if (
			!tool ||
			(this.policy.allowTool && !this.policy.allowTool(this.serverName, tool))
		) {
			throw new McpToolDeniedError(this.serverName, name);
		}
		return this.lease.connection.callTool(name, args);
	}
}
