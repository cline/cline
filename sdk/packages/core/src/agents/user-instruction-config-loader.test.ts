import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createUserInstructionConfigWatcher,
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
				join(workspacePath, ".claude", "skills"),
				join(workspacePath, ".agents", "skills"),
			]),
		);
		expect(resolveRulesConfigSearchPaths(workspacePath)).toEqual(
			expect.arrayContaining([join(workspacePath, ".clinerules")]),
		);
		expect(resolveWorkflowsConfigSearchPaths(workspacePath)).toEqual(
			expect.arrayContaining([join(workspacePath, ".clinerules", "workflows")]),
		);
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
			await watcher.start();
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
			watcher.stop();
		}
	});
});
