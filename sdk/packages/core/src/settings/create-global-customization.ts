import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveClineDir } from "@cline/shared/storage";
import {
	parseRuleConfigFromMarkdown,
	parseSkillConfigFromMarkdown,
} from "../extensions/config";
import {
	HOOK_CONFIG_FILE_EVENT_MAP,
	HookConfigFileName,
} from "../hooks/hook-file-config";

import type { CoreSettingsCreateGlobalInput } from "./types";

const creatableHookEvents = Object.values(HookConfigFileName).filter(
	(event) => HOOK_CONFIG_FILE_EVENT_MAP[event] !== undefined,
);

/** Create only in the canonical global directories; never replace an existing file. */
export async function createGlobalCustomization(
	input: CoreSettingsCreateGlobalInput,
): Promise<{ path: string }> {
	const { type } = input;
	if (type !== "rule" && type !== "skill" && type !== "hook") {
		throw new Error("Choose a rule, skill, or hook.");
	}
	const name = typeof input.name === "string" ? input.name.trim() : "";
	const content = typeof input.content === "string" ? input.content : "";
	if (!content.trim()) throw new Error("Content is required.");
	let path: string;
	let markdown = content;
	if (type === "hook") {
		if (!creatableHookEvents.some((event) => event === name)) {
			throw new Error("Choose a supported hook event.");
		}
		path = join(resolveClineDir(), "hooks", `${name}.mjs`);
	} else {
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
			throw new Error(
				"Use up to 64 lowercase letters, numbers, and single hyphens for the name.",
			);
		}
		const description =
			typeof input.description === "string" ? input.description.trim() : "";
		if (type === "skill" && !description)
			throw new Error("A skill description is required.");
		markdown = `---\nname: ${JSON.stringify(name)}\n${type === "skill" ? `description: ${JSON.stringify(description)}\n` : ""}---\n\n${content.trim()}\n`;
		(type === "skill"
			? parseSkillConfigFromMarkdown
			: parseRuleConfigFromMarkdown)(markdown, name);
		path =
			type === "skill"
				? join(resolveClineDir(), "skills", name, "SKILL.md")
				: join(resolveClineDir(), "rules", `${name}.md`);
	}
	await mkdir(dirname(path), { recursive: true });
	try {
		await writeFile(path, markdown, { flag: "wx" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new Error(
				`A ${type} named "${name}" already exists. Choose another name or edit the existing file.`,
			);
		}
		throw error;
	}
	return { path };
}
