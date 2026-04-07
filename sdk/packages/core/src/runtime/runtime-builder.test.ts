import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@clinebot/agents";
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

describe("DefaultRuntimeBuilder", () => {
	it("includes builtin tools when enabled", () => {
		const runtime = new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
				systemPrompt: "test",
				cwd: process.cwd(),
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		});

		const names = runtime.tools.map((tool) => tool.name);
		expect(names.length).toBeGreaterThan(0);
		expect(names).not.toContain("spawn_agent");
	});

	it("forwards runtime logger for downstream agent creation", () => {
		const logger = {
			info: () => {},
		};
		const runtime = new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
				systemPrompt: "test",
				cwd: process.cwd(),
				enableTools: false,
				enableSpawnAgent: false,
				enableAgentTeams: false,
				logger,
			},
		});

		expect(runtime.logger).toBe(logger);
	});

	it("forwards telemetry for downstream runtime consumers", () => {
		const telemetry = new TelemetryService();
		const runtime = new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
				systemPrompt: "test",
				cwd: process.cwd(),
				enableTools: false,
				enableSpawnAgent: false,
				enableAgentTeams: false,
				telemetry,
			},
		});

		expect(runtime.telemetry).toBe(telemetry);
	});

	it("uses readonly preset in plan mode", () => {
		const runtime = new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
				systemPrompt: "test",
				cwd: process.cwd(),
				mode: "plan",
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		});

		const names = runtime.tools.map((tool) => tool.name);
		expect(names).not.toContain("editor");
	});

	it("uses yolo preset only when yolo mode is explicit", () => {
		const runtime = new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
				systemPrompt: "test",
				cwd: process.cwd(),
				mode: "act",
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
				yolo: true,
			},
			defaultToolExecutors: {
				submit: async () => "submitted",
			},
		});

		const names = runtime.tools.map((tool) => tool.name);
		expect(names).not.toContain("ask_question");
		expect(names).toContain("submit_and_exit");
	});

	it("does not infer yolo preset from auto-approval alone", () => {
		const runtime = new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
				systemPrompt: "test",
				cwd: process.cwd(),
				mode: "act",
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
				toolPolicies: {
					"*": { autoApprove: true },
				},
			},
			defaultToolExecutors: {
				submit: async () => "submitted",
				askQuestion: async () => "question",
			},
		});

		const names = runtime.tools.map((tool) => tool.name);
		expect(names).toContain("ask_question");
		expect(names).not.toContain("submit_and_exit");
	});

	it("uses yolo preset runtime defaults for spawn and teams", () => {
		const runtime = new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
				systemPrompt: "test",
				cwd: process.cwd(),
				mode: "act",
				enableTools: false,
				yolo: true,
			} as CoreSessionConfig,
			createSpawnTool: makeSpawnTool,
		});

		expect(runtime.tools.map((tool) => tool.name)).not.toContain("spawn_agent");
	});

	it("uses apply_patch instead of editor for codex/gpt model IDs in act mode", () => {
		const runtime = new DefaultRuntimeBuilder().build({
			config: {
				providerId: "openai",
				modelId: "openai/gpt-5.4",
				apiKey: "key",
				systemPrompt: "test",
				cwd: process.cwd(),
				mode: "act",
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		});

		const names = runtime.tools.map((tool) => tool.name);
		expect(names).toContain("apply_patch");
		expect(names).not.toContain("editor");
	});

	it("keeps editor for non-codex/non-gpt model IDs in act mode", () => {
		const runtime = new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
				systemPrompt: "test",
				cwd: process.cwd(),
				mode: "act",
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		});

		const names = runtime.tools.map((tool) => tool.name);
		expect(names).toContain("editor");
		expect(names).not.toContain("apply_patch");
	});

	it("applies custom tool routing rules from session config", () => {
		const runtime = new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
				systemPrompt: "test",
				cwd: process.cwd(),
				mode: "act",
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
				toolRoutingRules: [
					{
						mode: "act",
						providerIdIncludes: ["anthropic"],
						modelIdIncludes: ["claude"],
						enableTools: ["apply_patch"],
						disableTools: ["editor"],
					},
				],
			},
		});

		const names = runtime.tools.map((tool) => tool.name);
		expect(names).toContain("apply_patch");
		expect(names).not.toContain("editor");
	});

	it("omits builtin tools when disabled", () => {
		const runtime = new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
				systemPrompt: "test",
				cwd: process.cwd(),
				enableTools: false,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		});

		expect(runtime.tools).toEqual([]);
	});

	it("adds spawn tool when enabled", () => {
		const runtime = new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
				systemPrompt: "test",
				cwd: process.cwd(),
				enableTools: false,
				enableSpawnAgent: true,
				enableAgentTeams: false,
			},
			createSpawnTool: makeSpawnTool,
		});

		expect(runtime.tools.map((tool) => tool.name)).toContain("spawn_agent");
	});

	it("provides a shutdown helper", () => {
		const runtime = new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
				systemPrompt: "test",
				cwd: process.cwd(),
				enableTools: false,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		});

		expect(() => runtime.shutdown("test")).not.toThrow();
	});

	it("includes skills tool when workspace skills are available", () => {
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

		const runtime = new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
				systemPrompt: "test",
				cwd,
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		});

		expect(runtime.tools.map((tool) => tool.name)).toContain("skills");
		runtime.shutdown("test");
	});

	it("allows tool routing rules to disable skills even when skills exist", () => {
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

		const runtime = new DefaultRuntimeBuilder().build({
			config: {
				providerId: "openrouter",
				modelId: "google/gemini-3-flash-preview",
				apiKey: "key",
				systemPrompt: "test",
				cwd,
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
				toolRoutingRules: [
					{
						mode: "act",
						providerIdIncludes: ["openrouter"],
						modelIdIncludes: ["gemini"],
						disableTools: ["skills"],
					},
				],
			},
		});

		expect(runtime.tools.map((tool) => tool.name)).not.toContain("skills");
		runtime.shutdown("test");
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

		const runtime = new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
				systemPrompt: "test",
				cwd,
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
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

		runtime.shutdown("test");
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

		const runtime = new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
				systemPrompt: "test",
				cwd,
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
				skills: ["commit"],
			},
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

		runtime.shutdown("test");
	});
});
