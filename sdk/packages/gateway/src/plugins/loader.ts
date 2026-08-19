/**
 * Agent Plugins loading and discovery (Gateway RFC, Phase 4).
 *
 * Implements the client-implementer contract of
 * https://agent-plugins.org/client-implementers/loading-and-discovery:
 *
 * - The plugin root is a single filesystem location. Every file the
 *   Gateway discovers or reads must remain inside the filesystem-resolved
 *   root after resolving symlinks (and equivalents).
 * - `plugin.json` is loaded and validated before any component discovery.
 * - Skills are discovered only as immediate `skills/*\/SKILL.md` children;
 *   nested descendants are never searched.
 * - MCP servers are read from one root `mcp.json` document.
 * - Failures apply the narrowest boundary: a manifest violation or an
 *   escaping `plugin.json` rejects the plugin; a wrong-kind or escaping
 *   fixed location disables only that component type; a non-conforming or
 *   escaping skill/MCP entry is skipped alone.
 */

import { createHash } from "node:crypto";
import {
	lstatSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
} from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import {
	type AgentPluginManifest,
	type PluginDiagnostic,
	validatePluginManifest,
} from "./manifest";

export interface LoadedSkill {
	/** Skill directory name (immediate child of `skills/`). */
	readonly id: string;
	/** Frontmatter `name`. */
	readonly name: string;
	/** Frontmatter `description`. */
	readonly description: string;
	/** Real (resolved) path of SKILL.md, inside the plugin root. */
	readonly skillFile: string;
	readonly content: string;
}

export interface LoadedMcpServer {
	/** Entry key in `mcp.json`. */
	readonly name: string;
	/** stdio transport: command + args; http transport: url. */
	readonly command?: string;
	readonly args?: readonly string[];
	readonly env?: Readonly<Record<string, string>>;
	readonly url?: string;
}

export interface LoadedPlugin {
	readonly manifest: AgentPluginManifest;
	/** Filesystem-resolved plugin root; the package boundary. */
	readonly rootPath: string;
	readonly skills: readonly LoadedSkill[];
	readonly mcpServers: readonly LoadedMcpServer[];
	readonly diagnostics: readonly PluginDiagnostic[];
	/** Content fingerprint used to skip re-import of unchanged plugins. */
	readonly fingerprint: string;
}

export type PluginLoadResult =
	| { ok: true; plugin: LoadedPlugin }
	| { ok: false; rootPath: string; diagnostics: readonly PluginDiagnostic[] };

function diagnostic(
	severity: PluginDiagnostic["severity"],
	code: string,
	message: string,
	boundary: PluginDiagnostic["boundary"],
): PluginDiagnostic {
	return { severity, code, message, boundary };
}

/** True when `candidate` (already resolved) is inside `root` (resolved). */
function isInside(root: string, candidate: string): boolean {
	return candidate === root || candidate.startsWith(root + sep);
}

/**
 * Resolve a path and require it to stay inside the resolved root after
 * following links. Returns undefined when it escapes or does not exist.
 */
function resolveInside(root: string, path: string): string | undefined {
	let real: string;
	try {
		real = realpathSync(path);
	} catch {
		return undefined;
	}
	return isInside(root, real) ? real : undefined;
}

interface Frontmatter {
	readonly name?: string;
	readonly description?: string;
}

/** Minimal YAML frontmatter reader: top-level `key: value` scalars only. */
function parseFrontmatter(content: string): Frontmatter | undefined {
	if (!content.startsWith("---")) {
		return undefined;
	}
	const end = content.indexOf("\n---", 3);
	if (end === -1) {
		return undefined;
	}
	const block = content.slice(content.indexOf("\n") + 1, end);
	const values: Record<string, string> = {};
	for (const line of block.split("\n")) {
		const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
		if (!match) {
			continue;
		}
		const value = match[2].trim().replace(/^["']|["']$/g, "");
		values[match[1]] = value;
	}
	return values;
}

function discoverSkills(
	rootPath: string,
	diagnostics: PluginDiagnostic[],
): LoadedSkill[] {
	const skillsDir = join(rootPath, "skills");
	let kind: ReturnType<typeof lstatSync>;
	try {
		kind = lstatSync(skillsDir);
	} catch {
		// A missing fixed location is not an error.
		return [];
	}
	const realSkillsDir = resolveInside(rootPath, skillsDir);
	if (!realSkillsDir || !statSync(realSkillsDir).isDirectory()) {
		diagnostics.push(
			diagnostic(
				"warning",
				"skills.location_invalid",
				kind.isDirectory()
					? "skills/ escapes the plugin root; the skills component type is disabled"
					: "skills/ exists with the wrong filesystem kind; the skills component type is disabled",
				"skills",
			),
		);
		return [];
	}
	const skills: LoadedSkill[] = [];
	let entries: string[];
	try {
		entries = readdirSync(realSkillsDir).sort();
	} catch {
		return [];
	}
	for (const entry of entries) {
		const childDir = join(realSkillsDir, entry);
		let childStat: ReturnType<typeof statSync>;
		try {
			childStat = statSync(childDir);
		} catch {
			continue;
		}
		if (!childStat.isDirectory()) {
			// Only immediate child *directories* participate.
			continue;
		}
		const skillFile = join(childDir, "SKILL.md");
		let fileStat: ReturnType<typeof lstatSync>;
		try {
			fileStat = lstatSync(skillFile);
		} catch {
			// No SKILL.md: not a skill; not an error either.
			continue;
		}
		const realSkillFile = resolveInside(rootPath, skillFile);
		if (!realSkillFile) {
			diagnostics.push(
				diagnostic(
					"warning",
					"skills.skill_escapes_root",
					`skills/${entry}/SKILL.md escapes the plugin root; this skill is skipped`,
					`skill:${entry}`,
				),
			);
			continue;
		}
		if (!fileStat.isFile() && !fileStat.isSymbolicLink()) {
			diagnostics.push(
				diagnostic(
					"warning",
					"skills.skill_not_regular",
					`skills/${entry}/SKILL.md is not a regular file; this skill is skipped`,
					`skill:${entry}`,
				),
			);
			continue;
		}
		if (!statSync(realSkillFile).isFile()) {
			diagnostics.push(
				diagnostic(
					"warning",
					"skills.skill_not_regular",
					`skills/${entry}/SKILL.md is not a regular file; this skill is skipped`,
					`skill:${entry}`,
				),
			);
			continue;
		}
		let content: string;
		try {
			content = readFileSync(realSkillFile, "utf8");
		} catch (error) {
			diagnostics.push(
				diagnostic(
					"warning",
					"skills.skill_unreadable",
					`skills/${entry}/SKILL.md could not be read (${String(error)}); this skill is skipped`,
					`skill:${entry}`,
				),
			);
			continue;
		}
		const frontmatter = parseFrontmatter(content);
		if (!frontmatter?.name || !frontmatter.description) {
			diagnostics.push(
				diagnostic(
					"warning",
					"skills.skill_invalid",
					`skills/${entry}/SKILL.md does not conform to the Agent Skills specification ` +
						"(frontmatter requires name and description); this skill is skipped",
					`skill:${entry}`,
				),
			);
			continue;
		}
		skills.push({
			id: entry,
			name: frontmatter.name,
			description: frontmatter.description,
			skillFile: realSkillFile,
			content,
		});
	}
	return skills;
}

function looksLikePath(value: string): boolean {
	return (
		isAbsolute(value) ||
		value.startsWith("./") ||
		value.startsWith("../") ||
		value.startsWith(".\\") ||
		value.startsWith("..\\")
	);
}

/**
 * Resolve a configured package path against the plugin root and require
 * it to stay inside. Non-path values (bare commands like `bunx`) pass
 * through untouched.
 */
function checkConfiguredPath(rootPath: string, value: string): boolean {
	if (!looksLikePath(value)) {
		return true;
	}
	const resolved = isAbsolute(value) ? value : resolve(rootPath, value);
	// The file may not exist yet (an install step could create it); the
	// escape check is lexical first, then link-resolved when it exists.
	const lexical = resolve(resolved);
	if (!isInside(rootPath, lexical)) {
		return false;
	}
	try {
		const real = realpathSync(lexical);
		return isInside(rootPath, real);
	} catch {
		return true;
	}
}

function discoverMcpServers(
	rootPath: string,
	diagnostics: PluginDiagnostic[],
): LoadedMcpServer[] {
	const mcpFile = join(rootPath, "mcp.json");
	let kind: ReturnType<typeof lstatSync>;
	try {
		kind = lstatSync(mcpFile);
	} catch {
		// A missing fixed location is not an error.
		return [];
	}
	const realMcpFile = resolveInside(rootPath, mcpFile);
	if (!realMcpFile || !statSync(realMcpFile).isFile() || kind.isDirectory()) {
		diagnostics.push(
			diagnostic(
				"warning",
				"mcp.location_invalid",
				kind.isDirectory()
					? "mcp.json exists with the wrong filesystem kind; the MCP component type is disabled"
					: "mcp.json escapes the plugin root; the MCP component type is disabled",
				"mcp",
			),
		);
		return [];
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(realMcpFile, "utf8"));
	} catch (error) {
		diagnostics.push(
			diagnostic(
				"warning",
				"mcp.document_invalid",
				`mcp.json is not valid JSON (${String(error)}); the MCP component type is disabled`,
				"mcp",
			),
		);
		return [];
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		diagnostics.push(
			diagnostic(
				"warning",
				"mcp.document_invalid",
				"mcp.json must be a JSON object; the MCP component type is disabled",
				"mcp",
			),
		);
		return [];
	}
	const document = parsed as { mcpServers?: unknown };
	if (document.mcpServers === undefined) {
		return [];
	}
	if (
		typeof document.mcpServers !== "object" ||
		document.mcpServers === null ||
		Array.isArray(document.mcpServers)
	) {
		diagnostics.push(
			diagnostic(
				"warning",
				"mcp.document_invalid",
				"mcp.json `mcpServers` must be an object; the MCP component type is disabled",
				"mcp",
			),
		);
		return [];
	}
	const servers: LoadedMcpServer[] = [];
	for (const [name, entry] of Object.entries(
		document.mcpServers as Record<string, unknown>,
	)) {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
			diagnostics.push(
				diagnostic(
					"warning",
					"mcp.entry_invalid",
					`mcp.json server "${name}" must be an object; this entry is skipped`,
					`mcp-server:${name}`,
				),
			);
			continue;
		}
		const spec = entry as {
			command?: unknown;
			args?: unknown;
			env?: unknown;
			url?: unknown;
		};
		const command = typeof spec.command === "string" ? spec.command : undefined;
		const url = typeof spec.url === "string" ? spec.url : undefined;
		if (!command && !url) {
			diagnostics.push(
				diagnostic(
					"warning",
					"mcp.entry_invalid",
					`mcp.json server "${name}" needs a string \`command\` or \`url\`; this entry is skipped`,
					`mcp-server:${name}`,
				),
			);
			continue;
		}
		const args = Array.isArray(spec.args)
			? spec.args.filter((value): value is string => typeof value === "string")
			: undefined;
		// Configured package paths must not escape the plugin root.
		const pathCandidates = [...(command ? [command] : []), ...(args ?? [])];
		const escaping = pathCandidates.find(
			(candidate) => !checkConfiguredPath(rootPath, candidate),
		);
		if (escaping) {
			diagnostics.push(
				diagnostic(
					"warning",
					"mcp.entry_escapes_root",
					`mcp.json server "${name}" references "${escaping}" outside the plugin root; this entry is skipped`,
					`mcp-server:${name}`,
				),
			);
			continue;
		}
		const env =
			typeof spec.env === "object" &&
			spec.env !== null &&
			!Array.isArray(spec.env)
				? Object.fromEntries(
						Object.entries(spec.env as Record<string, unknown>).filter(
							(pair): pair is [string, string] => typeof pair[1] === "string",
						),
					)
				: undefined;
		servers.push({
			name,
			...(command ? { command } : {}),
			...(args ? { args } : {}),
			...(env ? { env } : {}),
			...(url ? { url } : {}),
		});
	}
	return servers;
}

/**
 * Cheap change fingerprint over the files that define the plugin's
 * catalog contribution. Used by the catalog to skip re-importing
 * unchanged plugins across reconciliations.
 */
export function fingerprintPluginDir(rootPath: string): string {
	const hash = createHash("sha256");
	const record = (path: string) => {
		try {
			const stat = statSync(path);
			hash.update(path);
			hash.update(String(stat.mtimeMs));
			hash.update(String(stat.size));
		} catch {
			hash.update(`${path}:missing`);
		}
	};
	record(join(rootPath, "plugin.json"));
	record(join(rootPath, "mcp.json"));
	const skillsDir = join(rootPath, "skills");
	try {
		for (const entry of readdirSync(skillsDir).sort()) {
			record(join(skillsDir, entry, "SKILL.md"));
		}
	} catch {
		hash.update("skills:missing");
	}
	return hash.digest("hex");
}

/**
 * Load one plugin from a directory. Never throws for content problems:
 * every failure is a diagnostic at its narrowest boundary.
 */
export function loadPlugin(rootDir: string): PluginLoadResult {
	// Establish the package boundary: one filesystem-resolved root.
	let rootPath: string;
	try {
		rootPath = realpathSync(rootDir);
	} catch (error) {
		return {
			ok: false,
			rootPath: rootDir,
			diagnostics: [
				diagnostic(
					"error",
					"plugin.root_missing",
					`Plugin root ${rootDir} cannot be resolved: ${String(error)}`,
					"plugin",
				),
			],
		};
	}
	if (!statSync(rootPath).isDirectory()) {
		return {
			ok: false,
			rootPath,
			diagnostics: [
				diagnostic(
					"error",
					"plugin.root_not_directory",
					`Plugin root ${rootDir} is not a directory`,
					"plugin",
				),
			],
		};
	}

	// Load the manifest first, before any component discovery.
	const manifestPath = join(rootPath, "plugin.json");
	const realManifestPath = resolveInside(rootPath, manifestPath);
	if (!realManifestPath) {
		return {
			ok: false,
			rootPath,
			diagnostics: [
				diagnostic(
					"error",
					"plugin.manifest_missing_or_escaping",
					"plugin.json is missing or resolves outside the plugin root; the plugin is rejected",
					"plugin",
				),
			],
		};
	}
	let parsedManifest: unknown;
	try {
		parsedManifest = JSON.parse(readFileSync(realManifestPath, "utf8"));
	} catch (error) {
		return {
			ok: false,
			rootPath,
			diagnostics: [
				diagnostic(
					"error",
					"plugin.manifest_unparseable",
					`plugin.json is not valid JSON: ${String(error)}`,
					"plugin",
				),
			],
		};
	}
	const validation = validatePluginManifest(parsedManifest);
	if (!validation.ok) {
		return { ok: false, rootPath, diagnostics: validation.diagnostics };
	}

	const diagnostics: PluginDiagnostic[] = [...validation.diagnostics];
	const skills = discoverSkills(rootPath, diagnostics);
	const mcpServers = discoverMcpServers(rootPath, diagnostics);

	return {
		ok: true,
		plugin: {
			manifest: validation.manifest,
			rootPath,
			skills,
			mcpServers,
			diagnostics,
			fingerprint: fingerprintPluginDir(rootPath),
		},
	};
}
