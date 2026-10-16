import type { AgentTool, AgentToolContext, ToolPolicy } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type { SpawnAgentToolConfig } from "../../../extensions/tools/team";
import type { CoreSessionConfig } from "../../../types/config";
import { createSessionSpawnTool } from "./spawn-tool";

const spawnConfigs = vi.hoisted(() => [] as SpawnAgentToolConfig[]);

vi.mock("../../../extensions/tools/team", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../../extensions/tools/team")>();
	return {
		...actual,
		createSpawnAgentTool: (config: SpawnAgentToolConfig) => {
			spawnConfigs.push(config);
			return actual.createSpawnAgentTool(config);
		},
	};
});

const sessionConfig = {
	providerId: "anthropic",
	modelId: "claude-sonnet-4-6",
	cwd: process.cwd(),
	systemPrompt: "Parent session.",
	mode: "act",
	enableTools: true,
	enableSpawnAgent: true,
	enableAgentTeams: false,
} as CoreSessionConfig;

const toolContext = {
	agentId: "parent",
	conversationId: "conversation",
	iteration: 1,
} as AgentToolContext;

async function subAgentToolNames(
	toolPolicies?: Record<string, ToolPolicy>,
): Promise<string[]> {
	spawnConfigs.length = 0;
	createSessionSpawnTool(
		{
			getSession: () => undefined,
			subAgentStarts: new Map(),
			onAgentEvent: () => {},
			invokeBackendOptional: async () => {},
		},
		sessionConfig,
		"root-session",
		undefined,
		toolPolicies,
	);
	const createSubAgentTools = spawnConfigs[0]?.createSubAgentTools;
	if (!createSubAgentTools) {
		throw new Error("spawn_agent was created without a sub-agent tool factory");
	}
	const tools: AgentTool[] = await createSubAgentTools(
		{ systemPrompt: "Child.", task: "Do the task." },
		toolContext,
	);
	return tools.map((tool) => tool.name);
}

describe("createSessionSpawnTool", () => {
	it("gives sub-agents the full preset when the session has no policies", async () => {
		const names = await subAgentToolNames();

		expect(names).toEqual(
			expect.arrayContaining(["read_files", "run_commands", "spawn_agent"]),
		);
	});

	it("keeps tools the session disabled out of spawned sub-agents", async () => {
		const names = await subAgentToolNames({
			run_commands: { enabled: false },
		});

		expect(names).toContain("read_files");
		expect(names).toContain("spawn_agent");
		expect(names).not.toContain("run_commands");
	});

	it("applies a session allowlist to spawned sub-agents", async () => {
		const names = await subAgentToolNames({
			"*": { enabled: false },
			read_files: { enabled: true },
		});

		expect(names).toEqual(["read_files"]);
	});
});
