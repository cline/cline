/**
 * Tool Registry
 *
 * Utilities for managing collections of tools.
 */

import type { Tool } from "../types";

/**
 * Create a map of tools by name for quick lookup
 */
export function createToolRegistry(tools: Tool[]): Map<string, Tool> {
	const registry = new Map<string, Tool>();
	for (const tool of tools) {
		if (registry.has(tool.name)) {
			throw new Error(`Duplicate tool name: ${tool.name}`);
		}
		registry.set(tool.name, tool);
	}
	return registry;
}

/**
 * Get a tool by name from the registry
 */
export function getTool(
	registry: Map<string, Tool>,
	name: string,
): Tool | undefined {
	return registry.get(name);
}

/**
 * Check if a tool exists in the registry
 */
export function hasTool(registry: Map<string, Tool>, name: string): boolean {
	return registry.has(name);
}

/**
 * Get all tool names from the registry
 */
export function getToolNames(registry: Map<string, Tool>): string[] {
	return Array.from(registry.keys());
}

/**
 * Get all tools from the registry
 */
export function getAllTools(registry: Map<string, Tool>): Tool[] {
	return Array.from(registry.values());
}
