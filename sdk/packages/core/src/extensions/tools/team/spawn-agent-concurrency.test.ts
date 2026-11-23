import { AgentRuntime } from "@cline/agents";
import type { AgentConfig, AgentModel, AgentTool } from "@cline/shared";
import { expect, it, vi } from "vitest";
import { createAgentRuntimeConfig } from "../../../runtime/config/agent-runtime-config-builder";
import { createDelegatedAgentConfigProvider } from "./delegated-agent";
import { createSpawnAgentTool } from "./spawn-agent-tool";

const childRun = vi.hoisted(() => vi.fn());
vi.mock("../../../runtime/orchestration/session-runtime-orchestrator", () => ({
	SessionRuntime: class {
		getAgentId() {
			return "child";
		}
		getConversationId() {
			return "child-conversation";
		}
		subscribeEvents() {
			return () => {};
		}
		run(input: string) {
			return childRun(input);
		}
	},
}));

it.each([
	undefined,
	2,
])("runs spawn calls concurrently with maxParallelToolCalls=%s", async (maxParallelToolCalls) => {
	let markFirstStarted!: () => void;
	const firstStarted = new Promise<void>((resolve) => {
		markFirstStarted = resolve;
	});
	let releaseFirst!: () => void;
	const gate = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});
	const events: string[] = [];
	let active = 0;
	let peak = 0;
	childRun.mockImplementation(async (task: string) => {
		active++;
		peak = Math.max(peak, active);
		events.push(`start:${task}`);
		if (task === "first") {
			markFirstStarted();
			await gate;
		}
		events.push(`end:${task}`);
		active--;
		return {
			text: task,
			iterations: 1,
			finishReason: "completed",
			usage: { inputTokens: 0, outputTokens: 0 },
		};
	});
	const spawn = createSpawnAgentTool({
		configProvider: createDelegatedAgentConfigProvider({
			providerId: "test",
			modelId: "test",
		}),
	});
	let requests = 0;
	const model: AgentModel = {
		async *stream() {
			requests++;
			if (requests === 1) {
				for (const task of ["first", "second"])
					yield {
						type: "tool-call-delta",
						toolCallId: task,
						toolName: "spawn_agent",
						inputText: JSON.stringify({ task, systemPrompt: "test" }),
					};
				yield { type: "finish", reason: "tool-calls" };
			} else {
				yield { type: "text-delta", text: "done" };
				yield { type: "finish", reason: "stop" };
			}
		},
	};
	const agentConfig: AgentConfig = {
		providerId: "test",
		modelId: "test",
		systemPrompt: "test",
		tools: [spawn as AgentTool],
		maxParallelToolCalls,
	};
	const config = createAgentRuntimeConfig({
		agentConfig,
		agentId: "parent",
		model,
		tools: [spawn as AgentTool],
		completionPolicy: null,
	});
	const run = new AgentRuntime(config).run("Delegate two tasks");
	try {
		await firstStarted;
		await vi.waitFor(() => expect(events).toContain("start:second"));
	} finally {
		releaseFirst();
	}
	expect((await run).status).toBe("completed");
	expect(peak).toBe(2);
	expect(events.indexOf("start:second")).toBeLessThan(
		events.indexOf("end:first"),
	);
});
