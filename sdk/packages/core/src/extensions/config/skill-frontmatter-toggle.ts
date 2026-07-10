import { readFile, writeFile } from "node:fs/promises";
import YAML from "yaml";

export interface ToggleSkillFrontmatterOptions {
	filePath: string;
	enabled: boolean;
}

export interface ToggleSkillFrontmatterResult {
	filePath: string;
	enabled: boolean;
	disabled: boolean;
}

interface MarkdownFrontmatterParts {
	data: Record<string, unknown>;
	body: string;
	hadFrontmatter: boolean;
}

function parseMarkdownFrontmatter(content: string): MarkdownFrontmatterParts {
	// Strip a leading UTF-8 BOM (e.g. added by Windows Notepad's "UTF-8 with BOM" encoding).
	// Node's `utf-8` decoding does not strip the BOM character (\uFEFF), so without this the
	// frontmatter regex below never matches a file that starts with "\uFEFF---", causing the
	// frontmatter to be silently ignored (see cline/cline#12151).
	const normalizedContent =
		content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;

	const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
	const match = normalizedContent.match(frontmatterRegex);
	if (!match) {
		return { data: {}, body: normalizedContent, hadFrontmatter: false };
	}

	const [, yamlContent, body] = match;
	const parsed = YAML.parse(yamlContent);
	const data =
		parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	return { data, body, hadFrontmatter: true };
}

function serializeMarkdownFrontmatter(
	data: Record<string, unknown>,
	body: string,
): string {
	const yaml = YAML.stringify(data).trimEnd();
	return `---\n${yaml}\n---\n${body}`;
}

export function updateSkillMarkdownEnabledState(
	content: string,
	enabled: boolean,
): string {
	const { data, body, hadFrontmatter } = parseMarkdownFrontmatter(content);

	if (!hadFrontmatter && enabled) {
		return content;
	}

	if (enabled) {
		delete data.disabled;
		if (data.enabled === false) {
			delete data.enabled;
		}
		if (Object.keys(data).length === 0) {
			return body;
		}
		return serializeMarkdownFrontmatter(data, body);
	}

	data.disabled = true;
	return serializeMarkdownFrontmatter(data, body);
}

export async function toggleSkillFrontmatter({
	filePath,
	enabled,
}: ToggleSkillFrontmatterOptions): Promise<ToggleSkillFrontmatterResult> {
	const content = await readFile(filePath, "utf8");
	const updated = updateSkillMarkdownEnabledState(content, enabled);
	await writeFile(filePath, updated);

	return {
		filePath,
		enabled,
		disabled: !enabled,
	};
}
