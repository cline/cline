import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	UnifiedConfigFileWatcher,
	type UnifiedConfigWatcherEvent,
} from "./unified-config-file-watcher";

const WAIT_TIMEOUT_MS = 8_000;
const WAIT_INTERVAL_MS = 25;

interface TestProfileConfig {
	name: string;
	body: string;
}

function parseTestProfileConfig(content: string): TestProfileConfig {
	const match = content.match(/^name:\s*(.+)\n\n([\s\S]*)$/);
	if (!match) {
		throw new Error("Invalid test profile config.");
	}
	return {
		name: match[1].trim(),
		body: match[2].trim(),
	};
}

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

	it("emits upsert and remove events with config type", async () => {
		const tempRoot = await mkdtemp(
			join(tmpdir(), "core-unified-config-watcher-"),
		);
		tempRoots.push(tempRoot);
		const profilesDir = join(tempRoot, "profiles");
		await mkdir(profilesDir, { recursive: true });
		const profileFilePath = join(profilesDir, "reviewer.profile");
		await writeFile(
			profileFilePath,
			"name: Reviewer\n\nReview code carefully.",
		);

		const watcher = new UnifiedConfigFileWatcher([
			{
				type: "profile" as const,
				directories: [profilesDir],
				includeFile: (fileName) => fileName.endsWith(".profile"),
				parseFile: (context) => parseTestProfileConfig(context.content),
				resolveId: (config) => config.name.toLowerCase(),
			},
		]);

		const events: Array<
			UnifiedConfigWatcherEvent<
				"profile",
				ReturnType<typeof parseTestProfileConfig>
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
				profileFilePath,
				"name: Reviewer\n\nReview code with strictness.",
			);
			await watcher.refreshType("profile");
			await waitForEvent(
				events,
				(event) => event.kind === "upsert" && event.record.type === "profile",
			);

			events.length = 0;
			await unlink(profileFilePath);
			await watcher.refreshType("profile");
			await waitForEvent(
				events,
				(event) => event.kind === "remove" && event.type === "profile",
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
		const profilesDir = join(tempRoot, "profiles");
		const skillsDir = join(tempRoot, "skills");
		await mkdir(profilesDir, { recursive: true });
		await mkdir(skillsDir, { recursive: true });

		await writeFile(
			join(profilesDir, "researcher.profile"),
			"name: Researcher\n\nInvestigate related code paths.",
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
			"profile" | "skill",
			TestProfileConfig | { path: string }
		>([
			{
				type: "profile" as const,
				directories: [profilesDir],
				includeFile: (fileName) => fileName.endsWith(".profile"),
				parseFile: (context) =>
					parseTestProfileConfig(context.content) as
						| TestProfileConfig
						| { path: string },
				resolveId: (config) =>
					"name" in config ? config.name.toLowerCase() : "invalid-profile",
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
				"profile" | "skill",
				TestProfileConfig | { path: string }
			>
		> = [];
		const unsubscribe = watcher.subscribe((event) => events.push(event));

		try {
			await watcher.start();
			await waitForEvent(
				events,
				(event) =>
					event.kind === "upsert" &&
					(event.record.type === "profile" || event.record.type === "skill"),
			);
			expect(
				events.some(
					(event) => event.kind === "upsert" && event.record.type === "profile",
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
