import { type Dirent, existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { resolveAgentConfigSearchPaths } from "@cline/shared/storage";
import YAML from "yaml";
import { z } from "zod";

// A plugin entry is either a bare name (matched against installed plugins)
// or a mapping carrying an install source consumed by `cline agent install`.
const ConfiguredAgentPluginEntrySchema = z.union([
	z.string(),
	z.object({
		name: z.string().trim().min(1),
		install: z.string().trim().min(1).optional(),
	}),
]);

const ConfiguredAgentFrontmatterSchema = z.object({
	name: z.string().trim().min(1),
	description: z.string().trim().min(1),
	tools: z.union([z.string(), z.array(z.string())]).optional(),
	skills: z.union([z.string(), z.array(z.string())]).optional(),
	plugins: z
		.union([z.string(), z.array(ConfiguredAgentPluginEntrySchema)])
		.optional(),
	providerId: z.string().trim().min(1).optional(),
	modelId: z.string().trim().min(1).optional(),
	maxIterations: z.number().int().positive().optional(),
});

export interface ConfiguredAgentPluginRef {
	name: string;
	install?: string;
}

export interface ConfiguredAgentConfig {
	name: string;
	description: string;
	tools?: string[];
	skills?: string[];
	plugins?: ConfiguredAgentPluginRef[];
	providerId?: string;
	modelId?: string;
	maxIterations?: number;
	systemPrompt: string;
	path?: string;
}

export interface ConfiguredAgentReadError {
	path: string;
	error: Error;
}

export interface ConfiguredAgentLoadResult {
	configs: ConfiguredAgentConfig[];
	errors: ConfiguredAgentReadError[];
}

function splitFrontmatter(content: string): {
	frontmatter: string;
	body: string;
} {
	const firstLineMatch = content.match(/^(---)[^\S\r\n]*(?:\r?\n|$)/);
	if (!firstLineMatch) {
		throw new Error("Missing YAML frontmatter block in agent config file.");
	}

	const frontmatterStart = firstLineMatch[0].length;
	const delimiterPattern = /^---[^\S\r\n]*(?:\r?\n|$)/gm;
	delimiterPattern.lastIndex = frontmatterStart;
	let lastValid:
		| {
				frontmatter: string;
				body: string;
		  }
		| undefined;
	const candidates = Array.from(content.matchAll(delimiterPattern)).filter(
		(candidate) => candidate.index >= frontmatterStart,
	);
	for (const candidate of candidates) {
		const delimiterStart = candidate.index;
		const frontmatter = content.slice(frontmatterStart, delimiterStart);
		try {
			const parsedYaml = YAML.parse(frontmatter);
			if (
				!parsedYaml ||
				typeof parsedYaml !== "object" ||
				Array.isArray(parsedYaml)
			) {
				continue;
			}
			ConfiguredAgentFrontmatterSchema.parse(parsedYaml);
			const body = content.slice(delimiterStart + candidate[0].length);
			lastValid = { frontmatter, body };
		} catch {
			// Keep scanning: this delimiter may be literal content inside YAML.
		}
	}

	if (lastValid) {
		return lastValid;
	}

	throw new Error(
		"Missing closing YAML frontmatter delimiter in agent config file.",
	);
}

function parseStringList(
	value: string | string[] | undefined,
): string[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	const raw = Array.isArray(value) ? value : value.split(",");
	return Array.from(
		new Set(
			raw.map((entry) => entry.trim()).filter((entry) => entry.length > 0),
		),
	);
}

function parsePluginList(
	value: z.infer<typeof ConfiguredAgentFrontmatterSchema>["plugins"],
): ConfiguredAgentPluginRef[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	const raw = Array.isArray(value) ? value : value.split(",");
	const refs: ConfiguredAgentPluginRef[] = [];
	const seen = new Set<string>();
	for (const entry of raw) {
		const name = (typeof entry === "string" ? entry : entry.name).trim();
		if (!name) {
			continue;
		}
		const key = name.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		const install = typeof entry === "string" ? undefined : entry.install;
		refs.push(install ? { name, install } : { name });
	}
	return refs;
}

function normalizeAgentName(name: string): string {
	return name.trim().toLowerCase();
}

function isYamlFile(fileName: string): boolean {
	const extension = extname(fileName).toLowerCase();
	return extension === ".yml" || extension === ".yaml";
}

export function parseConfiguredAgentConfig(
	content: string,
	options: { path?: string } = {},
): ConfiguredAgentConfig {
	const { frontmatter, body } = splitFrontmatter(content);
	const parsedYaml = YAML.parse(frontmatter);
	if (
		!parsedYaml ||
		typeof parsedYaml !== "object" ||
		Array.isArray(parsedYaml)
	) {
		throw new Error("Agent config frontmatter must be a YAML mapping.");
	}

	const parsed = ConfiguredAgentFrontmatterSchema.parse(parsedYaml);
	const systemPrompt = body.trim();
	if (!systemPrompt) {
		throw new Error("Missing system prompt body in agent config file.");
	}

	return {
		name: parsed.name,
		description: parsed.description,
		tools: parseStringList(parsed.tools),
		skills: parseStringList(parsed.skills),
		plugins: parsePluginList(parsed.plugins),
		providerId: parsed.providerId,
		modelId: parsed.modelId,
		maxIterations: parsed.maxIterations,
		systemPrompt,
		path: options.path,
	};
}

export function loadConfiguredAgentConfigs(input: {
	workspaceRoot?: string;
	searchPaths?: string[];
}): ConfiguredAgentLoadResult {
	const searchPaths =
		input.searchPaths ?? resolveAgentConfigSearchPaths(input.workspaceRoot);
	const configsByName = new Map<string, ConfiguredAgentConfig>();
	const errors: ConfiguredAgentReadError[] = [];

	for (const directory of searchPaths.filter(Boolean)) {
		if (!existsSync(directory)) {
			continue;
		}

		let entries: Dirent[];
		try {
			entries = readdirSync(directory, { withFileTypes: true });
		} catch (error) {
			errors.push({
				path: directory,
				error: error instanceof Error ? error : new Error(String(error)),
			});
			continue;
		}

		for (const entry of entries) {
			if (!entry.isFile() || !isYamlFile(entry.name)) {
				continue;
			}

			const filePath = join(directory, entry.name);
			try {
				const raw = readFileSync(filePath, "utf8");
				const config = parseConfiguredAgentConfig(raw, { path: filePath });
				const normalizedName = normalizeAgentName(config.name);
				if (!configsByName.has(normalizedName)) {
					configsByName.set(normalizedName, config);
				}
			} catch (error) {
				errors.push({
					path: filePath,
					error: error instanceof Error ? error : new Error(String(error)),
				});
			}
		}
	}

	const configs = Array.from(configsByName.values()).sort((a, b) =>
		(a.path ? basename(a.path) : a.name).localeCompare(
			b.path ? basename(b.path) : b.name,
		),
	);
	return { configs, errors };
}
