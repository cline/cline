import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@clinebot/agents";
import { describe, expect, it } from "vitest";
import { createBuiltinTools } from "../tools";
import { DefaultRuntimeBuilder } from "./runtime-builder";

type LegacyConfig = {
	providerId: string;
	modelId: string;
	apiKey: string;
	systemPrompt: string;
	cwd: string;
	enableTools: boolean;
	enableSpawnAgent: boolean;
	enableAgentTeams: boolean;
};

function legacyBuiltinTools(cwd: string): Tool[] {
	return createBuiltinTools({
		cwd,
		enableReadFiles: true,
		enableSearch: true,
		enableBash: true,
		enableWebFetch: true,
	});
}

function legacyBuildRuntimeEnvironment(
	config: LegacyConfig,
	createSpawnTool?: () => Tool,
): Tool[] {
	const tools: Tool[] = [];
	if (config.enableTools) {
		tools.push(...legacyBuiltinTools(config.cwd));
	}
	if (config.enableSpawnAgent && createSpawnTool) {
		const spawnTool = createSpawnTool();
		tools.push({
			...spawnTool,
			execute: async (input, context) => spawnTool.execute(input, context),
		});
	}
	return tools;
}

function normalizeParityToolNames(toolNames: string[]): string[] {
	// Skills are discovered from user/workspace config and can appear in tests
	// depending on the machine state. MCP tools may also be configured outside
	// the test workspace. They are intentionally excluded from strict legacy
	// parity checks.
	return toolNames.filter(
		(toolName) => toolName !== "skills" && !toolName.includes("__"),
	);
}

function makeEmptyWorkspaceCwd(): string {
	return mkdtempSync(join(tmpdir(), "runtime-parity-"));
}

function makeSpawnTool(): Tool {
	return {
		name: "spawn_agent",
		description: "Spawn a subagent",
		inputSchema: { type: "object", properties: {}, required: [] },
		execute: async () => ({ ok: true }),
	};
}

describe("runtime tool parity", () => {
	it("matches legacy tool list when tools+spawn are enabled", async () => {
		const config: LegacyConfig = {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: "key",
			systemPrompt: "test",
			cwd: makeEmptyWorkspaceCwd(),
			enableTools: true,
			enableSpawnAgent: true,
			enableAgentTeams: false,
		};
		const createSpawnTool = makeSpawnTool;
		const expected = normalizeParityToolNames(
			legacyBuildRuntimeEnvironment(config, createSpawnTool).map(
				(tool) => tool.name,
			),
		);
		const runtime = await new DefaultRuntimeBuilder().build({
			config,
			createSpawnTool,
		});
		const actual = runtime.tools.map((tool) => tool.name);

		expect(normalizeParityToolNames(actual)).toEqual(expected);
	});

	it("matches legacy tool list when only spawn is enabled", async () => {
		const config: LegacyConfig = {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: "key",
			systemPrompt: "test",
			cwd: makeEmptyWorkspaceCwd(),
			enableTools: false,
			enableSpawnAgent: true,
			enableAgentTeams: false,
		};
		const createSpawnTool = makeSpawnTool;
		const expected = normalizeParityToolNames(
			legacyBuildRuntimeEnvironment(config, createSpawnTool).map(
				(tool) => tool.name,
			),
		);
		const runtime = await new DefaultRuntimeBuilder().build({
			config,
			createSpawnTool,
		});
		const actual = runtime.tools.map((tool) => tool.name);

		expect(normalizeParityToolNames(actual)).toEqual(expected);
	});

	it("matches legacy tool list when tools+spawn are disabled", async () => {
		const config: LegacyConfig = {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: "key",
			systemPrompt: "test",
			cwd: makeEmptyWorkspaceCwd(),
			enableTools: false,
			enableSpawnAgent: false,
			enableAgentTeams: false,
		};
		const expected = normalizeParityToolNames(
			legacyBuildRuntimeEnvironment(config).map((tool) => tool.name),
		);
		const runtime = await new DefaultRuntimeBuilder().build({ config });
		const actual = runtime.tools.map((tool) => tool.name);

		expect(normalizeParityToolNames(actual)).toEqual(expected);
	});
});
