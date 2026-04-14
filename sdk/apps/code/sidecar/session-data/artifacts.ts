import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
	sessionHookLogPath,
	sessionLogPath,
	sharedSessionHookPath,
	sharedSessionLogPath,
} from "../paths";
import type { JsonRecord } from "../types";
import { parseF64Value, parseU64Value } from "./common";

export async function readSessionTranscript(
	sessionId: string,
	maxChars?: number,
): Promise<string> {
	const jsonlPath = sessionLogPath(sessionId);
	const sharedPath = sharedSessionLogPath(sessionId);
	if (!existsSync(jsonlPath) && !existsSync(sharedPath)) {
		return "";
	}
	const isJsonl = existsSync(jsonlPath);
	const raw = readFileSync(isJsonl ? jsonlPath : sharedPath, "utf8");
	let out = "";
	if (isJsonl) {
		for (const line of raw.split("\n")) {
			if (!line.trim()) {
				continue;
			}
			try {
				const parsed = JSON.parse(line) as { chunk?: string };
				if (typeof parsed.chunk === "string") {
					out += parsed.chunk;
				}
			} catch {
				// Ignore malformed lines.
			}
		}
	} else {
		out = raw;
	}
	if (typeof maxChars === "number" && maxChars > 0 && out.length > maxChars) {
		return out.slice(-maxChars);
	}
	return out;
}

export async function readSessionHooks(
	sessionId: string,
	limit = 300,
): Promise<unknown[]> {
	const path = existsSync(sessionHookLogPath(sessionId))
		? sessionHookLogPath(sessionId)
		: sharedSessionHookPath(sessionId);
	if (!existsSync(path)) {
		return [];
	}
	const raw = await readFile(path, "utf8");
	const out: JsonRecord[] = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) {
			continue;
		}
		try {
			const value = JSON.parse(line) as JsonRecord;
			const hookName =
				(typeof value.hookName === "string" && value.hookName) ||
				(typeof value.hook_event_name === "string" && value.hook_event_name) ||
				(typeof value.event === "string" && value.event) ||
				"";
			if (!hookName) {
				continue;
			}
			const usage =
				(value.turn &&
				typeof value.turn === "object" &&
				(value.turn as JsonRecord).usage &&
				typeof (value.turn as JsonRecord).usage === "object"
					? ((value.turn as JsonRecord).usage as JsonRecord)
					: undefined) ||
				(value.usage && typeof value.usage === "object"
					? (value.usage as JsonRecord)
					: undefined) ||
				(value.turn_usage && typeof value.turn_usage === "object"
					? (value.turn_usage as JsonRecord)
					: undefined);
			out.push({
				ts: typeof value.ts === "string" ? value.ts : "",
				hookName,
				agentId: value.agent_id,
				taskId: value.taskId ?? value.conversation_id,
				parentAgentId: value.parent_agent_id,
				iteration: parseU64Value(value.iteration),
				toolName:
					(value.tool_call &&
						typeof value.tool_call === "object" &&
						(value.tool_call as JsonRecord).name) ||
					(value.tool_result &&
						typeof value.tool_result === "object" &&
						(value.tool_result as JsonRecord).name),
				toolInput:
					(value.tool_call &&
						typeof value.tool_call === "object" &&
						(value.tool_call as JsonRecord).input) ||
					(value.tool_result &&
						typeof value.tool_result === "object" &&
						(value.tool_result as JsonRecord).input),
				toolOutput:
					value.tool_result && typeof value.tool_result === "object"
						? (value.tool_result as JsonRecord).output
						: undefined,
				toolError:
					value.tool_result && typeof value.tool_result === "object"
						? (value.tool_result as JsonRecord).error
						: undefined,
				inputTokens:
					parseU64Value(usage?.inputTokens) ??
					parseU64Value(usage?.input_tokens) ??
					parseU64Value(usage?.prompt_tokens),
				outputTokens:
					parseU64Value(usage?.outputTokens) ??
					parseU64Value(usage?.output_tokens) ??
					parseU64Value(usage?.completion_tokens),
				totalCost:
					parseF64Value(usage?.totalCost) ??
					parseF64Value(usage?.total_cost) ??
					parseF64Value(usage?.cost),
			});
		} catch {
			// Ignore malformed lines.
		}
	}
	return out.slice(-Math.max(1, limit));
}
