import type { AgentConfig, Tool } from "@clinebot/shared";
import YAML from "yaml";
import { z } from "zod";
import { ALL_DEFAULT_TOOL_NAMES, type DefaultToolName } from "../../tools";

const AgentConfigFrontmatterSchema = z.object({
	name: z.string().trim().min(1),
	description: z.string().trim().min(1),
	modelId: z.string().trim().min(1).optional(),
	tools: z.union([z.string(), z.array(z.string())]).optional(),
	skills: z.union([z.string(), z.array(z.string())]).optional(),
});

const allowedToolNames = new Set<string>(ALL_DEFAULT_TOOL_NAMES);

export interface AgentYamlConfig {
	name: string;
	description: string;
	modelId?: string;
	tools: DefaultToolName[];
	skills?: string[];
	systemPrompt: string;
}

export interface ParseYamlFrontmatterResult {
	data: Record<string, unknown>;
	body: string;
	hadFrontmatter: boolean;
	parseError?: string;
}

export interface BuildAgentConfigOverridesOptions {
	availableTools?: ReadonlyArray<Tool>;
}

export interface PartialAgentConfigOverrides
	extends Partial<Pick<AgentConfig, "modelId" | "systemPrompt" | "tools">> {
	skills?: string[];
}

export function isAgentConfigYamlFile(fileName: string): boolean {
	return /\.(yaml|yml)$/i.test(fileName);
}

export function normalizeAgentConfigName(name: string): string {
	return name.trim().toLowerCase();
}

function parseYamlFrontmatter(markdown: string): ParseYamlFrontmatterResult {
	const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
	const match = markdown.match(frontmatterRegex);
	if (!match) {
		return { data: {}, body: markdown, hadFrontmatter: false };
	}

	const [, yamlContent, body] = match;
	try {
		const parsed = YAML.parse(yamlContent);
		const data =
			parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: {};
		return { data, body, hadFrontmatter: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			data: {},
			body: markdown,
			hadFrontmatter: true,
			parseError: message,
		};
	}
}

function normalizeToolName(toolName: string): DefaultToolName {
	const trimmed = toolName.trim();
	if (!trimmed) {
		throw new Error("Tool name cannot be empty.");
	}
	if (!allowedToolNames.has(trimmed)) {
		throw new Error(
			`Unknown tool '${trimmed}'. Expected one of: ${ALL_DEFAULT_TOOL_NAMES.join(", ")}.`,
		);
	}
	return trimmed as DefaultToolName;
}

function parseToolNames(
	tools: string | string[] | undefined,
): DefaultToolName[] {
	if (!tools) {
		return [];
	}
	const rawTools = Array.isArray(tools) ? tools : tools.split(",");
	return Array.from(new Set(rawTools.map(normalizeToolName)));
}

function normalizeSkillName(skillName: string): string {
	const trimmed = skillName.trim();
	if (!trimmed) {
		throw new Error("Skill name cannot be empty.");
	}
	return trimmed;
}

function parseSkills(
	skills: string | string[] | undefined,
): string[] | undefined {
	if (skills === undefined) {
		return undefined;
	}
	const rawSkills = Array.isArray(skills) ? skills : skills.split(",");
	return Array.from(new Set(rawSkills.map(normalizeSkillName)));
}

export function parseAgentConfigFromYaml(content: string): AgentYamlConfig {
	const { data, body, hadFrontmatter, parseError } =
		parseYamlFrontmatter(content);
	if (parseError) {
		throw new Error(`Failed to parse YAML frontmatter: ${parseError}`);
	}
	if (!hadFrontmatter) {
		throw new Error("Missing YAML frontmatter block in agent config file.");
	}

	const parsedFrontmatter = AgentConfigFrontmatterSchema.parse(data);
	const systemPrompt = body.trim();
	if (!systemPrompt) {
		throw new Error("Missing system prompt body in agent config file.");
	}

	return {
		name: parsedFrontmatter.name,
		description: parsedFrontmatter.description,
		modelId: parsedFrontmatter.modelId,
		tools: parseToolNames(parsedFrontmatter.tools),
		skills: parseSkills(parsedFrontmatter.skills),
		systemPrompt,
	};
}

export function resolveAgentTools(
	toolNames: ReadonlyArray<DefaultToolName>,
	availableTools: ReadonlyArray<Tool>,
): Tool[] {
	if (toolNames.length === 0) {
		return [];
	}

	const toolIndex = new Map<string, Tool>(
		availableTools.map((tool) => [tool.name, tool]),
	);
	return toolNames.map((toolName) => {
		const resolved = toolIndex.get(toolName);
		if (!resolved) {
			throw new Error(
				`Configured tool '${toolName}' is unavailable. Available tools: ${availableTools.map((tool) => tool.name).join(", ")}.`,
			);
		}
		return resolved;
	});
}

export function toPartialAgentConfig(
	config: AgentYamlConfig,
	options?: BuildAgentConfigOverridesOptions,
): PartialAgentConfigOverrides {
	const partial: PartialAgentConfigOverrides = {
		systemPrompt: config.systemPrompt,
	};

	if (config.modelId) {
		partial.modelId = config.modelId;
	}

	if (config.tools.length > 0) {
		if (!options?.availableTools) {
			throw new Error(
				"Configured tools cannot be converted into AgentConfig.tools without availableTools.",
			);
		}
		partial.tools = resolveAgentTools(config.tools, options.availableTools);
	}

	if (config.skills !== undefined) {
		partial.skills = [...config.skills];
	}

	return partial;
}

export function parsePartialAgentConfigFromYaml(
	content: string,
	options?: BuildAgentConfigOverridesOptions,
): PartialAgentConfigOverrides {
	const parsed = parseAgentConfigFromYaml(content);
	return toPartialAgentConfig(parsed, options);
}
