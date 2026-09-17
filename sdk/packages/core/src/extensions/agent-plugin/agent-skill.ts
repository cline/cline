import { stripUtf8Bom } from "@cline/shared";
import YAML from "yaml";

const AGENT_SKILL_FIELDS = new Set([
	"name",
	"description",
	"license",
	"compatibility",
	"metadata",
	"allowed-tools",
]);

const MAX_AGENT_SKILL_NAME_LENGTH = 64;
const MAX_AGENT_SKILL_DESCRIPTION_LENGTH = 1024;
const MAX_AGENT_SKILL_COMPATIBILITY_LENGTH = 500;

export interface AgentSkillMetadata {
	name: string;
	description: string;
	license?: string;
	compatibility?: string;
	metadata?: Record<string, string>;
	"allowed-tools"?: string;
}

export interface ParsedAgentSkill {
	metadata: AgentSkillMetadata;
	instructions: string;
	frontmatter: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
	value: unknown,
	fieldName: string,
	options: { required?: boolean; maxLength?: number } = {},
): string | undefined {
	if (value === undefined) {
		if (options.required) {
			throw new Error(`Missing required frontmatter field '${fieldName}'.`);
		}
		return undefined;
	}
	if (typeof value !== "string") {
		throw new Error(`Frontmatter field '${fieldName}' must be a string.`);
	}
	const normalized = value.trim();
	if (options.required && normalized.length === 0) {
		throw new Error(`Frontmatter field '${fieldName}' cannot be empty.`);
	}
	if (
		options.maxLength !== undefined &&
		normalized.length > options.maxLength
	) {
		throw new Error(
			`Frontmatter field '${fieldName}' exceeds ${options.maxLength} characters.`,
		);
	}
	return normalized;
}

function validateAgentSkillName(name: string, directoryName: string): string {
	const normalized = name.normalize("NFKC");
	if (
		normalized.length === 0 ||
		normalized.length > MAX_AGENT_SKILL_NAME_LENGTH
	) {
		throw new Error(
			`Skill name must be between 1 and ${MAX_AGENT_SKILL_NAME_LENGTH} characters.`,
		);
	}
	if (normalized !== normalized.toLowerCase()) {
		throw new Error(`Skill name '${normalized}' must be lowercase.`);
	}
	if (
		normalized.startsWith("-") ||
		normalized.endsWith("-") ||
		normalized.includes("--")
	) {
		throw new Error(
			`Skill name '${normalized}' cannot start or end with a hyphen or contain consecutive hyphens.`,
		);
	}
	for (const character of normalized) {
		if (character !== "-" && !/[\p{L}\p{N}]/u.test(character)) {
			throw new Error(
				`Skill name '${normalized}' may contain only lowercase letters, numbers, and hyphens.`,
			);
		}
	}
	if (directoryName.normalize("NFKC") !== normalized) {
		throw new Error(
			`Skill directory '${directoryName}' must match frontmatter name '${normalized}'.`,
		);
	}
	return normalized;
}

function parseMetadata(value: unknown): Record<string, string> | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!isRecord(value)) {
		throw new Error("Frontmatter field 'metadata' must be an object.");
	}
	const metadata: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry !== "string") {
			throw new Error(`Frontmatter metadata value '${key}' must be a string.`);
		}
		metadata[key] = entry;
	}
	return metadata;
}

/**
 * Parse and validate one Agent Skills specification `SKILL.md` document.
 *
 * Cline's own skill files intentionally remain backwards-compatible and more
 * permissive. Agent Plugin skills go through this strict path because the
 * Agent Plugins contract requires an invalid skill to be skipped in isolation.
 */
export function parseAgentSkillMarkdown(
	content: string,
	directoryName: string,
): ParsedAgentSkill {
	const normalizedContent = stripUtf8Bom(content);
	const match = normalizedContent.match(
		/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/,
	);
	if (!match) {
		throw new Error(
			"SKILL.md must start with YAML frontmatter delimited by '---'.",
		);
	}

	let parsed: unknown;
	try {
		parsed = YAML.parse(match[1]);
	} catch (error) {
		throw new Error(
			`Failed to parse YAML frontmatter: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	if (!isRecord(parsed)) {
		throw new Error("SKILL.md frontmatter must be a YAML mapping.");
	}

	const unknownFields = Object.keys(parsed)
		.filter((field) => !AGENT_SKILL_FIELDS.has(field))
		.sort();
	if (unknownFields.length > 0) {
		throw new Error(
			`Unexpected frontmatter field${unknownFields.length === 1 ? "" : "s"}: ${unknownFields.join(", ")}.`,
		);
	}

	const rawName = requireString(parsed.name, "name", {
		required: true,
		maxLength: MAX_AGENT_SKILL_NAME_LENGTH,
	});
	const name = validateAgentSkillName(rawName as string, directoryName);
	const description = requireString(parsed.description, "description", {
		required: true,
		maxLength: MAX_AGENT_SKILL_DESCRIPTION_LENGTH,
	}) as string;
	const license = requireString(parsed.license, "license");
	const compatibility = requireString(parsed.compatibility, "compatibility", {
		maxLength: MAX_AGENT_SKILL_COMPATIBILITY_LENGTH,
	});
	if (parsed.compatibility !== undefined && !compatibility) {
		throw new Error("Frontmatter field 'compatibility' cannot be empty.");
	}
	const allowedTools = requireString(parsed["allowed-tools"], "allowed-tools");
	const metadata = parseMetadata(parsed.metadata);

	return {
		metadata: {
			name,
			description,
			...(license !== undefined ? { license } : {}),
			...(compatibility !== undefined ? { compatibility } : {}),
			...(metadata !== undefined ? { metadata } : {}),
			...(allowedTools !== undefined ? { "allowed-tools": allowedTools } : {}),
		},
		instructions: match[2].trim(),
		frontmatter: parsed,
	};
}
