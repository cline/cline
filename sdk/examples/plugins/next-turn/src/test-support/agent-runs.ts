import { type Agent, createTool } from "@cline/core";
import type { AgentMessage, AgentRunResult } from "@cline/shared";

type RuntimeConfig = ConstructorParameters<typeof Agent>[0];
export type Model = Extract<RuntimeConfig, { model: unknown }>["model"];

let ids = 0;

export function message(
	role: AgentMessage["role"],
	content: string | AgentMessage["content"],
	extra: Partial<AgentMessage> = {},
): AgentMessage {
	ids += 1;
	return {
		id: `m${ids}`,
		role,
		content:
			typeof content === "string" ? [{ type: "text", text: content }] : content,
		createdAt: ids,
		...extra,
	};
}

export function runResult(
	messages: AgentMessage[],
	overrides: Partial<AgentRunResult> = {},
): AgentRunResult {
	return {
		agentId: "a",
		runId: "run_1",
		status: "completed",
		iterations: 1,
		outputText: "Done.",
		messages,
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
		...overrides,
	};
}

/** A completed run in which the agent edited `src/client.ts` for the request. */
export function editRun(request = "Add a retry to the client"): {
	result: AgentRunResult;
	messages: AgentMessage[];
} {
	const ask = message("user", request);
	const edit = message("assistant", [
		{
			type: "tool-call",
			toolCallId: `c${ask.createdAt}`,
			toolName: "editor",
			input: { path: "src/client.ts" },
		},
	]);
	const messages = [ask, edit];
	return {
		messages,
		result: runResult(messages, {
			runId: `run_${edit.createdAt}`,
			outputText: "Added the retry.",
		}),
	};
}

export const editorTool = createTool({
	name: "editor",
	description: "A deterministic test fixture; writes nothing.",
	inputSchema: {
		type: "object",
		properties: { path: { type: "string" } },
		additionalProperties: false,
	},
	execute: async () => "ok",
});

/** Edits `path` through the editor tool on its first call and answers in text after. */
export function editingModel(path = "src/retry.ts"): {
	model: Model;
	calls: () => number;
} {
	let calls = 0;
	return {
		calls: () => calls,
		model: {
			async *stream() {
				calls += 1;
				if (calls === 1) {
					yield {
						type: "tool-call-delta",
						index: 0,
						toolCallId: `c${calls}`,
						toolName: "editor",
						input: { path },
					};
					yield { type: "finish", reason: "tool-calls" };
				} else {
					yield { type: "text-delta", text: `Done (${calls}).` };
					yield { type: "finish", reason: "stop" };
				}
			},
		},
	};
}
