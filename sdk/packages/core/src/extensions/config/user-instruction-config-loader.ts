import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { stripUtf8Bom } from "@cline/shared";
import {
	AGENTS_RULES_FILE_NAME,
	RULES_CONFIG_DIRECTORY_NAME,
	resolveGlobalAgentsRulesPath,
	resolveRulesConfigSearchPaths as resolveRulesConfigSearchPathsFromShared,
	resolveSkillsConfigSearchPaths as resolveSkillsConfigSearchPathsFromShared,
	resolveWorkflowsConfigSearchPaths as resolveWorkflowsConfigSearchPathsFromShared,
	SKILLS_CONFIG_DIRECTORY_NAME,
	WORKFLOWS_CONFIG_DIRECTORY_NAME,
} from "@cline/shared/storage";
import YAML from "yaml";
import { resolveAgentPluginSkillDirectories } from "../plugin/plugin-config-loader";
import {
	type UnifiedConfigDefinition,
	type UnifiedConfigFileCandidate,
	type UnifiedConfigFileContext,
	UnifiedConfigFileWatcher,
	type UnifiedConfigWatcherEvent,
} from "./unified-config-file-watcher";

const SKILL_FILE_NAME = "SKILL.md";
const MANAGED_PLUGIN_MANIFEST_FILE_NAME = "managed.json";

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

export {
	RULES_CONFIG_DIRECTORY_NAME,
	SKILLS_CONFIG_DIRECTORY_NAME,
	WORKFLOWS_CONFIG_DIRECTORY_NAME,
};

export interface ParseMarkdownFrontmatterResult {
	data: Record<string, unknown>;
	body: string;
	hadFrontmatter: boolean;
	parseError?: string;
}

export interface SkillConfig {
	name: string;
	description?: string;
	disabled?: boolean;
	instructions: string;
	frontmatter: Record<string, unknown>;
}

export interface RuleConfig {
	name: string;
	disabled?: boolean;
	instructions: string;
	frontmatter: Record<string, unknown>;
}

export interface WorkflowConfig {
	name: string;
	disabled?: boolean;
	description?: string;
	instructions: string;
	frontmatter: Record<string, unknown>;
}

export type UserInstructionConfigType = "skill" | "rule" | "workflow";

export type UserInstructionConfig = SkillConfig | RuleConfig | WorkflowConfig;

export type UserInstructionConfigWatcher = UnifiedConfigFileWatcher<
	UserInstructionConfigType,
	UserInstructionConfig
>;

export type UserInstructionConfigWatcherEvent = UnifiedConfigWatcherEvent<
	UserInstructionConfigType,
	UserInstructionConfig
>;

export interface CreateInstructionWatcherOptions {
	debounceMs?: number;
	emitParseErrors?: boolean;
}

export interface CreateSkillsConfigDefinitionOptions {
	directories?: ReadonlyArray<string>;
	workspacePath?: string;
	includePluginSkills?: boolean;
	pluginSkillDirectories?: ReadonlyArray<string>;
	pluginPaths?: ReadonlyArray<string>;
	cwd?: string;
}

export interface CreateRulesConfigDefinitionOptions {
	directories?: ReadonlyArray<string>;
	workspacePath?: string;
}

export interface CreateWorkflowsConfigDefinitionOptions {
	directories?: ReadonlyArray<string>;
	workspacePath?: string;
}

function normalizeName(name: string): string {
	return name.trim().toLowerCase();
}

function isIgnorableDirectoryError(error: unknown): boolean {
	const nodeError = error as NodeJS.ErrnoException;
	return (
		nodeError?.code === "ENOENT" ||
		nodeError?.code === "EACCES" ||
		nodeError?.code === "EPERM" ||
		nodeError?.code === "ELOOP"
	);
}

function isMarkdownFile(fileName: string): boolean {
	return MARKDOWN_EXTENSIONS.has(extname(fileName).toLowerCase());
}

function dedupeDirectoryPaths(directories: ReadonlyArray<string>): string[] {
	const deduped: string[] = [];
	const seen = new Set<string>();
	for (const directory of directories) {
		const normalized = resolve(directory);
		if (seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		deduped.push(directory);
	}
	return deduped;
}

function resolveSkillDirectories(
	options?: CreateSkillsConfigDefinitionOptions,
): string[] {
	const directories = [
		...(options?.directories ??
			resolveSkillsConfigSearchPaths(options?.workspacePath)),
	];
	if (options?.pluginSkillDirectories) {
		directories.push(...options.pluginSkillDirectories);
	} else if (options?.includePluginSkills) {
		directories.push(
			...resolveAgentPluginSkillDirectories({
				pluginPaths: options.pluginPaths,
				workspacePath: options.workspacePath,
				cwd: options.cwd ?? options.workspacePath,
			}),
		);
	}
	return dedupeDirectoryPaths(directories);
}

async function discoverManagedPluginRoots(
	clineDirectoryPath: string,
): Promise<string[]> {
	try {
		const entries = await readdir(clineDirectoryPath, { withFileTypes: true });
		const pluginRoots: string[] = [];
		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue;
			}
			const pluginRoot = join(clineDirectoryPath, entry.name);
			const manifestPath = join(pluginRoot, MANAGED_PLUGIN_MANIFEST_FILE_NAME);
			try {
				const content = await readFile(manifestPath, "utf8");
				const parsed = JSON.parse(content) as unknown;
				if (parsed && typeof parsed === "object") {
					pluginRoots.push(pluginRoot);
				}
			} catch (error) {
				if (isIgnorableDirectoryError(error)) {
					continue;
				}
				const nodeError = error as NodeJS.ErrnoException;
				if (nodeError?.name === "SyntaxError") {
					continue;
				}
				throw error;
			}
		}
		return pluginRoots.sort((a, b) => a.localeCompare(b));
	} catch (error) {
		if (isIgnorableDirectoryError(error)) {
			return [];
		}
		throw error;
	}
}

function parseMarkdownFrontmatter(
	content: string,
): ParseMarkdownFrontmatterResult {
	// Strip a leading UTF-8 BOM (e.g. added by Windows Notepad's "UTF-8 with BOM" encoding),
	// which Node's `utf-8` decoding does not strip on its own. Without this the frontmatter
	// regex below never matches a file that starts with "\uFEFF---" (see cline/cline#12151).
	const normalizedContent = stripUtf8Bom(content);

	const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
	const match = normalizedContent.match(frontmatterRegex);
	if (!match) {
		return { data: {}, body: normalizedContent, hadFrontmatter: false };
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
			body: normalizedContent,
			hadFrontmatter: true,
			parseError: message,
		};
	}
}

function parseStringField(
	value: unknown,
	fieldName: string,
	isRequired: boolean,
): string | undefined {
	if (value === undefined || value === null) {
		if (isRequired) {
			throw new Error(`Missing required frontmatter field '${fieldName}'.`);
		}
		return undefined;
	}
	if (typeof value !== "string") {
		throw new Error(`Frontmatter field '${fieldName}' must be a string.`);
	}
	const normalized = value.trim();
	if (!normalized && isRequired) {
		throw new Error(`Frontmatter field '${fieldName}' cannot be empty.`);
	}
	return normalized || undefined;
}

function parseBooleanField(
	value: unknown,
	fieldName: string,
): boolean | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value !== "boolean") {
		throw new Error(`Frontmatter field '${fieldName}' must be a boolean.`);
	}
	return value;
}

function resolveRuleFallbackName(
	context: UnifiedConfigFileContext<"rule">,
	workspacePath?: string,
): string {
	const fileName = basename(context.filePath);
	if (fileName.toLowerCase() !== AGENTS_RULES_FILE_NAME.toLowerCase()) {
		return basename(context.filePath, extname(context.filePath));
	}

	if (
		workspacePath &&
		resolve(context.filePath) === resolve(workspacePath, AGENTS_RULES_FILE_NAME)
	) {
		return "Workspace AGENTS.md";
	}

	if (resolve(context.filePath) === resolve(resolveGlobalAgentsRulesPath())) {
		return "Global AGENTS.md";
	}

	return basename(context.filePath, extname(context.filePath));
}

export function parseSkillConfigFromMarkdown(
	content: string,
	fallbackName: string,
): SkillConfig {
	const { data, body, parseError } = parseMarkdownFrontmatter(content);
	if (parseError) {
		throw new Error(`Failed to parse YAML frontmatter: ${parseError}`);
	}
	const instructions = body.trim();
	if (!instructions) {
		throw new Error("Missing instructions body in skill file.");
	}
	const parsedName = parseStringField(data.name, "name", false);
	const name = parsedName ?? fallbackName.trim();
	if (!name) {
		throw new Error("Missing skill name.");
	}

	return {
		name,
		description: parseStringField(data.description, "description", false),
		disabled:
			parseBooleanField(data.disabled, "disabled") ??
			(parseBooleanField(data.enabled, "enabled") === false ? true : undefined),
		instructions,
		frontmatter: data,
	};
}

export function parseRuleConfigFromMarkdown(
	content: string,
	fallbackName: string,
): RuleConfig {
	const { data, body, parseError } = parseMarkdownFrontmatter(content);
	if (parseError) {
		throw new Error(`Failed to parse YAML frontmatter: ${parseError}`);
	}
	const instructions = body.trim();
	if (!instructions) {
		throw new Error("Missing instructions body in rule file.");
	}
	const name =
		parseStringField(data.name, "name", false) ?? fallbackName.trim();
	if (!name) {
		throw new Error("Missing rule name.");
	}
	return {
		name,
		disabled:
			parseBooleanField(data.disabled, "disabled") ??
			(parseBooleanField(data.enabled, "enabled") === false ? true : undefined),
		instructions,
		frontmatter: data,
	};
}

export function parseWorkflowConfigFromMarkdown(
	content: string,
	fallbackName: string,
): WorkflowConfig {
	const { data, body, parseError } = parseMarkdownFrontmatter(content);
	if (parseError) {
		throw new Error(`Failed to parse YAML frontmatter: ${parseError}`);
	}
	const instructions = body.trim();
	if (!instructions) {
		throw new Error("Missing instructions body in workflow file.");
	}
	const name =
		parseStringField(data.name, "name", false) ?? fallbackName.trim();
	if (!name) {
		throw new Error("Missing workflow name.");
	}
	return {
		name,
		disabled:
			parseBooleanField(data.disabled, "disabled") ??
			(parseBooleanField(data.enabled, "enabled") === false ? true : undefined),
		instructions,
		frontmatter: data,
	};
}

export function resolveSkillsConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return resolveSkillsConfigSearchPathsFromShared(workspacePath);
}

export function resolveRulesConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return resolveRulesConfigSearchPathsFromShared(workspacePath);
}

export function resolveWorkflowsConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return resolveWorkflowsConfigSearchPathsFromShared(workspacePath);
}

async function discoverSkillFiles(
	directoryPath: string,
): Promise<ReadonlyArray<UnifiedConfigFileCandidate>> {
	if (basename(directoryPath) === ".cline") {
		const pluginRoots = await discoverManagedPluginRoots(directoryPath);
		const nestedCandidates = await Promise.all(
			pluginRoots.map((pluginRoot) =>
				discoverSkillFiles(join(pluginRoot, SKILLS_CONFIG_DIRECTORY_NAME)),
			),
		);
		return nestedCandidates.flat();
	}

	try {
		const entries = await readdir(directoryPath, { withFileTypes: true });
		const candidates: UnifiedConfigFileCandidate[] = [];
		for (const entry of entries) {
			if (entry.isFile() && entry.name === SKILL_FILE_NAME) {
				candidates.push({
					directoryPath,
					fileName: entry.name,
					filePath: join(directoryPath, entry.name),
				});
				continue;
			}
			const entryPath = join(directoryPath, entry.name);
			const isDirectory =
				entry.isDirectory() ||
				(entry.isSymbolicLink() &&
					(await stat(entryPath)
						.then((entryStat) => entryStat.isDirectory())
						.catch((error) => {
							if (isIgnorableDirectoryError(error)) {
								return false;
							}
							throw error;
						})));
			if (isDirectory) {
				candidates.push({
					directoryPath: entryPath,
					fileName: SKILL_FILE_NAME,
					filePath: join(entryPath, SKILL_FILE_NAME),
				});
			}
		}
		return candidates;
	} catch (error) {
		if (isIgnorableDirectoryError(error)) {
			return [];
		}
		throw error;
	}
}

async function discoverRulesLikeFiles(
	directoryPath: string,
): Promise<ReadonlyArray<UnifiedConfigFileCandidate>> {
	if (basename(directoryPath) === ".cline") {
		const pluginRoots = await discoverManagedPluginRoots(directoryPath);
		const nestedCandidates = await Promise.all(
			pluginRoots.map((pluginRoot) =>
				discoverRulesLikeFiles(join(pluginRoot, "rules.md")),
			),
		);
		return nestedCandidates.flat();
	}

	try {
		const entryStat = await stat(directoryPath);
		if (entryStat.isFile()) {
			return [
				{
					directoryPath: dirname(directoryPath),
					fileName: basename(directoryPath),
					filePath: directoryPath,
				},
			];
		}
	} catch (error) {
		if (!isIgnorableDirectoryError(error)) {
			throw error;
		}
	}

	try {
		const entries = await readdir(directoryPath, { withFileTypes: true });
		const candidates = entries
			.filter((entry) => entry.isFile() && isMarkdownFile(entry.name))
			.map((entry) => ({
				directoryPath,
				fileName: entry.name,
				filePath: join(directoryPath, entry.name),
			}));

		// Special case: if this is a workspace root directory, also check for AGENTS.md
		const agentsPath = join(directoryPath, "AGENTS.md");
		try {
			const agentsStat = await stat(agentsPath);
			if (agentsStat.isFile()) {
				// Check if AGENTS.md is not already in the candidates
				const alreadyIncluded = candidates.some(
					(c) => c.fileName === "AGENTS.md",
				);
				if (!alreadyIncluded) {
					candidates.push({
						directoryPath,
						fileName: "AGENTS.md",
						filePath: agentsPath,
					});
				}
			}
		} catch {
			// AGENTS.md doesn't exist or is not accessible, which is fine
		}

		return candidates;
	} catch (error) {
		if (isIgnorableDirectoryError(error)) {
			return [];
		}
		throw error;
	}
}

async function discoverManagedWorkflowFiles(
	directoryPath: string,
): Promise<ReadonlyArray<UnifiedConfigFileCandidate>> {
	if (basename(directoryPath) === ".cline") {
		const pluginRoots = await discoverManagedPluginRoots(directoryPath);
		const nestedCandidates = await Promise.all(
			pluginRoots.map((pluginRoot) =>
				discoverRulesLikeFiles(
					join(pluginRoot, WORKFLOWS_CONFIG_DIRECTORY_NAME),
				),
			),
		);
		return nestedCandidates.flat();
	}
	return discoverRulesLikeFiles(directoryPath);
}

export function createSkillsConfigDefinition(
	options?: CreateSkillsConfigDefinitionOptions,
): UnifiedConfigDefinition<"skill", SkillConfig> {
	const directories = resolveSkillDirectories(options);
	const managedRoot = options?.workspacePath
		? join(options.workspacePath, ".cline")
		: undefined;

	return {
		type: "skill",
		directories: managedRoot
			? dedupeDirectoryPaths([...directories, managedRoot])
			: directories,
		discoverFiles: discoverSkillFiles,
		includeFile: (fileName) => fileName === SKILL_FILE_NAME,
		parseFile: (context) =>
			parseSkillConfigFromMarkdown(
				context.content,
				basename(context.directoryPath),
			),
		resolveId: (skill) => normalizeName(skill.name),
	};
}

export function createRulesConfigDefinition(
	options?: CreateRulesConfigDefinitionOptions,
): UnifiedConfigDefinition<"rule", RuleConfig> {
	const directories =
		options?.directories ??
		resolveRulesConfigSearchPaths(options?.workspacePath);
	const managedRoot = options?.workspacePath
		? join(options.workspacePath, ".cline")
		: undefined;

	return {
		type: "rule",
		directories: managedRoot ? [...directories, managedRoot] : directories,
		discoverFiles: discoverRulesLikeFiles,
		includeFile: (fileName, filePath) =>
			fileName === ".clinerules" ||
			isMarkdownFile(fileName) ||
			isMarkdownFile(filePath),
		parseFile: (context) =>
			parseRuleConfigFromMarkdown(
				context.content,
				resolveRuleFallbackName(context, options?.workspacePath),
			),
		resolveId: (rule) => normalizeName(rule.name),
	};
}

export function createWorkflowsConfigDefinition(
	options?: CreateWorkflowsConfigDefinitionOptions,
): UnifiedConfigDefinition<"workflow", WorkflowConfig> {
	const directories =
		options?.directories ??
		resolveWorkflowsConfigSearchPaths(options?.workspacePath);
	const managedRoot = options?.workspacePath
		? join(options.workspacePath, ".cline")
		: undefined;

	return {
		type: "workflow",
		directories: managedRoot ? [...directories, managedRoot] : directories,
		discoverFiles: discoverManagedWorkflowFiles,
		includeFile: (fileName) => isMarkdownFile(fileName),
		parseFile: (context) =>
			parseWorkflowConfigFromMarkdown(
				context.content,
				basename(context.filePath, extname(context.filePath)),
			),
		resolveId: (workflow) => normalizeName(workflow.name),
	};
}

export interface CreateUserInstructionConfigWatcherOptions
	extends CreateInstructionWatcherOptions {
	skills?: CreateSkillsConfigDefinitionOptions;
	rules?: CreateRulesConfigDefinitionOptions;
	workflows?: CreateWorkflowsConfigDefinitionOptions;
}

export function createUserInstructionConfigWatcher(
	options?: CreateUserInstructionConfigWatcherOptions,
): UserInstructionConfigWatcher {
	const definitions: ReadonlyArray<
		UnifiedConfigDefinition<UserInstructionConfigType, UserInstructionConfig>
	> = [
		createSkillsConfigDefinition(options?.skills) as UnifiedConfigDefinition<
			UserInstructionConfigType,
			UserInstructionConfig
		>,
		createRulesConfigDefinition(options?.rules) as UnifiedConfigDefinition<
			UserInstructionConfigType,
			UserInstructionConfig
		>,
		createWorkflowsConfigDefinition(
			options?.workflows,
		) as UnifiedConfigDefinition<
			UserInstructionConfigType,
			UserInstructionConfig
		>,
	];

	return new UnifiedConfigFileWatcher(definitions, {
		debounceMs: options?.debounceMs,
		emitParseErrors: options?.emitParseErrors,
	});
}
