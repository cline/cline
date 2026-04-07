import type { ToolPolicy } from "@clinebot/shared";
import { defaultMcpToolNameTransform } from "./name-transform";
import type { McpToolNameTransform } from "./types";

export interface CreateDisabledMcpToolPolicyOptions {
	serverName: string;
	toolName: string;
	nameTransform?: McpToolNameTransform;
}

export interface CreateDisabledMcpToolPoliciesOptions {
	serverName: string;
	toolNames: readonly string[];
	nameTransform?: McpToolNameTransform;
}

export function createDisabledMcpToolPolicy(
	options: CreateDisabledMcpToolPolicyOptions,
): Record<string, ToolPolicy> {
	const nameTransform = options.nameTransform ?? defaultMcpToolNameTransform;
	const name = nameTransform({
		serverName: options.serverName,
		toolName: options.toolName,
	});
	return {
		[name]: {
			enabled: false,
		},
	};
}

export function createDisabledMcpToolPolicies(
	options: CreateDisabledMcpToolPoliciesOptions,
): Record<string, ToolPolicy> {
	const policies: Record<string, ToolPolicy> = {};
	for (const toolName of options.toolNames) {
		Object.assign(
			policies,
			createDisabledMcpToolPolicy({
				serverName: options.serverName,
				toolName,
				nameTransform: options.nameTransform,
			}),
		);
	}
	return policies;
}
