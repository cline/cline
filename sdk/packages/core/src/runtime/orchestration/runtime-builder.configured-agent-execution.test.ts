import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AgentConfig,
	type AgentEvent,
	type AgentExtension,
	type AgentTool,
	createContributionRegistry,
	type Message,
} from "@cline/shared";
import { setHomeDir } from "@cline/shared/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserInstructionConfigService } from "../../extensions/config";
import type { CoreSessionConfig } from "../../types/config";

const runMock = vi.fn();
const agentConstructorSpy = vi.fn();
let eventListeners: Array<(event: AgentEvent) => void> = [];

vi.mock("./session-runtime-orchestrator", () => {
	return {
		SessionRuntime: class MockSessionRuntime {
			constructor(config: unknown) {
				agentConstructorSpy(config);
			}

			getAgentId(): string {
				return "configured-sub-agent";
			}

			getConversationId(): string {
				return "configured-sub-conversation";
			}

			subscribeEvents(listener: (event: AgentEvent) => void): () => void {
				eventListeners.push(listener);
				return () => {
					eventListeners = eventListeners.filter((entry) => entry !== listener);
				};
			}

			async run(input: string): Promise<unknown> {
				for (const listener of eventListeners) {
					listener({
						type: "notice",
						noticeType: "status",
						message: "configured agent running",
					});
				}
				return runMock(input);
			}
		},
	};
});

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
		enableSpawnAgent: true,
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

describe("DefaultRuntimeBuilder configured agent execution", () => {
	const previousHome = process.env.HOME;
	const tempDirs: string[] = [];

	beforeEach(() => {
		vi.clearAllMocks();
		eventListeners = [];
		runMock.mockResolvedValue({
			text: "configured result",
			iterations: 2,
			finishReason: "completed",
			usage: { inputTokens: 13, outputTokens: 8 },
		});
	});

	afterEach(() => {
		process.env.HOME = previousHome;
		setHomeDir(previousHome ?? "~");
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("invokes configured agents with host callbacks, scoped tools, skills, overrides, and parent context", async () => {
		const { DefaultRuntimeBuilder } = await import("./runtime-builder");
		const tempHome = mkdtempSync(join(tmpdir(), "cline-agent-home-"));
		const workspaceRoot = mkdtempSync(join(tmpdir(), "cline-agent-root-"));
		const cwd = join(workspaceRoot, "packages", "app");
		tempDirs.push(tempHome, workspaceRoot);
		process.env.HOME = tempHome;
		setHomeDir(tempHome);
		mkdirSync(cwd, { recursive: true });

		const agentsDir = join(workspaceRoot, ".cline", "agents");
		const skillDir = join(workspaceRoot, ".cline", "skills", "commit");
		mkdirSync(agentsDir, { recursive: true });
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(agentsDir, "reviewer.yml"),
			`---
name: reviewer
description: Reviews code
tools: Execute_Command, Read_File, Use_Skill
skills: commit
providerId: openai
modelId: gpt-4.1
maxIterations: 3
---
You are a reviewer.`,
			"utf8",
		);
		writeFileSync(
			join(skillDir, "SKILL.md"),
			`---
name: commit
description: Commit messages
---
Write a concise commit message.`,
			"utf8",
		);

		const requestToolApproval = vi.fn(async () => ({ approved: true }));
		const onSubAgentEvent = vi.fn();
		const onSubAgentStart = vi.fn();
		const onSubAgentEnd = vi.fn();
		const effectiveToolPolicies = {
			"*": { autoApprove: false },
			read_files: { enabled: false },
		};
		const runtime = await new DefaultRuntimeBuilder().build({
			config: makeBaseConfig({ cwd, workspaceRoot }),
			configExtensions: [],
			toolPolicies: effectiveToolPolicies,
			requestToolApproval,
			onSubAgentEvent,
			onSubAgentStart,
			onSubAgentEnd,
		});

		expect(
			(await collectExtensionTools(runtime.extensions)).map(
				(tool) => tool.name,
			),
		).not.toContain("skills");

		const reviewer = runtime.tools.find(
			(tool) => tool.name === "subagent_reviewer",
		);
		expect(reviewer).toBeDefined();
		if (!reviewer) {
			throw new Error("Expected configured reviewer tool.");
		}

		const output = await reviewer.execute(
			{ prompt: "review this change" },
			{
				agentId: "parent-agent",
				conversationId: "parent-conversation",
				iteration: 1,
			},
		);

		expect(output).toEqual({
			text: "configured result",
			iterations: 2,
			finishReason: "completed",
			usage: { inputTokens: 13, outputTokens: 8 },
		});
		expect(runMock).toHaveBeenCalledWith("review this change");
		expect(onSubAgentStart).toHaveBeenCalledWith(
			expect.objectContaining({
				subAgentId: "configured-sub-agent",
				conversationId: "configured-sub-conversation",
				parentAgentId: "parent-agent",
				input: {
					systemPrompt: "You are a reviewer.",
					task: "review this change",
				},
			}),
		);
		expect(onSubAgentEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "notice",
				message: "configured agent running",
			}),
		);
		expect(onSubAgentEnd).toHaveBeenCalledWith(
			expect.objectContaining({
				parentAgentId: "parent-agent",
				result: output,
			}),
		);

		const delegatedConfig = agentConstructorSpy.mock.calls.at(-1)?.[0] as
			| AgentConfig
			| undefined;
		expect(delegatedConfig).toEqual(
			expect.objectContaining({
				providerId: "openai",
				modelId: "gpt-4.1",
				maxIterations: 3,
				parentAgentId: "parent-agent",
				requestToolApproval,
				toolPolicies: effectiveToolPolicies,
			}),
		);
		expect(delegatedConfig?.tools.map((tool) => tool.name).sort()).toEqual([
			"run_commands",
			"skills",
		]);

		const skillsTool = delegatedConfig?.tools.find(
			(tool) => tool.name === "skills",
		);
		expect(skillsTool).toBeDefined();
		if (!skillsTool) {
			throw new Error("Expected delegated skills tool.");
		}
		await expect(
			skillsTool.execute(
				{ skill: "commit" },
				{ agentId: "configured-sub-agent", iteration: 1 },
			),
		).resolves.toContain("<command-name>commit</command-name>");
		await expect(
			skillsTool.execute(
				{ skill: "review" },
				{ agentId: "configured-sub-agent", iteration: 1 },
			),
		).resolves.toContain('Skill "review" not found.');

		await runtime.shutdown("test");
	});

	it("does not require custom user instruction services to implement createSkillsExecutor", async () => {
		const { DefaultRuntimeBuilder } = await import("./runtime-builder");
		const workspaceRoot = mkdtempSync(join(tmpdir(), "cline-agent-compat-"));
		tempDirs.push(workspaceRoot);
		const agentsDir = join(workspaceRoot, ".cline", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(
			join(agentsDir, "reviewer.yml"),
			`---
name: reviewer
description: Reviews code
skills: commit
---
You are a reviewer.`,
			"utf8",
		);

		const legacyService = {
			start: vi.fn(async () => {}),
			stop: vi.fn(),
			refreshType: vi.fn(async () => {}),
			listRecords: vi.fn(() => []),
			listRuntimeCommands: vi.fn(() => []),
			resolveRuntimeSlashCommand: vi.fn((input: string) => input),
			hasConfiguredSkills: vi.fn(() => false),
			createExtension: vi.fn(() => ({
				name: "legacy-service",
				manifest: { capabilities: [] },
			})),
		} as unknown as UserInstructionConfigService;

		const runtime = await new DefaultRuntimeBuilder().build({
			config: makeBaseConfig({ cwd: workspaceRoot, workspaceRoot }),
			configExtensions: [],
			userInstructionService: legacyService,
		});
		const reviewer = runtime.tools.find(
			(tool) => tool.name === "subagent_reviewer",
		);
		expect(reviewer).toBeDefined();
		if (!reviewer) {
			throw new Error("Expected configured reviewer tool.");
		}

		await expect(
			reviewer.execute(
				{ prompt: "review this change" },
				{ agentId: "parent-agent", iteration: 1 },
			),
		).resolves.toEqual({
			text: "configured result",
			iterations: 2,
			finishReason: "completed",
			usage: { inputTokens: 13, outputTokens: 8 },
		});
		const delegatedConfig = agentConstructorSpy.mock.calls.at(-1)?.[0] as
			| AgentConfig
			| undefined;
		expect(delegatedConfig?.tools.map((tool) => tool.name)).not.toContain(
			"skills",
		);

		await runtime.shutdown("test");
	});
});
