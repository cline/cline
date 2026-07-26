import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AgentExtension,
	type AgentTool,
	createContributionRegistry,
	type Message,
} from "@cline/shared";
import { setHomeDir } from "@cline/shared/storage";
import { afterEach, describe, expect, it } from "vitest";
import { createUserInstructionConfigService } from "../../extensions/config";
import type { CoreSessionConfig } from "../../types/config";
import { DefaultRuntimeBuilder } from "./runtime-builder";

function makeSpawnTool(): AgentTool {
	return {
		name: "spawn_agent",
		description: "Spawn a subagent",
		inputSchema: { type: "object", properties: {}, required: [] },
		execute: async () => ({ ok: true }),
	};
}

function makeBaseConfig(
	overrides: Partial<CoreSessionConfig> = {},
): CoreSessionConfig {
	return {
		providerId: "anthropic",
		modelId: "claude-sonnet-4-6",
		apiKey: "key",
		systemPrompt: "test",
		cwd: process.cwd(),
		enableTools: true,
		enableSpawnAgent: false,
		enableAgentTeams: false,
		...overrides,
	};
}

async function collectExtensionTools(
	extensions?: AgentExtension[],
): Promise<AgentTool[]> {
	const registry = createContributionRegistry<
		AgentExtension,
		AgentTool,
		Message[]
	>({
		extensions: extensions ?? [],
	});
	await registry.initialize();
	return registry.getRegisteredTools();
}
