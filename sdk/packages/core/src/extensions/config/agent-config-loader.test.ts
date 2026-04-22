import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool, ToolContext } from "@clinebot/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
	AGENT_CONFIG_DIRECTORY_NAME,
	createAgentConfigDefinition,
	parseAgentConfigFromYaml,
	parsePartialAgentConfigFromYaml,
	readAgentConfigsFromDisk,
	resolveAgentConfigSearchPaths,
	resolveAgentsConfigDirPath,
	resolveAgentTools,
	toPartialAgentConfig,
} from "./agent-config-loader";

function createMockTool(name: string): Tool {
	return {
		name,
		description: `${name} tool`,
		inputSchema: {
			type: "object",
			properties: {},
		},
		execute: async (_input: unknown, _context: ToolContext) => null,
	};
}

describe("agent config YAML loader", () => {
	const envSnapshot = {
		CLINE_DIR: process.env.CLINE_DIR,
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
		HOME: process.env.HOME,
	};
	afterEach(() => {
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR;
		process.env.CLINE_DATA_DIR = envSnapshot.CLINE_DATA_DIR;
		process.env.HOME = envSnapshot.HOME;
	});

	it("resolves default global agents directory from HOME", () => {
		process.env.CLINE_DIR = "/tmp/home/.cline";
		expect(resolveAgentsConfigDirPath()).toBe(
			join("/tmp/home", ".cline", AGENT_CONFIG_DIRECTORY_NAME),
		);
	});

	it("includes workspace and global search paths", () => {
		process.env.CLINE_DIR = "/tmp/home/.cline";
		expect(resolveAgentConfigSearchPaths()).toEqual([
			join("/tmp/home", ".cline", AGENT_CONFIG_DIRECTORY_NAME),
		]);
		expect(resolveAgentConfigSearchPaths("/tmp/workspace")).toEqual([
			join("/tmp/workspace", ".cline", AGENT_CONFIG_DIRECTORY_NAME),
			join("/tmp/home", ".cline", AGENT_CONFIG_DIRECTORY_NAME),
		]);
	});

	it("builds a reusable unified watcher definition with expected defaults", () => {
		process.env.CLINE_DIR = "/tmp/home/.cline";
		const definition = createAgentConfigDefinition();
		expect(definition.type).toBe("agent");
		expect(definition.directories).toEqual([
			join("/tmp/home", ".cline", AGENT_CONFIG_DIRECTORY_NAME),
		]);
		expect(definition.includeFile?.("agent.yaml", "/tmp/agent.yaml")).toBe(
			true,
		);
		expect(definition.includeFile?.("agent.md", "/tmp/agent.md")).toBe(false);
	});

	it("parses yaml frontmatter and prompt body", () => {
		const content = `---
name: Researcher
description: Focus on repository analysis
modelId: claude-sonnet-4-6
tools:
  - read_files
  - search_codebase
skills:
  - context-gathering
---
You are a focused codebase researcher.`;

		const parsed = parseAgentConfigFromYaml(content);

		expect(parsed).toEqual({
			name: "Researcher",
			description: "Focus on repository analysis",
			modelId: "claude-sonnet-4-6",
			tools: ["read_files", "search_codebase"],
			skills: ["context-gathering"],
			systemPrompt: "You are a focused codebase researcher.",
		});
	});

	it("supports comma-separated tool and skill values", () => {
		const parsed = parseAgentConfigFromYaml(`---
name: Reviewer
description: Reviews diffs
tools: read_files,search_codebase,read_files
skills: quality, quality,architecture
---
Review every patch for regressions.`);

		expect(parsed.tools).toEqual(["read_files", "search_codebase"]);
		expect(parsed.skills).toEqual(["quality", "architecture"]);
	});

	it("throws when frontmatter is missing", () => {
		expect(() => parseAgentConfigFromYaml("No frontmatter")).toThrow(
			"Missing YAML frontmatter block in agent config file.",
		);
	});

	it("throws for unknown tools", () => {
		expect(() =>
			parseAgentConfigFromYaml(`---
name: UnknownTool
description: test
tools: invalid_tool
---
prompt`),
		).toThrow("Unknown tool 'invalid_tool'.");
	});

	it("resolves configured tool names from available tools", () => {
		const readFiles = createMockTool("read_files");
		const searchCodebase = createMockTool("search_codebase");

		expect(
			resolveAgentTools(
				["read_files", "search_codebase"],
				[searchCodebase, readFiles],
			),
		).toEqual([readFiles, searchCodebase]);
	});

	it("converts parsed config to partial AgentConfig", () => {
		const readFiles = createMockTool("read_files");
		const config = parseAgentConfigFromYaml(`---
name: Reader
description: Reads files
modelId: claude-sonnet-4-6
tools: read_files
skills: commit, review
---
Be precise.`);

		const partial = toPartialAgentConfig(config, {
			availableTools: [readFiles],
		});

		expect(partial.modelId).toBe("claude-sonnet-4-6");
		expect(partial.systemPrompt).toBe("Be precise.");
		expect(partial.tools).toEqual([readFiles]);
		expect(partial.skills).toEqual(["commit", "review"]);
	});

	it("throws when tool overrides are configured without available tools", () => {
		expect(() =>
			parsePartialAgentConfigFromYaml(`---
name: Reader
description: Reads files
tools: read_files
---
Be precise.`),
		).toThrow(
			"Configured tools cannot be converted into AgentConfig.tools without availableTools.",
		);
	});

	it("reads agent configs from ~/.cline/.agents", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-agent-config-loader-"));
		const agentsDir = join(tempRoot, ".cline", AGENT_CONFIG_DIRECTORY_NAME);
		await mkdir(agentsDir, { recursive: true });
		try {
			await writeFile(
				join(agentsDir, "reviewer.yaml"),
				`---
name: Reviewer
description: Reviews patches
tools: read_files
---
Review code for regressions.`,
			);
			await writeFile(
				join(agentsDir, "invalid.yaml"),
				`---
name:
---
`,
			);

			const loaded = await readAgentConfigsFromDisk(agentsDir);
			expect([...loaded.keys()]).toEqual(["reviewer"]);
			expect(loaded.get("reviewer")?.systemPrompt).toBe(
				"Review code for regressions.",
			);
		} finally {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	it("reads from both workspace and global directories", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-agent-config-loader-"));
		const workspaceDir = join(tempRoot, "workspace");
		const workspaceAgentsDir = join(
			workspaceDir,
			".cline",
			AGENT_CONFIG_DIRECTORY_NAME,
		);
		const globalAgentsDir = join(
			tempRoot,
			".cline",
			AGENT_CONFIG_DIRECTORY_NAME,
		);
		await mkdir(workspaceAgentsDir, { recursive: true });
		await mkdir(globalAgentsDir, { recursive: true });
		try {
			await writeFile(
				join(workspaceAgentsDir, "workspace.yaml"),
				`---
name: WorkspaceAgent
description: workspace
---
workspace prompt`,
			);
			await writeFile(
				join(globalAgentsDir, "global.yaml"),
				`---
name: GlobalAgent
description: global
---
global prompt`,
			);

			process.env.CLINE_DIR = join(tempRoot, ".cline");
			const loaded = await readAgentConfigsFromDisk(undefined, workspaceDir);
			expect([...loaded.keys()].sort()).toEqual([
				"globalagent",
				"workspaceagent",
			]);
			expect(loaded.get("workspaceagent")?.systemPrompt).toBe(
				"workspace prompt",
			);
			expect(loaded.get("globalagent")?.systemPrompt).toBe("global prompt");
		} finally {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});
});
