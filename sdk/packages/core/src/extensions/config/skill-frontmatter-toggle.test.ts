import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	toggleSkillFrontmatter,
	updateSkillMarkdownEnabledState,
} from "./skill-frontmatter-toggle";
import { parseSkillConfigFromMarkdown } from "./user-instruction-config-loader";

describe("skill frontmatter toggle", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
		);
		tempRoots.length = 0;
	});

	it("disables an enabled skill with existing frontmatter", () => {
		const content = `---
name: code-review
description: Review code carefully
---
First line.

Second line.`;

		const updated = updateSkillMarkdownEnabledState(content, false);
		const parsed = parseSkillConfigFromMarkdown(updated, "fallback");

		expect(parsed.disabled).toBe(true);
		expect(parsed.frontmatter.name).toBe("code-review");
		expect(parsed.frontmatter.description).toBe("Review code carefully");
		expect(updated.endsWith("First line.\n\nSecond line.")).toBe(true);
	});

	it("enables a disabled skill", () => {
		const content = `---
name: code-review
disabled: true
---
Use the review checklist.`;

		const updated = updateSkillMarkdownEnabledState(content, true);
		const parsed = parseSkillConfigFromMarkdown(updated, "fallback");

		expect(parsed.disabled).toBeUndefined();
		expect(parsed.frontmatter).not.toHaveProperty("disabled");
		expect(updated.endsWith("Use the review checklist.")).toBe(true);
	});

	it("enables a legacy enabled false skill", () => {
		const content = `---
name: legacy-skill
enabled: false
---
Use legacy instructions.`;

		const updated = updateSkillMarkdownEnabledState(content, true);
		const parsed = parseSkillConfigFromMarkdown(updated, "fallback");

		expect(parsed.disabled).toBeUndefined();
		expect(parsed.frontmatter).not.toHaveProperty("enabled");
		expect(updated.endsWith("Use legacy instructions.")).toBe(true);
	});

	it("prepends frontmatter when disabling a skill without frontmatter", () => {
		const content = "Follow the incident response runbook.";

		const updated = updateSkillMarkdownEnabledState(content, false);
		const parsed = parseSkillConfigFromMarkdown(updated, "incident-response");

		expect(parsed.disabled).toBe(true);
		expect(parsed.instructions).toBe(content);
		expect(updated).toBe(`---
disabled: true
---
${content}`);
	});

	it("leaves a skill without frontmatter unchanged when enabling", () => {
		const content = "Follow the incident response runbook.";

		expect(updateSkillMarkdownEnabledState(content, true)).toBe(content);
	});

	it("writes toggled content and returns the resulting state", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-skill-toggle-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "SKILL.md");
		await writeFile(
			filePath,
			`---
name: file-skill
---
Use file-backed instructions.`,
		);

		const result = await toggleSkillFrontmatter({ filePath, enabled: false });
		const written = await readFile(filePath, "utf8");
		const parsed = parseSkillConfigFromMarkdown(written, "fallback");

		expect(result).toEqual({ filePath, enabled: false, disabled: true });
		expect(parsed.disabled).toBe(true);
		expect(written.endsWith("Use file-backed instructions.")).toBe(true);
	});
});
