/**
 * Tool Validation
 *
 * Functions for validating tools and tool inputs.
 */

import { z } from "zod";
import type { Tool } from "../types";

/**
 * Validate that all tools have unique names
 */
export function validateTools(tools: Tool[]): void {
	const names = new Set<string>();
	for (const tool of tools) {
		if (names.has(tool.name)) {
			throw new Error(`Duplicate tool name: ${tool.name}`);
		}
		names.add(tool.name);
	}
}

/**
 * Validate tool input against its schema (basic validation)
 *
 * Note: This is a simplified validation. For full JSON Schema validation,
 * consider using a library like ajv.
 */
export function validateToolInput(
	tool: Tool,
	input: unknown,
): { valid: boolean; error?: string } {
	const schema = z.fromJSONSchema(tool.inputSchema);
	if (!schema) {
		return { valid: false, error: "Input schema must be an object" };
	}
	const result = schema.safeParse(input);
	if (result.success) {
		return { valid: true };
	}
	return { valid: false, error: z.prettifyError(result.error) };
}

/**
 * Validate a tool definition
 */
export function validateToolDefinition(tool: Tool): {
	valid: boolean;
	errors: string[];
} {
	const errors: string[] = [];

	if (!tool.name || typeof tool.name !== "string") {
		errors.push("Tool must have a valid name");
	}

	if (!tool.description || typeof tool.description !== "string") {
		errors.push("Tool must have a description");
	}

	if (!tool.inputSchema || tool.inputSchema.type !== "object") {
		errors.push("Tool must have an inputSchema with type 'object'");
	}

	if (typeof tool.execute !== "function") {
		errors.push("Tool must have an execute function");
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}
