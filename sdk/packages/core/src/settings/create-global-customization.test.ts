import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { setHomeDir } from "@cline/shared/storage";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
	createUserInstructionConfigService,
	listHookConfigFiles,
} from "../index";
import { createGlobalCustomization } from "./create-global-customization";

const originalHome = homedir();
let root: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "desktop-customization-"));
	setHomeDir(root);
});
afterEach(async () => {
	setHomeDir(originalHome);
	await rm(root, { recursive: true, force: true });
});

it("creates globally discoverable rules, skills, and runnable hook files", async () => {
	const rule = await createGlobalCustomization({
		type: "rule",
		name: "review",
		content: "Check the diff.",
	});
	const skill = await createGlobalCustomization({
		type: "skill",
		name: "review",
		description: 'Review "code": carefully',
		content: "Read the changes.",
	});
	const hook = await createGlobalCustomization({
		type: "hook",
		name: "TaskStart",
		content: 'process.stdout.write("{}");',
	});
	const service = createUserInstructionConfigService();
	try {
		await service.start();
		expect(
			service.listRecords("rule").some((item) => item.filePath === rule.path),
		).toBe(true);
		expect(
			service.listRecords("skill").some((item) => item.filePath === skill.path),
		).toBe(true);
		expect(
			listHookConfigFiles().some(
				(item) =>
					item.path === hook.path && item.hookEventName === "agent_start",
			),
		).toBe(true);
	} finally {
		service.stop();
	}
});

it("refuses overwrites and invalid paths or events", async () => {
	const input = { type: "rule" as const, name: "review", content: "Original." };
	const { path } = await createGlobalCustomization(input);
	await expect(
		createGlobalCustomization({ ...input, content: "Replacement." }),
	).rejects.toThrow("already exists");
	expect(await readFile(path, "utf8")).toContain("Original.");
	for (const name of ["../escape", "/tmp/escape", "a/b", "a\\b"]) {
		await expect(createGlobalCustomization({ ...input, name })).rejects.toThrow(
			"lowercase",
		);
	}
	await expect(
		createGlobalCustomization({
			type: "hook",
			name: "PreCompact",
			content: "x",
		}),
	).rejects.toThrow("supported");
	await expect(
		createGlobalCustomization({ type: "skill", name: "review", content: "x" }),
	).rejects.toThrow("description");
	await expect(
		createGlobalCustomization({ ...input, content: " " }),
	).rejects.toThrow("Content");
});
