/**
 * Bot profiles — ported from the Gateway's lead-profile concept.
 *
 * A bot profile is a `profile.json` document that shapes the identity of the
 * agent every Hub session runs as: an optional identity file, markdown rules,
 * and plugin skills are rendered (with template variables) into a system
 * prompt, and plugin roots are surfaced so the Hub can inject them into
 * session runtimes. The plain `cline` profile — no extra prompt, no plugins —
 * remains the default.
 *
 * `identity` is the profile's persona, kept distinct from `rules` (extra
 * instructions layered on top). `plugins` is how a profile bundles skills and
 * MCP servers: a plugin root's `plugin.json` can declare `skills/<name>/
 * SKILL.md` children and/or an `"mcp"` capability that registers MCP servers,
 * both loaded as hub-owned session extensions alongside the profile.
 *
 * Profiles fail closed at load time: a missing identity/rule file, an
 * escaping path, or an invalid plugin root is an error, never a silently
 * degraded prompt.
 *
 * Document shape (all paths resolved inside the profile's own directory):
 *
 * ```json
 * {
 *   "id": "cline-dad",
 *   "name": "Cline Dad",
 *   "description": "Default lead with diagnostics and support tools.",
 *   "identity": "rules/identity.md",
 *   "rules": [],
 *   "plugins": ["plugins/cline-support"],
 *   "templateVariables": ["ADMIN_NAME"]
 * }
 * ```
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

export const PLAIN_BOT_PROFILE_ID = "cline";

export interface BotProfileSummary {
	readonly id: string;
	readonly name: string;
	readonly description: string;
}

export interface ResolvedBotProfile extends BotProfileSummary {
	/** Rendered identity + rules + plugin skills; empty for the plain profile. */
	readonly systemPrompt: string;
	/** Rendered persona text, kept distinct from `rules`; undefined if the profile declares none. */
	readonly identity?: string;
	/** Validated plugin roots (each contains a `plugin.json`). */
	readonly pluginRoots: readonly string[];
	/**
	 * When true, the Hub injects its self-diagnostic `cline_hub_support` tool
	 * into every session runtime, so the profile's agent can inspect hub
	 * status, sessions, runs, config, and logs to unblock itself.
	 */
	readonly includeHubSupportTool?: boolean;
}

export interface BotProfileTemplateValues {
	readonly ADMIN_NAME?: string;
	readonly ADMIN_FULL_NAME?: string;
	readonly CLINE_HOME?: string;
	readonly PUBLIC_HOST?: string;
}

export const PLAIN_BOT_PROFILE: ResolvedBotProfile = Object.freeze({
	id: PLAIN_BOT_PROFILE_ID,
	name: "Cline",
	description: "The standard Cline bot profile.",
	systemPrompt: "",
	pluginRoots: Object.freeze([]) as readonly string[],
});

interface BotProfileDocument {
	id: string;
	name: string;
	description: string;
	identity?: string;
	rules: string[];
	plugins: string[];
	templateVariables: string[];
}

const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function parseProfileDocument(raw: unknown, file: string): BotProfileDocument {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error(`Invalid bot profile document: ${file}`);
	}
	const document = raw as Record<string, unknown>;
	const id = typeof document.id === "string" ? document.id : "";
	if (!PROFILE_ID_PATTERN.test(id)) {
		throw new Error(
			`Invalid bot profile id in ${file}: ${String(document.id)}`,
		);
	}
	const name = typeof document.name === "string" ? document.name.trim() : "";
	const description =
		typeof document.description === "string" ? document.description.trim() : "";
	if (!name || name.length > 128 || !description || description.length > 1024) {
		throw new Error(`Bot profile ${file} requires a name and description`);
	}
	const readStringArray = (key: string): string[] => {
		const value = document[key];
		if (value === undefined) {
			return [];
		}
		if (
			!Array.isArray(value) ||
			value.some((entry) => typeof entry !== "string" || !entry.trim())
		) {
			throw new Error(
				`Bot profile ${file}: "${key}" must be non-empty strings`,
			);
		}
		return value as string[];
	};
	const identityValue = document.identity;
	if (
		identityValue !== undefined &&
		(typeof identityValue !== "string" || !identityValue.trim())
	) {
		throw new Error(`Bot profile ${file}: "identity" must be a non-empty string`);
	}
	return {
		id,
		name,
		description,
		identity: identityValue as string | undefined,
		rules: readStringArray("rules"),
		plugins: readStringArray("plugins"),
		templateVariables: readStringArray("templateVariables"),
	};
}

function resolveInside(root: string, candidate: string): string {
	const path = resolve(root, candidate);
	if (path !== root && !path.startsWith(root + sep)) {
		throw new Error(`Bot profile path escapes its root: ${candidate}`);
	}
	return path;
}

function readIdentityFile(root: string, candidate: string): string {
	const path = resolveInside(root, candidate);
	if (!existsSync(path)) {
		throw new Error(`Missing bot profile identity: ${candidate}`);
	}
	return readFileSync(path, "utf8");
}

/** Substitute `{{ADMIN_NAME}}`-style template variables into profile text. */
export function renderBotProfileTemplate(
	content: string,
	values: BotProfileTemplateValues,
): string {
	return renderTemplate(content, values);
}

function renderTemplate(
	content: string,
	values: BotProfileTemplateValues,
): string {
	const adminName = values.ADMIN_NAME ?? "the administrator";
	const replacements: Record<string, string> = {
		ADMIN_NAME: adminName,
		ADMIN_FULL_NAME: values.ADMIN_FULL_NAME ?? adminName,
		CLINE_HOME: values.CLINE_HOME ?? "~",
		PUBLIC_HOST: values.PUBLIC_HOST ?? "the configured public host",
	};
	return content
		.replace(/\{\{([A-Z_]+)\}\}/g, (match, key: string) =>
			key in replacements ? replacements[key] : match,
		)
		.replaceAll("{{admin_name}}", adminName.toLowerCase());
}

/** Skills are immediate `skills/<name>/SKILL.md` children of a plugin root. */
function readPluginSkills(
	pluginRoot: string,
): { name: string; content: string }[] {
	const skillsDir = join(pluginRoot, "skills");
	if (!existsSync(skillsDir)) {
		return [];
	}
	const skills: { name: string; content: string }[] = [];
	for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) {
			continue;
		}
		const skillFile = join(skillsDir, entry.name, "SKILL.md");
		if (!existsSync(skillFile)) {
			continue;
		}
		skills.push({ name: entry.name, content: readFileSync(skillFile, "utf8") });
	}
	return skills;
}

export function loadBotProfile(
	profileFile: string,
	values: BotProfileTemplateValues = {},
): ResolvedBotProfile {
	const file = resolve(profileFile);
	const root = dirname(file);
	const document = parseProfileDocument(
		JSON.parse(readFileSync(file, "utf8")),
		file,
	);
	const identity = document.identity
		? renderTemplate(
				readIdentityFile(root, document.identity),
				values,
			)
		: undefined;
	const rules = document.rules.map((entry) => {
		const path = resolveInside(root, entry);
		if (!existsSync(path)) {
			throw new Error(`Missing bot profile rule: ${entry}`);
		}
		return `# Rule: ${basename(entry)}\n\n${renderTemplate(readFileSync(path, "utf8"), values)}`;
	});
	const pluginRoots = document.plugins.map((entry) => {
		const path = resolveInside(root, entry);
		if (!existsSync(resolve(path, "plugin.json"))) {
			throw new Error(`Invalid bot profile plugin (no plugin.json): ${entry}`);
		}
		return path;
	});
	const skills = pluginRoots.flatMap((pluginRoot) =>
		readPluginSkills(pluginRoot).map(
			(skill) =>
				`# Skill: ${skill.name}\n\n${renderTemplate(skill.content, values)}`,
		),
	);
	return Object.freeze({
		id: document.id,
		name: document.name,
		description: document.description,
		systemPrompt: [identity, ...rules, ...skills]
			.filter((section): section is string => Boolean(section))
			.join("\n\n---\n\n"),
		identity,
		pluginRoots: Object.freeze(pluginRoots) as readonly string[],
	});
}

/**
 * Resolve a profile selector to a resolved profile. The selector is either
 * the plain id `cline`, or a path to a `profile.json` (or its directory).
 * Environment: `CLINE_HUB_BOT_PROFILE`; daemon flag: `--profile`.
 */
export function resolveBotProfile(
	selector: string | undefined,
	values: BotProfileTemplateValues = {},
): ResolvedBotProfile {
	const trimmed = selector?.trim();
	if (!trimmed || trimmed === PLAIN_BOT_PROFILE_ID) {
		return PLAIN_BOT_PROFILE;
	}
	const candidate = resolve(trimmed);
	const file = candidate.endsWith(".json")
		? candidate
		: join(candidate, "profile.json");
	if (!existsSync(file)) {
		throw new Error(
			`Unknown bot profile "${trimmed}": expected "${PLAIN_BOT_PROFILE_ID}" or a path to a profile.json`,
		);
	}
	return loadBotProfile(file, values);
}

export function toBotProfileSummary(
	profile: ResolvedBotProfile,
): BotProfileSummary {
	return {
		id: profile.id,
		name: profile.name,
		description: profile.description,
	};
}
