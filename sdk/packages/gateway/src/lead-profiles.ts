import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadPlugin } from "./plugins/loader";

export const PLAIN_LEAD_PROFILE_ID = "cline";

const LeadProfileDocumentSchema = z
	.object({
		id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
		name: z.string().min(1).max(128),
		description: z.string().min(1).max(1024),
		rules: z.array(z.string().min(1)),
		plugins: z.array(z.string().min(1)),
		templateVariables: z.array(z.string().min(1)).default([]),
	})
	.strict();

export interface LeadProfileSummary {
	readonly id: string;
	readonly name: string;
	readonly description: string;
}

export interface ResolvedLeadProfile extends LeadProfileSummary {
	readonly systemPrompt: string;
	readonly pluginRoots: readonly string[];
}

export interface LeadProfileTemplateValues {
	readonly ADMIN_NAME?: string;
	readonly ADMIN_FULL_NAME?: string;
	readonly CLINE_HOME?: string;
	readonly PUBLIC_HOST?: string;
}

export const PLAIN_LEAD_PROFILE: ResolvedLeadProfile = Object.freeze({
	id: PLAIN_LEAD_PROFILE_ID,
	name: "Cline",
	description: "The standard Cline lead profile.",
	systemPrompt: "",
	pluginRoots: Object.freeze([]),
});

export function bundledLeadProfileFile(profileId: string): string | undefined {
	if (profileId !== "cline-dad") return undefined;
	const configuredRoot = process.env.CLINE_GATEWAY_PROFILES_DIR?.trim();
	if (configuredRoot) {
		return resolve(configuredRoot, "cline-dad", "profile.json");
	}
	return resolve(
		dirname(fileURLToPath(import.meta.url)),
		"..",
		"default-agent",
		"cline-dad",
		"profile.json",
	);
}

export function loadBundledLeadProfile(
	profileId: string,
	values: LeadProfileTemplateValues = {},
): ResolvedLeadProfile {
	if (profileId === PLAIN_LEAD_PROFILE_ID) return PLAIN_LEAD_PROFILE;
	const file = bundledLeadProfileFile(profileId);
	if (!file || !existsSync(file)) {
		throw new Error(`Unknown or unavailable lead profile: ${profileId}`);
	}
	return loadLeadProfile(file, values);
}

function resolveInside(root: string, candidate: string): string {
	const path = resolve(root, candidate);
	if (path !== root && !path.startsWith(root + sep)) {
		throw new Error(`Lead profile path escapes its root: ${candidate}`);
	}
	return path;
}

function renderTemplate(
	content: string,
	values: LeadProfileTemplateValues,
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

export function loadLeadProfile(
	profileFile: string,
	values: LeadProfileTemplateValues = {},
): ResolvedLeadProfile {
	const file = resolve(profileFile);
	const root = dirname(file);
	const document = LeadProfileDocumentSchema.parse(
		JSON.parse(readFileSync(file, "utf8")),
	);
	const rules = document.rules.map((entry) => {
		const path = resolveInside(root, entry);
		if (!existsSync(path))
			throw new Error(`Missing lead profile rule: ${entry}`);
		return `# Rule: ${basename(entry)}\n\n${renderTemplate(readFileSync(path, "utf8"), values)}`;
	});
	const pluginRoots = document.plugins.map((entry) => {
		const path = resolveInside(root, entry);
		if (!existsSync(resolve(path, "plugin.json"))) {
			throw new Error(`Invalid lead profile plugin: ${entry}`);
		}
		return path;
	});
	const skills = pluginRoots.flatMap((pluginRoot) => {
		const loaded = loadPlugin(pluginRoot);
		if (!loaded.ok) {
			throw new Error(
				`Invalid lead profile plugin ${pluginRoot}: ${loaded.diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`,
			);
		}
		return loaded.plugin.skills.map(
			(skill) =>
				`# Skill: ${skill.name}\n\n${renderTemplate(skill.content, values)}`,
		);
	});
	return Object.freeze({
		id: document.id,
		name: document.name,
		description: document.description,
		systemPrompt: [...rules, ...skills].join("\n\n---\n\n"),
		pluginRoots: Object.freeze(pluginRoots),
	});
}

export function listLeadProfiles(
	profileFiles: readonly string[],
): readonly LeadProfileSummary[] {
	return [
		PLAIN_LEAD_PROFILE,
		...profileFiles.map((file) => {
			const document = LeadProfileDocumentSchema.parse(
				JSON.parse(readFileSync(file, "utf8")),
			);
			return {
				id: document.id,
				name: document.name,
				description: document.description,
			};
		}),
	];
}
