import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@clinebot/shared";
import { describe, expect, it } from "vitest";
import { TelemetryService } from "../telemetry/TelemetryService";
import type { CoreSessionConfig } from "../types/config";
import { DefaultRuntimeBuilder } from "./runtime-builder";

function makeSpawnTool(): Tool {
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

describe("DefaultRuntimeBuilder", () => {
	it("includes builtin tools when enabled", async () => {
		const runtime = await new DefaultRuntimeBuilder().build({
			config: makeBaseConfig(),
		});

		const names = runtime.tools.map((tool) => tool.name);
		expect(names.length).toBeGreaterThan(0);
		expect(names).not.toContain("spawn_agent");
	});

	it("forwards runtime logger for downstream agent creation", async () => {
		const logger = {
			info: () => {},
		};
		const runtime = await new DefaultRuntimeBuilder().build({
			config: makeBaseConfig({
				enableTools: false,
				logger,
			}),
		});

		expect(runtime.logger).toBe(logger);
	});

	it("forwards telemetry for downstream runtime consumers", async () => {
		const telemetry = new TelemetryService();
		const runtime = await new DefaultRuntimeBuilder().build({
			config: makeBaseConfig({
				enableTools: false,
				telemetry,
			}),
		});

		expect(runtime.telemetry).toBe(telemetry);
	});

	it("uses readonly preset in plan mode", async () => {
		const runtime = await new DefaultRuntimeBuilder().build({
			config: makeBaseConfig({
				mode: "plan",
			}),
		});

		expect(runtime.tools.map((tool) => tool.name)).not.toContain("editor");
	});

	it("uses yolo preset only when yolo mode is explicit", async () => {
		const runtime = await new DefaultRuntimeBuilder().build({
			config: makeBaseConfig({
				mode: "act",
				yolo: true,
			}),
			defaultToolExecutors: {
				submit: async () => "submitted",
			},
		});

		const names = runtime.tools.map((tool) => tool.name);
		expect(names).not.toContain("ask_question");
		expect(names).toContain("submit_and_exit");
	});

	it("does not infer yolo preset from auto-approval alone", async () => {
		const runtime = await new DefaultRuntimeBuilder().build({
			config: makeBaseConfig({
				mode: "act",
				toolPolicies: {
					"*": { autoApprove: true },
				},
			}),
			defaultToolExecutors: {
				submit: async () => "submitted",
				askQuestion: async () => "question",
			},
		});

		const names = runtime.tools.map((tool) => tool.name);
		expect(names).toContain("ask_question");
		expect(names).not.toContain("submit_and_exit");
	});

	it("uses yolo preset runtime defaults for spawn and teams", async () => {
		const runtime = await new DefaultRuntimeBuilder().build({
			config: {
				...makeBaseConfig({
					enableTools: false,
					yolo: true,
				}),
			} as CoreSessionConfig,
			createSpawnTool: makeSpawnTool,
		});

		expect(runtime.tools.map((tool) => tool.name)).not.toContain("spawn_agent");
	});

	it("uses apply_patch instead of editor for codex/gpt model IDs in act mode", async () => {
		const runtime = await new DefaultRuntimeBuilder().build({
			config: makeBaseConfig({
				providerId: "openai",
				modelId: "openai/gpt-5.4",
				mode: "act",
			}),
		});

		const names = runtime.tools.map((tool) => tool.name);
		expect(names).toContain("apply_patch");
		expect(names).not.toContain("editor");
	});

	it("keeps editor for non-codex/non-gpt model IDs in act mode", async () => {
		const runtime = await new DefaultRuntimeBuilder().build({
			config: makeBaseConfig({
				mode: "act",
			}),
		});

		const names = runtime.tools.map((tool) => tool.name);
		expect(names).toContain("editor");
		expect(names).not.toContain("apply_patch");
	});

	it("applies custom tool routing rules from session config", async () => {
		const runtime = await new DefaultRuntimeBuilder().build({
			config: makeBaseConfig({
				mode: "act",
				toolRoutingRules: [
					{
						mode: "act",
						providerIdIncludes: ["anthropic"],
						modelIdIncludes: ["claude"],
						enableTools: ["apply_patch"],
						disableTools: ["editor"],
					},
				],
			}),
		});

		const names = runtime.tools.map((tool) => tool.name);
		expect(names).toContain("apply_patch");
		expect(names).not.toContain("editor");
	});

	it("omits builtin tools when disabled", async () => {
		const runtime = await new DefaultRuntimeBuilder().build({
			config: makeBaseConfig({
				enableTools: false,
			}),
		});

		expect(runtime.tools).toEqual([]);
	});

	it("adds spawn tool when enabled", async () => {
		const runtime = await new DefaultRuntimeBuilder().build({
			config: makeBaseConfig({
				enableTools: false,
				enableSpawnAgent: true,
			}),
			createSpawnTool: makeSpawnTool,
		});

		expect(runtime.tools.map((tool) => tool.name)).toContain("spawn_agent");
	});

	it("provides a shutdown helper", async () => {
		const runtime = await new DefaultRuntimeBuilder().build({
			config: makeBaseConfig({
				enableTools: false,
			}),
		});

		await expect(runtime.shutdown("test")).resolves.toBeUndefined();
	});

	it("includes MCP tools from configured servers", async () => {
		const tempRoot = mkdtempSync(join(tmpdir(), "runtime-builder-mcp-"));
		const serverPath = join(tempRoot, "mock-mcp-server.js");
		const settingsPath = join(tempRoot, "cline_mcp_settings.json");
		const previousSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;

		writeFileSync(
			serverPath,
			`let buffer = "";
function write(payload) {
  const body = JSON.stringify(payload);
  process.stdout.write("Content-Length: " + Buffer.byteLength(body, "utf8") + "\\r\\n\\r\\n" + body);
}
function handle(message) {
  if (message.method === "initialize") {
    write({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "mock", version: "1.0.0" } } });
    return;
  }
  if (message.method === "tools/list") {
    write({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "echo", description: "Echo tool", inputSchema: { type: "object", properties: { value: { type: "string" } }, required: [] } }] } });
    return;
  }
  if (message.method === "tools/call") {
    write({ jsonrpc: "2.0", id: message.id, result: { echoed: message.params?.arguments?.value ?? null } });
  }
}
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  while (true) {
    const separator = buffer.indexOf("\\r\\n\\r\\n");
    if (separator < 0) break;
    const header = buffer.slice(0, separator);
    const match = header.match(/Content-Length:\\s*(\\d+)/i);
    if (!match) throw new Error("missing content length");
    const length = Number(match[1]);
    const start = separator + 4;
    const end = start + length;
    if (buffer.length < end) break;
    const body = buffer.slice(start, end);
    buffer = buffer.slice(end);
    const message = JSON.parse(body);
    if (message.method === "notifications/initialized") continue;
    handle(message);
  }
});`,
			"utf8",
		);
		writeFileSync(
			settingsPath,
			JSON.stringify(
				{
					mcpServers: {
						mock: {
							command: process.execPath,
							args: [serverPath],
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		try {
			const runtime = await new DefaultRuntimeBuilder().build({
				config: makeBaseConfig(),
			});
			expect(runtime.tools.map((tool) => tool.name)).toContain("mock__echo");
			await runtime.shutdown("test");
		} finally {
			process.env.CLINE_MCP_SETTINGS_PATH = previousSettingsPath;
		}
	});

	it("rejects malformed MCP server responses without crashing", async () => {
		const tempRoot = mkdtempSync(join(tmpdir(), "runtime-builder-mcp-bad-"));
		const serverPath = join(tempRoot, "malformed-mcp-server.js");
		const settingsPath = join(tempRoot, "cline_mcp_settings.json");
		const previousSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;

		writeFileSync(
			serverPath,
			`process.stdin.once("data", () => {
  process.stdout.write("Content-Length: 2\\r\\n\\r\\n{]");
});`,
			"utf8",
		);
		writeFileSync(
			settingsPath,
			JSON.stringify(
				{
					mcpServers: {
						broken: {
							command: process.execPath,
							args: [serverPath],
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		try {
			await expect(
				new DefaultRuntimeBuilder().build({
					config: makeBaseConfig(),
				}),
			).rejects.toThrow(/Invalid MCP response/);
		} finally {
			process.env.CLINE_MCP_SETTINGS_PATH = previousSettingsPath;
		}
	});

	it("includes skills tool when workspace skills are available", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "runtime-builder-skills-"));
		const skillDir = join(cwd, ".cline", "skills", "commit");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			`---
name: commit
description: Create commit message
---
Use conventional commits.`,
			"utf8",
		);

		const runtime = await new DefaultRuntimeBuilder().build({
			config: makeBaseConfig({ cwd }),
		});

		expect(runtime.tools.map((tool) => tool.name)).toContain("skills");
		await runtime.shutdown("test");
	});

	it("allows tool routing rules to disable skills even when skills exist", async () => {
		const cwd = mkdtempSync(
			join(tmpdir(), "runtime-builder-skills-routing-disabled-"),
		);
		const skillDir = join(cwd, ".cline", "skills", "commit");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			`---
name: commit
description: Create commit message
---
Use conventional commits.`,
			"utf8",
		);

		const runtime = await new DefaultRuntimeBuilder().build({
			config: makeBaseConfig({
				providerId: "openrouter",
				modelId: "google/gemini-3-flash-preview",
				cwd,
				toolRoutingRules: [
					{
						mode: "act",
						providerIdIncludes: ["openrouter"],
						modelIdIncludes: ["gemini"],
						disableTools: ["skills"],
					},
				],
			}),
		});

		expect(runtime.tools.map((tool) => tool.name)).not.toContain("skills");
		await runtime.shutdown("test");
	});

	it("marks configured but disabled skills in executor metadata", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "runtime-builder-skills-disabled-"));
		const enabledDir = join(cwd, ".cline", "skills", "commit");
		const disabledDir = join(cwd, ".cline", "skills", "review");
		mkdirSync(enabledDir, { recursive: true });
		mkdirSync(disabledDir, { recursive: true });
		writeFileSync(
			join(enabledDir, "SKILL.md"),
			`---
name: commit
---
Enabled skill.`,
			"utf8",
		);
		writeFileSync(
			join(disabledDir, "SKILL.md"),
			`---
name: review
disabled: true
---
Disabled skill.`,
			"utf8",
		);

		const runtime = await new DefaultRuntimeBuilder().build({
			config: makeBaseConfig({ cwd }),
		});

		const skillsTool = runtime.tools.find((tool) => tool.name === "skills");
		expect(skillsTool).toBeDefined();
		if (!skillsTool) {
			throw new Error("Expected skills tool.");
		}

		const disabledResult = await skillsTool.execute(
			{ skill: "review" },
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);
		expect(disabledResult).toContain("configured but disabled");

		await runtime.shutdown("test");
	});

	it("scopes skills tool to session-configured skills", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "runtime-builder-skills-scoped-"));
		const commitDir = join(cwd, ".cline", "skills", "commit");
		const reviewDir = join(cwd, ".cline", "skills", "review");
		mkdirSync(commitDir, { recursive: true });
		mkdirSync(reviewDir, { recursive: true });
		writeFileSync(
			join(commitDir, "SKILL.md"),
			`---
name: commit
---
Commit skill.`,
			"utf8",
		);
		writeFileSync(
			join(reviewDir, "SKILL.md"),
			`---
name: review
---
Review skill.`,
			"utf8",
		);

		const runtime = await new DefaultRuntimeBuilder().build({
			config: makeBaseConfig({
				cwd,
				skills: ["commit"],
			}),
		});

		const skillsTool = runtime.tools.find((tool) => tool.name === "skills");
		expect(skillsTool).toBeDefined();
		if (!skillsTool) {
			throw new Error("Expected skills tool.");
		}

		const known = await skillsTool.execute(
			{ skill: "commit" },
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);
		expect(known).toContain("<command-name>commit</command-name>");

		const blocked = await skillsTool.execute(
			{ skill: "review" },
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);
		expect(blocked).toContain('Skill "review" not found.');
		expect(blocked).toContain("Available skills: commit");

		await runtime.shutdown("test");
	});
});
