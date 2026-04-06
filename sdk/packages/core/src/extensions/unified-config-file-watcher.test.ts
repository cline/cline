import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type AgentYamlConfig,
	parseAgentConfigFromYaml,
} from "./agent-config-loader";
import {
	UnifiedConfigFileWatcher,
	type UnifiedConfigWatcherEvent,
} from "./unified-config-file-watcher";

const WAIT_TIMEOUT_MS = 8_000;
const WAIT_INTERVAL_MS = 25;

async function waitForEvent<TType extends string, TItem>(
	events: Array<UnifiedConfigWatcherEvent<TType, TItem>>,
	predicate: (event: UnifiedConfigWatcherEvent<TType, TItem>) => boolean,
	timeoutMs = WAIT_TIMEOUT_MS,
): Promise<UnifiedConfigWatcherEvent<TType, TItem>> {
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

describe("UnifiedConfigFileWatcher", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
		);
		tempRoots.length = 0;
	});

	it("emits upsert and remove events with config type for agent configs", async () => {
		const tempRoot = await mkdtemp(
			join(tmpdir(), "core-unified-config-watcher-"),
		);
		tempRoots.push(tempRoot);
		const agentsDir = join(tempRoot, "agents");
		await mkdir(agentsDir, { recursive: true });
		const agentFilePath = join(agentsDir, "reviewer.yaml");
		await writeFile(
			agentFilePath,
			`---
name: Reviewer
description: Reviews patches
tools: read_files
---
Review code carefully.`,
		);

		const watcher = new UnifiedConfigFileWatcher([
			{
				type: "agent" as const,
				directories: [agentsDir],
				includeFile: (fileName) => /\.(yaml|yml)$/i.test(fileName),
				parseFile: (context) => parseAgentConfigFromYaml(context.content),
				resolveId: (config) => config.name.toLowerCase(),
			},
		]);

		const events: Array<
			UnifiedConfigWatcherEvent<
				"agent",
				ReturnType<typeof parseAgentConfigFromYaml>
			>
		> = [];
		const unsubscribe = watcher.subscribe((event) => events.push(event));

		try {
			await watcher.start();
			await waitForEvent(
				events,
				(event) => event.kind === "upsert" && event.record.id === "reviewer",
			);

			events.length = 0;
			await writeFile(
				agentFilePath,
				`---
name: Reviewer
description: Reviews patches
---
Review code with strictness.`,
			);
			await watcher.refreshType("agent");
			await waitForEvent(
				events,
				(event) => event.kind === "upsert" && event.record.type === "agent",
			);

			events.length = 0;
			await unlink(agentFilePath);
			await watcher.refreshType("agent");
			await waitForEvent(
				events,
				(event) => event.kind === "remove" && event.type === "agent",
			);
		} finally {
			unsubscribe();
			watcher.stop();
		}
	}, 15_000);

	it("supports one watcher instance for multiple config types", async () => {
		const tempRoot = await mkdtemp(
			join(tmpdir(), "core-unified-config-watcher-"),
		);
		tempRoots.push(tempRoot);
		const agentsDir = join(tempRoot, "agents");
		const skillsDir = join(tempRoot, "skills");
		await mkdir(agentsDir, { recursive: true });
		await mkdir(skillsDir, { recursive: true });

		await writeFile(
			join(agentsDir, "researcher.yaml"),
			`---
name: Researcher
description: Finds context
---
Investigate related code paths.`,
		);
		await writeFile(
			join(skillsDir, "SKILL.md"),
			`---
name: incident-response
description: Handle incidents
---
Escalation playbook`,
		);

		const watcher = new UnifiedConfigFileWatcher<
			"agent" | "skill",
			AgentYamlConfig | { path: string }
		>([
			{
				type: "agent" as const,
				directories: [agentsDir],
				includeFile: (fileName) => /\.(yaml|yml)$/i.test(fileName),
				parseFile: (context) =>
					parseAgentConfigFromYaml(context.content) as
						| AgentYamlConfig
						| { path: string },
				resolveId: (config) =>
					"name" in config ? config.name.toLowerCase() : "invalid-agent-config",
			},
			{
				type: "skill" as const,
				directories: [skillsDir],
				includeFile: (fileName) => fileName === "SKILL.md",
				parseFile: (context) => ({ path: context.filePath }),
				resolveId: (_parsed, context) => basename(context.directoryPath),
			},
		]);

		const events: Array<
			UnifiedConfigWatcherEvent<
				"agent" | "skill",
				AgentYamlConfig | { path: string }
			>
		> = [];
		const unsubscribe = watcher.subscribe((event) => events.push(event));

		try {
			await watcher.start();
			await waitForEvent(
				events,
				(event) =>
					event.kind === "upsert" &&
					(event.record.type === "agent" || event.record.type === "skill"),
			);
			expect(
				events.some(
					(event) => event.kind === "upsert" && event.record.type === "agent",
				),
			).toBe(true);
			expect(
				events.some(
					(event) => event.kind === "upsert" && event.record.type === "skill",
				),
			).toBe(true);
		} finally {
			unsubscribe();
			watcher.stop();
		}
	});
});
