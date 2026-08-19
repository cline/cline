import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { JsonRecord } from "../types";
import { parseF64Value, parseU64Value } from "./common";

function resolveGlobalHookLogPath(): string {
	const envPath = process.env.CLINE_HOOKS_LOG_PATH?.trim();
	if (envPath) return envPath;
	const dataDir =
		process.env.CLINE_DATA_DIR?.trim() ||
		join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".cline", "data");
	return join(dataDir, "logs", "hooks.jsonl");
}

export async function readSessionHooks(
	sessionId: string,
	limit = 300,
): Promise<unknown[]> {
	const path = resolveGlobalHookLogPath();
	if (!existsSync(path)) {
		return [];
	}
	const raw = await readFile(path, "utf8");
	const max = Math.max(1, limit);
	const out: JsonRecord[] = [];
	let lineEnd = raw.length;
	for (let index = raw.length - 1; index >= -1; index -= 1) {
		if (index >= 0 && raw.charCodeAt(index) !== 10) {
			continue;
		}
		const line = raw.slice(index + 1, lineEnd).replace(/\r$/, "");
		lineEnd = index;
		if (!line.trim()) {
			continue;
		}
		try {
			const value = JSON.parse(line) as JsonRecord;

			// Filter to events belonging to this session.
			const rootSessionId =
				value.sessionContext &&
				typeof value.sessionContext === "object" &&
				typeof (value.sessionContext as JsonRecord).rootSessionId === "string"
					? ((value.sessionContext as JsonRecord).rootSessionId as string)
					: undefined;
			const eventSessionId =
				typeof value.sessionId === "string" ? value.sessionId : undefined;
			if (
				rootSessionId !== sessionId &&
				eventSessionId !== sessionId &&
				value.taskId !== sessionId
			) {
				continue;
			}

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
			if (out.length >= max) {
				break;
			}
		} catch {
			// Ignore malformed lines.
		}
	}
	return out.reverse();
}
