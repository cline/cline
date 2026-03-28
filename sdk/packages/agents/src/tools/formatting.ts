/**
 * Tool Result Formatting
 *
 * Functions for formatting tool results for various purposes.
 */

import type { ToolCallRecord } from "../types";

/**
 * Format a tool result for sending back to the model
 *
 * The result is serialized to a string (JSON for objects, string for primitives)
 */
export function formatToolResult(output: unknown, error?: string): string {
	if (error) {
		return JSON.stringify({ error });
	}

	if (output === null || output === undefined) {
		return "null";
	}

	if (typeof output === "string") {
		return output;
	}

	if (typeof output === "number" || typeof output === "boolean") {
		return String(output);
	}

	try {
		return JSON.stringify(output);
	} catch {
		return String(output);
	}
}

function normalizeQuery(input: unknown): unknown {
	if (input && typeof input === "object" && !Array.isArray(input)) {
		const record = input as Record<string, unknown>;
		const command =
			typeof record.command === "string" ? record.command.trim() : "";
		const path = typeof record.path === "string" ? record.path.trim() : "";
		if (command && path) {
			return `${command}:${path}`;
		}
	}
	return input;
}

function enrichToolOutput(toolName: string, output: unknown): unknown {
	if (Array.isArray(output)) {
		return output.map((entry) => enrichToolOutput(toolName, entry));
	}
	if (output && typeof output === "object") {
		return {
			toolName,
			...(output as Record<string, unknown>),
		};
	}
	return {
		toolName,
		result: output,
		success: true,
	};
}

export function formatStructuredToolResult(record: ToolCallRecord): string {
	if (record.error) {
		return JSON.stringify({
			toolName: record.name,
			query: normalizeQuery(record.input),
			result: "",
			error: record.error,
			success: false,
		});
	}

	return formatToolResult(enrichToolOutput(record.name, record.output));
}

/**
 * Format multiple tool results into a structured summary
 */
export function formatToolResultsSummary(records: ToolCallRecord[]): string {
	if (records.length === 0) {
		return "No tools were called.";
	}

	const lines = records.map((record) => {
		const status = record.error ? "FAILED" : "SUCCESS";
		const duration = `${record.durationMs}ms`;
		return `- ${record.name}: ${status} (${duration})`;
	});

	return `Tool Results:\n${lines.join("\n")}`;
}

/**
 * Format a tool call record as a detailed string
 */
export function formatToolCallRecord(record: ToolCallRecord): string {
	const lines = [
		`Tool: ${record.name}`,
		`ID: ${record.id}`,
		`Status: ${record.error ? "FAILED" : "SUCCESS"}`,
		`Duration: ${record.durationMs}ms`,
		`Started: ${record.startedAt.toISOString()}`,
		`Ended: ${record.endedAt.toISOString()}`,
	];

	if (record.error) {
		lines.push(`Error: ${record.error}`);
	}

	return lines.join("\n");
}
