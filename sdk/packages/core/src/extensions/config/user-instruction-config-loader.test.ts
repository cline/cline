import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
	resolveGlobalAgentsRulesPath,
	setHomeDir,
} from "@cline/shared/storage";
import { afterEach, describe, expect, it } from "vitest";
import {
	createRulesConfigDefinition,
	createSkillsConfigDefinition,
	createUserInstructionConfigWatcher,
	createWorkflowsConfigDefinition,
	parseRuleConfigFromMarkdown,
	parseSkillConfigFromMarkdown,
	parseWorkflowConfigFromMarkdown,
	resolveRulesConfigSearchPaths,
	resolveSkillsConfigSearchPaths,
	resolveWorkflowsConfigSearchPaths,
	type UserInstructionConfigWatcherEvent,
} from "./user-instruction-config-loader";

const WAIT_TIMEOUT_MS = 4_000;
const WAIT_INTERVAL_MS = 25;

async function waitForEvent(
	events: Array<UserInstructionConfigWatcherEvent>,
	predicate: (event: UserInstructionConfigWatcherEvent) => boolean,
	timeoutMs = WAIT_TIMEOUT_MS,
): Promise<UserInstructionConfigWatcherEvent> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		const match = events.find(predicate);
		if (match) {
			return match;
		}
		await new Promise((resolve) => setTimeout(resolve, WAIT_INTERVAL_MS));
	}
	throw new Error("Timed out waiting for watcher event.");
}

describe("user instruction config loader", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
		);
		tempRoots.length = 0;
	});

	it("resolves legacy-compatible default search paths", () => {
		const workspacePath = "/repo/demo";
		expect(resolveSkillsConfigSearchPaths(workspacePath)).toEqual(
			expect.arrayContaining([
				join(workspacePath, ".clinerules", "skills"),
				join(workspacePath, ".cline", "skills"),
				join(workspacePath, ".agents", "skills"),
			]),
		);
		expect(resolveRulesConfigSearchPaths(workspacePath)).toEqual(
			expect.arrayContaining([
				join(workspacePath, "AGENTS.md"),
				join(workspacePath, ".clinerules"),
				join(workspacePath, ".cline", "rules"),
			]),
		);
		expect(
			resolveRulesConfigSearchPaths(workspacePath).some((path) =>
				path.endsWith(join(".agents", "AGENTS.md")),
			),
		).toBe(true);
		const paths = resolveWorkflowsConfigSearchPaths(workspacePath);
		expect(paths).toContain(join(workspacePath, ".clinerules", "workflows"));
		expect(paths).toContain(join(workspacePath, ".cline", "workflows"));
		expect(
			paths.some(
				(p) =>
					p.includes("Documents") &&
					p.includes("Cline") &&
					p.includes("Workflows"),
			),
		).toBe(true);
		expect(paths).not.toContain(
			join(process.env.HOME ?? "~", ".cline", "data", "workflows"),
		);
	});

	it("discovers managed plugin instruction roots from workspace .cline manifests", () => {
		const workspacePath = "/repo/demo";
		expect(
			createSkillsConfigDefinition({ workspacePath }).directories,
		).toContain(join(workspacePath, ".cline"));
		expect(
			createRulesConfigDefinition({ workspacePath }).directories,
		).toContain(join(workspacePath, ".cline"));
		expect(
			createWorkflowsConfigDefinition({ workspacePath }).directories,
		).toContain(join(workspacePath, ".cline"));
	});

	it("parses markdown frontmatter for skill, rule, and workflow configs", () => {
		const skill = parseSkillConfigFromMarkdown(
			`---
name: debugging
description: Use structured debugging
disabled: true
---
Follow the debugging checklist.`,
			"fallback",
		);
		expect(skill.name).toBe("debugging");
		expect(skill.description).toBe("Use structured debugging");
		expect(skill.disabled).toBe(true);
		expect(skill.instructions).toBe("Follow the debugging checklist.");

		const rule = parseRuleConfigFromMarkdown(
			`---
name: rule-a
disabled: true
---
Always run tests before merge.`,
			"rule-a",
		);
		expect(rule.name).toBe("rule-a");
		expect(rule.disabled).toBe(true);

		const workflow = parseWorkflowConfigFromMarkdown(
			`---
name: release
disabled: true
---
Document rollout and rollback steps.`,
			"release",
		);
		expect(workflow.name).toBe("release");
		expect(workflow.disabled).toBe(true);
	});

	it("emits typed events for skills, rules, and workflows in one watcher", async () => {
		const tempRoot = await mkdtemp(
			join(tmpdir(), "core-user-instructions-loader-"),
		);
		tempRoots.push(tempRoot);
		const skillsDir = join(tempRoot, "skills");
		const rulesDir = join(tempRoot, "rules");
		const workflowsDir = join(tempRoot, "workflows");
		await mkdir(join(skillsDir, "incident-response"), { recursive: true });
		await mkdir(rulesDir, { recursive: true });
		await mkdir(workflowsDir, { recursive: true });

		await writeFile(
			join(skillsDir, "incident-response", "SKILL.md"),
			`---
name: incident-response
description: Handle incidents fast
---
Escalation runbook`,
		);
		await writeFile(
			join(rulesDir, "default.md"),
			"Keep changes minimal and tested.",
		);
		await writeFile(
			join(workflowsDir, "release.md"),
			"Ship with release checklist.",
		);

		const watcher = createUserInstructionConfigWatcher({
			skills: { directories: [skillsDir] },
			rules: { directories: [rulesDir] },
			workflows: { directories: [workflowsDir] },
		});

		const events: Array<UserInstructionConfigWatcherEvent> = [];
		const unsubscribe = watcher.subscribe((event) => events.push(event));

		try {
			await watcher.refreshAll();
			await waitForEvent(
				events,
				(event) => event.kind === "upsert" && event.record.type === "skill",
			);
			await waitForEvent(
				events,
				(event) => event.kind === "upsert" && event.record.type === "rule",
			);
			await waitForEvent(
				events,
				(event) => event.kind === "upsert" && event.record.type === "workflow",
			);
		} finally {
			unsubscribe();
		}
	});

	it("loads global and workspace AGENTS.md rules without clobbering either source", async () => {
		const tempRoot = await mkdtemp(
			join(tmpdir(), "core-user-instructions-agents-"),
		);
		tempRoots.push(tempRoot);

		const originalHomeDir = process.env.HOME?.trim() || homedir();
		setHomeDir(join(tempRoot, "home"));
		const globalAgentsPath = resolveGlobalAgentsRulesPath();
		const fallbackAgentsDir = join(tempRoot, "other", ".agents");
		const workspaceRoot = join(tempRoot, "workspace");
		await mkdir(join(tempRoot, "home", ".agents"), { recursive: true });
		await mkdir(fallbackAgentsDir, { recursive: true });
		await mkdir(workspaceRoot, { recursive: true });
		const fallbackAgentsPath = join(fallbackAgentsDir, "AGENTS.md");
		const workspaceAgentsPath = join(workspaceRoot, "AGENTS.md");
		await writeFile(globalAgentsPath, "Use global AGENTS rules.");
		await writeFile(fallbackAgentsPath, "Use fallback AGENTS rules.");
		await writeFile(workspaceAgentsPath, "Use workspace AGENTS rules.");

		const watcher = createUserInstructionConfigWatcher({
			rules: {
				directories: [
					globalAgentsPath,
					workspaceAgentsPath,
					fallbackAgentsPath,
				],
				workspacePath: workspaceRoot,
			},
		});

		try {
			await watcher.refreshAll();
			const rules = watcher.getSnapshot("rule");

			expect(rules.get("global agents.md")?.item.instructions).toBe(
				"Use global AGENTS rules.",
			);
			expect(rules.get("workspace agents.md")?.item.instructions).toBe(
				"Use workspace AGENTS rules.",
			);
			expect(rules.get("agents")?.item.instructions).toBe(
				"Use fallback AGENTS rules.",
			);
		} finally {
			setHomeDir(originalHomeDir);
		}
	});

	it.skipIf(process.platform === "win32")(
		"discovers skill directories through symlinks",
		async () => {
			const tempRoot = await mkdtemp(
				join(tmpdir(), "core-user-instructions-symlink-skill-"),
			);
			tempRoots.push(tempRoot);
			const skillsDir = join(tempRoot, ".cline", "skills");
			const externalSkillsDir = join(tempRoot, "external-skills");
			const targetSkillDir = join(externalSkillsDir, "data-agent-skill");
			const linkedSkillDir = join(skillsDir, "data-agent-skill");
			await mkdir(targetSkillDir, { recursive: true });
			await mkdir(skillsDir, { recursive: true });
			await writeFile(
				join(targetSkillDir, "SKILL.md"),
				`---
name: data-agent-skill
description: Analyze data
---
Use the data agent skill.`,
			);
			await symlink(targetSkillDir, linkedSkillDir, "dir");

			const watcher = createUserInstructionConfigWatcher({
				skills: { directories: [skillsDir] },
			});

			await watcher.refreshAll();

			expect(
				watcher.getSnapshot("skill").get("data-agent-skill"),
			).toMatchObject({
				item: {
					name: "data-agent-skill",
					description: "Analyze data",
				},
			});
		},
	);

	it.skipIf(process.platform === "win32")(
		"ignores circular symlinks while discovering skill directories",
		async () => {
			const tempRoot = await mkdtemp(
				join(tmpdir(), "core-user-instructions-circular-symlink-skill-"),
			);
			tempRoots.push(tempRoot);
			const skillsDir = join(tempRoot, ".cline", "skills");
			const skillDir = join(skillsDir, "commit");
			const circularLink = join(skillsDir, "loop");
			await mkdir(skillDir, { recursive: true });
			await writeFile(
				join(skillDir, "SKILL.md"),
				`---
name: commit
---
Use conventional commits.`,
			);
			await symlink(circularLink, circularLink, "dir");

			const watcher = createUserInstructionConfigWatcher({
				skills: { directories: [skillsDir] },
			});

			await watcher.refreshAll();

			expect(watcher.getSnapshot("skill").get("commit")).toMatchObject({
				item: {
					name: "commit",
					instructions: "Use conventional commits.",
				},
			});
		},
	);

	it("loads enterprise-style managed rules, workflows, and skills through the default workspace watcher", async () => {
		const tempRoot = await mkdtemp(
			join(tmpdir(), "core-user-instructions-managed-"),
		);
		tempRoots.push(tempRoot);

		const pluginRoot = join(tempRoot, ".cline", "enterprise");
		await mkdir(join(pluginRoot, "workflows"), { recursive: true });
		await mkdir(join(pluginRoot, "skills", "security-review"), {
			recursive: true,
		});
		await writeFile(
			join(pluginRoot, "managed.json"),
			JSON.stringify({ source: "enterprise", version: "1", files: [] }),
		);
		await writeFile(
			join(pluginRoot, "rules.md"),
			`---
name: enterprise-policy
---
Follow enterprise policy.`,
		);
		await writeFile(
			join(pluginRoot, "workflows", "triage.md"),
			`---
name: triage
---
Follow the triage workflow.`,
		);
		await writeFile(
			join(pluginRoot, "skills", "security-review", "SKILL.md"),
			`---
name: security-review
---
Use the security review checklist.`,
		);

		const watcher = createUserInstructionConfigWatcher({
			skills: { workspacePath: tempRoot },
			rules: { workspacePath: tempRoot },
			workflows: { workspacePath: tempRoot },
		});

		await watcher.refreshAll();
		const rules = watcher.getSnapshot("rule");
		const workflows = watcher.getSnapshot("workflow");
		const skills = watcher.getSnapshot("skill");

		expect(
			[...rules.values()].some((rule) =>
				rule.item.instructions.includes("enterprise policy"),
			),
		).toBe(true);
		expect(
			[...workflows.values()].some((workflow) =>
				workflow.item.instructions.includes("triage workflow"),
			),
		).toBe(true);
		expect(
			[...skills.values()].some((skill) =>
				skill.item.instructions.includes("security review checklist"),
			),
		).toBe(true);
	});

	it("lets workspace .cline workflows override legacy .clinerules workflows with the same name", async () => {
		const tempRoot = await mkdtemp(
			join(tmpdir(), "core-user-instructions-workflow-precedence-"),
		);
		tempRoots.push(tempRoot);

		await mkdir(join(tempRoot, ".clinerules", "workflows"), {
			recursive: true,
		});
		await mkdir(join(tempRoot, ".cline", "workflows"), { recursive: true });
		await writeFile(
			join(tempRoot, ".clinerules", "workflows", "release.md"),
			`---
name: release
---
Legacy release workflow.`,
		);
		await writeFile(
			join(tempRoot, ".cline", "workflows", "release.md"),
			`---
name: release
---
New release workflow.`,
		);

		const watcher = createUserInstructionConfigWatcher({
			workflows: { workspacePath: tempRoot },
		});

		await watcher.refreshAll();
		const workflows = watcher.getSnapshot("workflow");
		const release = workflows.get("release");

		expect(release?.item.instructions).toBe("New release workflow.");
		expect(release?.filePath).toBe(
			join(tempRoot, ".cline", "workflows", "release.md"),
		);
	});
});
